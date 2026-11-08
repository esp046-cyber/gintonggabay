// Digital loupe: live camera with graceful fallbacks, plus a snapshot loupe that works without any camera zoom.
const $=id=>document.getElementById(id);
const MAX_EDGE=2048;
const S={stream:null,track:null,zoom:1,hw:null,hwApplied:1,orig:null,snapZ:1,snapHc:false,px:0,py:0};

const ERRORS={
  InsecureContext:'Kailangan ng HTTPS ang kamera. Buksan ang app sa https://esp046-cyber.github.io/gintonggabay/.',
  NotAllowedError:'Na-block ang camera permission. Sa iPhone: Settings > Safari > Camera > Allow. Pagkatapos i-reload ang page.',
  SecurityError:'Na-block ang kamera ng browser. Siguraduhing HTTPS at payagan ang permission.',
  NotFoundError:'Walang nakitang kamera sa device na ito.',
  NotReadableError:'Ginagamit ng ibang app ang kamera. Isara ang ibang app at subukan ulit.',
  OverconstrainedError:'Hindi sinusuportahan ng kamera ang hiniling na setting.',
  AbortError:'Naputol ang pagbubukas ng kamera. Subukan ulit.'
};
const msg=t=>{const m=$('camMsg');if(m)m.textContent=t};
const supported=()=>window.isSecureContext&&navigator.mediaDevices&&typeof navigator.mediaDevices.getUserMedia==='function';

async function openStream(){
  // Try the back camera strictly, then loosely, then any camera (iOS Safari can reject "exact").
  const tries=[
    {video:{facingMode:{exact:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false},
    {video:{facingMode:{ideal:'environment'}},audio:false},
    {video:true,audio:false}
  ];
  let last;
  for(const c of tries){
    try{return await navigator.mediaDevices.getUserMedia(c)}
    catch(e){last=e;if(e.name==='NotAllowedError'||e.name==='SecurityError')throw e}
  }
  throw last;
}

function detectHwZoom(){
  S.hw=null;
  try{
    const caps=S.track&&S.track.getCapabilities?S.track.getCapabilities():null;
    if(caps&&caps.zoom&&Number.isFinite(caps.zoom.max)&&caps.zoom.max>(caps.zoom.min||1)){
      S.hw={min:caps.zoom.min||1,max:caps.zoom.max};
    }
  }catch{S.hw=null}
}

async function setZoom(z){
  S.zoom=z;
  let hwZ=1;
  if(S.hw&&S.track){
    hwZ=Math.min(Math.max(z,S.hw.min),S.hw.max);
    try{await S.track.applyConstraints({advanced:[{zoom:hwZ}]})}
    catch{hwZ=1;S.hw=null} // constraint rejected: fall back to CSS scale
  }
  S.hwApplied=hwZ;
  const v=$('cam');
  if(v)v.style.transform='scale('+(z/hwZ)+')';
  [1,2,4].forEach(n=>{const b=$('z'+n);if(b)b.setAttribute('aria-pressed',String(n===z))});
  const label=$('zoomMode');
  if(label)label.textContent=S.stream?(S.hw?'Zoom: hardware + digital':'Zoom: digital (CSS/canvas)'):'';
}

export function stopCamera(){
  if(S.stream)S.stream.getTracks().forEach(t=>t.stop());
  S.stream=null;S.track=null;S.hw=null;
  const v=$('cam');if(v){v.srcObject=null;v.style.transform='none'}
  const label=$('zoomMode');if(label)label.textContent='';
}

async function startCamera(){
  stopCamera();msg('Binubuksan ang kamera...');
  try{
    if(!supported()){const e=new Error('insecure');e.name='InsecureContext';throw e}
    S.stream=await openStream();
    S.track=S.stream.getVideoTracks()[0];
    const v=$('cam');
    v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.muted=true;
    v.srcObject=S.stream;
    try{await v.play()}catch{/* iOS may delay play until metadata loads; autoplay attr covers it */}
    detectHwZoom();await setZoom(S.zoom);
    let facing='';try{facing=S.track.getSettings().facingMode||''}catch{}
    msg(facing==='user'?'Front camera lang ang nabuksan. Mas maganda ang likod na kamera; kung kaya, gamitin ang "Gumamit ng larawan".':'Bukas ang kamera. Ilapit sa stamp, mag-zoom, tapos pindutin ang "Kuhanan" para sa loupe.');
  }catch(e){
    stopCamera();
    msg((ERRORS[e.name]||('Hindi mabuksan ang kamera ('+(e.name||'error')+').'))+' Pwede ring pindutin ang "Gumamit ng larawan" at kunan ng litrato ang hallmark.');
    const f=$('camFileBtn');if(f)f.focus();
  }
}

// ---------- Snapshot loupe (canvas scale: works with or without hardware zoom) ----------
function enhance(ctx,w,h){ // manual grayscale+contrast; ctx.filter is unsupported on iOS Safari
  const img=ctx.getImageData(0,0,w,h),d=img.data,k=1.9;
  for(let i=0;i<d.length;i+=4){
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    const v=Math.max(0,Math.min(255,(g-128)*k+128+10));
    d[i]=d[i+1]=d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
}
function renderSnap(){
  const c=$('snapCanvas');if(!c||!S.orig)return;
  c.width=S.orig.width;c.height=S.orig.height;
  const ctx=c.getContext('2d');
  ctx.drawImage(S.orig,0,0);
  if(S.snapHc)enhance(ctx,c.width,c.height);
  applyPan();
  const b=$('snapHc');if(b)b.setAttribute('aria-pressed',String(S.snapHc));
  [1,2,4,8].forEach(n=>{const x=$('sz'+n);if(x)x.setAttribute('aria-pressed',String(n===S.snapZ))});
}
function applyPan(){
  const c=$('snapCanvas'),box=$('snapView');if(!c||!box)return;
  const lim=(S.snapZ-1)*Math.max(box.clientWidth,box.clientHeight)/2;
  S.px=Math.max(-lim,Math.min(lim,S.px));S.py=Math.max(-lim,Math.min(lim,S.py));
  c.style.transform='translate('+S.px+'px,'+S.py+'px) scale('+S.snapZ+')';
}
function showSnap(source){
  const long=Math.max(source.width,source.height),sc=long>MAX_EDGE?MAX_EDGE/long:1;
  const o=document.createElement('canvas');
  o.width=Math.round(source.width*sc);o.height=Math.round(source.height*sc);
  o.getContext('2d').drawImage(source,0,0,o.width,o.height);
  S.orig=o;S.snapZ=1;S.px=S.py=0;S.snapHc=document.getElementById('camBox').classList.contains('cam-hc');
  $('snapWrap').classList.remove('hidden');
  renderSnap();
  $('snapWrap').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function capture(){
  const v=$('cam');
  if(!S.stream||!v.videoWidth){msg('Walang live na kamera. Buksan ang kamera muna, o gamitin ang "Gumamit ng larawan".');return}
  const vw=v.videoWidth,vh=v.videoHeight,css=Math.max(1,S.zoom/S.hwApplied);
  const sw=vw/css,sh=vh/css,sx=(vw-sw)/2,sy=(vh-sh)/2; // center-crop = canvas digital zoom fallback
  const c=document.createElement('canvas');c.width=Math.round(sw);c.height=Math.round(sh);
  c.getContext('2d').drawImage(v,sx,sy,sw,sh,0,0,c.width,c.height);
  showSnap(c);
}
function fromFile(file){
  if(!file)return;
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{showSnap(img.naturalWidth?(()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);return c})():img);URL.revokeObjectURL(url)};
  img.onerror=()=>{msg('Hindi mabasa ang larawan. Subukan ang JPG o PNG.');URL.revokeObjectURL(url)};
  img.src=url;
}
function save(){
  const c=$('snapCanvas');if(!c)return;
  c.toBlob(b=>{if(!b)return;const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='hallmark.jpg';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000)},'image/jpeg',.92);
}
function wirePan(){
  const box=$('snapView');if(!box)return;
  let drag=null;
  box.addEventListener('pointerdown',e=>{drag={x:e.clientX-S.px,y:e.clientY-S.py};try{box.setPointerCapture(e.pointerId)}catch{}});
  box.addEventListener('pointermove',e=>{if(!drag)return;S.px=e.clientX-drag.x;S.py=e.clientY-drag.y;applyPan()});
  const end=()=>{drag=null};
  box.addEventListener('pointerup',end);box.addEventListener('pointercancel',end);
}

export function initScanner(){
  $('camStart').onclick=startCamera;
  $('camStop').onclick=()=>{stopCamera();msg('Sarado ang kamera.')};
  [1,2,4].forEach(n=>$('z'+n).onclick=()=>setZoom(n));
  $('hc').onclick=()=>{const on=$('camBox').classList.toggle('cam-hc');$('hc').setAttribute('aria-pressed',String(on))};
  $('gr').onclick=()=>{const g=$('camBox').querySelector('.loupe-grid');g.hidden=!g.hidden;$('gr').setAttribute('aria-pressed',String(!g.hidden))};
  $('snap').onclick=capture;
  $('camFile').onchange=e=>{fromFile(e.target.files&&e.target.files[0]);e.target.value=''};
  [1,2,4,8].forEach(n=>$('sz'+n).onclick=()=>{S.snapZ=n;if(n===1){S.px=S.py=0}renderSnap()});
  $('snapHc').onclick=()=>{S.snapHc=!S.snapHc;renderSnap()};
  $('snapSave').onclick=save;
  $('snapClose').onclick=()=>{$('snapWrap').classList.add('hidden');S.orig=null};
  wirePan();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.stream){stopCamera();msg('Naka-pause ang kamera. Pindutin ang "Buksan ang kamera" ulit.')}});
  window.addEventListener('pagehide',stopCamera);
  if(!supported())msg('Hindi available ang live na kamera dito (kailangan ng HTTPS). Gamitin ang "Gumamit ng larawan".');
}
