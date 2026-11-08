// Digital loupe: live camera with graceful fallbacks + a DPR-aware snapshot loupe.
const $=id=>document.getElementById(id);
const MAX_EDGE=3072;                    // keeps canvases under iOS memory limits
const S={stream:null,track:null,token:0,zoom:1,hw:null,hwApplied:1,torchOn:false,
  orig:null,enh:null,hc:false,z:1,cx:0,cy:0,ac:null};
const G=new AbortController();          // global listeners, removed by destroyScanner()

const ERRORS={
  InsecureContext:'Kailangan ng HTTPS ang kamera. Buksan ang app sa https://esp046-cyber.github.io/gintonggabay/.',
  NotAllowedError:'Na-block ang camera permission. Sa iPhone: Settings > Safari > Camera > Allow, tapos i-reload ang page.',
  SecurityError:'Na-block ang kamera ng browser. Siguraduhing HTTPS at payagan ang permission.',
  NotFoundError:'Walang nakitang kamera sa device na ito.',
  NotReadableError:'Ginagamit ng ibang app ang kamera. Isara ang ibang app at subukan ulit.',
  OverconstrainedError:'Hindi sinusuportahan ng kamera ang hiniling na setting.',
  AbortError:'Naputol ang pagbubukas ng kamera. Subukan ulit.'
};
const msg=t=>{const m=$('camMsg');if(m)m.textContent=t};
const supported=()=>window.isSecureContext&&navigator.mediaDevices&&typeof navigator.mediaDevices.getUserMedia==='function';
const press=(id,on)=>{const b=$(id);if(b)b.setAttribute('aria-pressed',String(!!on))};

/* ---------- live camera ---------- */
async function openStream(){
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
function release(st){
  if(!st)return;
  st.getTracks().forEach(t=>{try{t.onended=null;t.stop()}catch{}});
}
function caps(){try{return S.track&&S.track.getCapabilities?S.track.getCapabilities():{}}catch{return{}}}
function setTorchUi(state,title){ // state: off | on | unsupported
  const b=$('torch');if(!b)return;
  b.disabled=state==='unsupported'||!S.stream;
  b.setAttribute('aria-pressed',String(state==='on'));
  b.title=title||(state==='unsupported'?'Hindi suportado ng device na ito':'I-on o i-off ang flashlight');
}
async function setZoom(z){
  S.zoom=z;
  let hwZ=1;
  const c=caps();
  S.hw=c.zoom&&Number.isFinite(c.zoom.max)&&c.zoom.max>(c.zoom.min||1)?{min:c.zoom.min||1,max:c.zoom.max}:null;
  if(S.hw&&S.track){
    hwZ=Math.min(Math.max(z,S.hw.min),S.hw.max);
    try{await S.track.applyConstraints({advanced:[{zoom:hwZ}]})}catch{hwZ=1;S.hw=null}
  }
  S.hwApplied=hwZ;
  const v=$('cam');if(v)v.style.transform='scale('+(z/hwZ)+')';
  [1,2,4].forEach(n=>press('z'+n,n===z));
  const l=$('zoomMode');if(l)l.textContent=S.stream?(S.hw?'Zoom: hardware + digital':'Zoom: digital (CSS/canvas)'):'';
}
// Fully releases the camera so the hardware indicator turns off. Bumping the token also cancels any start still in flight.
export function stopCamera(){
  S.token++;
  const st=S.stream;
  if(st&&S.torchOn&&S.track){try{S.track.applyConstraints({advanced:[{torch:false}]})}catch{}}
  S.torchOn=false;
  release(st);S.stream=null;S.track=null;S.hw=null;
  const v=$('cam');
  if(v){try{v.pause()}catch{}v.srcObject=null;v.removeAttribute('src');try{v.load()}catch{}v.style.transform='none'}
  const l=$('zoomMode');if(l)l.textContent='';
  setTorchUi('off');
}
async function startCamera(){
  stopCamera();
  const my=S.token;
  msg('Binubuksan ang kamera...');
  try{
    if(!supported()){const e=new Error('insecure');e.name='InsecureContext';throw e}
    const st=await openStream();
    if(my!==S.token){release(st);return}                 // user left the tab / pressed stop meanwhile
    S.stream=st;S.track=st.getVideoTracks()[0];
    S.track.onended=()=>{if(my===S.token){stopCamera();msg('Naputol ang kamera. Pindutin ulit ang "Buksan ang kamera".')}};
    const v=$('cam');
    v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.muted=true;
    v.srcObject=st;
    try{await v.play()}catch{}
    if(my!==S.token){stopCamera();return}
    await setZoom(S.zoom);
    const c=caps(),known=c&&Object.keys(c).length>0;
    if(known&&!('torch' in c))setTorchUi('unsupported','Walang flashlight support ang browser/kamerang ito (hal. iOS Safari)');
    else setTorchUi('off');
    let facing='';try{facing=S.track.getSettings().facingMode||''}catch{}
    msg(facing==='user'?'Front camera lang ang nabuksan. Para sa mas malinaw, gamitin ang "Gumamit ng larawan".':'Bukas ang kamera. Ilapit sa stamp, mag-zoom, tapos pindutin ang "Kuhanan".');
  }catch(e){
    if(my===S.token)stopCamera();
    msg((ERRORS[e.name]||('Hindi mabuksan ang kamera ('+(e.name||'error')+').'))+' Puwede ring "Gumamit ng larawan".');
    const f=$('camFileBtn');if(f)f.focus();
  }
}
async function toggleTorch(){
  if(!S.track)return;
  const next=!S.torchOn;
  try{
    await S.track.applyConstraints({advanced:[{torch:next}]});
    S.torchOn=next;setTorchUi(next?'on':'off');
  }catch{
    S.torchOn=false;setTorchUi('unsupported','Hindi suportado ng device na ito');
    msg('Walang flashlight control ang device/browser na ito. Gumamit ng ilaw ng tindahan o ng ibang phone.');
  }
}

/* ---------- snapshot loupe (canvas, DPR-aware) ---------- */
function enhanceCopy(src){
  const c=document.createElement('canvas');c.width=src.width;c.height=src.height;
  const ctx=c.getContext('2d');ctx.drawImage(src,0,0);
  const img=ctx.getImageData(0,0,c.width,c.height),d=img.data;
  for(let i=0;i<d.length;i+=4){ // manual grayscale+contrast; ctx.filter is unsupported on iOS Safari
    const g=.299*d[i]+.587*d[i+1]+.114*d[i+2];
    d[i]=d[i+1]=d[i+2]=Math.max(0,Math.min(255,(g-128)*1.9+138));
  }
  ctx.putImageData(img,0,0);return c;
}
function view(){
  const c=$('snapCanvas'),box=$('snapView');
  const dpr=Math.min(window.devicePixelRatio||1,3);
  const cw=Math.max(1,Math.round(box.clientWidth*dpr)),ch=Math.max(1,Math.round(box.clientHeight*dpr));
  return{c,dpr,cw,ch};
}
function geometry(cw,ch){
  const o=S.orig,base=Math.min(cw/o.width,ch/o.height),k=base*S.z;
  const sw=cw/k,sh=ch/k;
  S.cx=sw<o.width?Math.min(Math.max(S.cx,sw/2),o.width-sw/2):o.width/2;
  S.cy=sh<o.height?Math.min(Math.max(S.cy,sh/2),o.height-sh/2):o.height/2;
  let sx=S.cx-sw/2,sy=S.cy-sh/2,ssw=sw,ssh=sh,dx=0,dy=0,dw=cw,dh=ch;
  if(sx<0){dx=-sx*k;dw-=dx;ssw+=sx;sx=0}
  if(sx+ssw>o.width){const x=sx+ssw-o.width;dw-=x*k;ssw-=x}
  if(sy<0){dy=-sy*k;dh-=dy;ssh+=sy;sy=0}
  if(sy+ssh>o.height){const y=sy+ssh-o.height;dh-=y*k;ssh-=y}
  return{k,sx,sy,ssw,ssh,dx,dy,dw,dh};
}
function render(){
  if(!S.orig)return;
  const{c,cw,ch}=view();
  if(c.width!==cw)c.width=cw;if(c.height!==ch)c.height=ch;   // backing store = CSS size x devicePixelRatio
  const ctx=c.getContext('2d'),g=geometry(cw,ch);
  ctx.fillStyle='#000';ctx.fillRect(0,0,cw,ch);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  if(S.hc&&!S.enh)S.enh=enhanceCopy(S.orig);
  const src=S.hc?S.enh:S.orig;
  if(g.ssw>0&&g.ssh>0)ctx.drawImage(src,g.sx,g.sy,g.ssw,g.ssh,g.dx,g.dy,g.dw,g.dh);
  press('snapHc',S.hc);[1,2,4,8].forEach(n=>press('sz'+n,n===S.z));
}
function openSnap(source){
  closeSnap(true);
  const long=Math.max(source.width,source.height),sc=long>MAX_EDGE?MAX_EDGE/long:1;
  const o=document.createElement('canvas');o.width=Math.round(source.width*sc);o.height=Math.round(source.height*sc);
  o.getContext('2d').drawImage(source,0,0,o.width,o.height);
  S.orig=o;S.enh=null;S.z=1;S.cx=o.width/2;S.cy=o.height/2;
  S.hc=$('camBox').classList.contains('cam-hc');
  $('snapWrap').classList.remove('hidden');
  // listeners are scoped to one AbortController so closing the loupe removes them all (no leaks)
  S.ac=new AbortController();const opt={signal:S.ac.signal};
  const box=$('snapView');let drag=null;
  box.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};try{box.setPointerCapture(e.pointerId)}catch{}},opt);
  box.addEventListener('pointermove',e=>{
    if(!drag||!S.orig)return;
    const{dpr,cw,ch}=view(),k=Math.min(cw/S.orig.width,ch/S.orig.height)*S.z;
    S.cx-=(e.clientX-drag.x)*dpr/k;S.cy-=(e.clientY-drag.y)*dpr/k;drag={x:e.clientX,y:e.clientY};render();
  },opt);
  const end=e=>{drag=null;try{box.releasePointerCapture(e.pointerId)}catch{}};
  box.addEventListener('pointerup',end,opt);box.addEventListener('pointercancel',end,opt);
  box.addEventListener('touchmove',e=>e.preventDefault(),{passive:false,signal:S.ac.signal}); // iOS: stop page scroll while panning
  window.addEventListener('resize',render,opt);window.addEventListener('orientationchange',render,opt);
  render();
  $('snapWrap').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeSnap(keepVisible){
  if(S.ac){S.ac.abort();S.ac=null}
  S.orig=null;S.enh=null;
  const c=$('snapCanvas');if(c){c.width=0;c.height=0}         // release canvas memory
  if(!keepVisible){const w=$('snapWrap');if(w)w.classList.add('hidden')}
}
function capture(){
  const v=$('cam');
  if(!S.stream||!v.videoWidth){msg('Walang live na kamera. Buksan ang kamera muna, o gamitin ang "Gumamit ng larawan".');return}
  const vw=v.videoWidth,vh=v.videoHeight,css=Math.max(1,S.zoom/S.hwApplied);
  const sw=vw/css,sh=vh/css,sx=(vw-sw)/2,sy=(vh-sh)/2;          // native-resolution center crop = canvas zoom fallback
  const c=document.createElement('canvas');c.width=Math.round(sw);c.height=Math.round(sh);
  c.getContext('2d').drawImage(v,sx,sy,sw,sh,0,0,c.width,c.height);
  openSnap(c);
}
function fromFile(file){
  if(!file)return;
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
    c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);openSnap(c);
  };
  img.onerror=()=>{msg('Hindi mabasa ang larawan. Subukan ang JPG o PNG.');URL.revokeObjectURL(url)};
  img.src=url;
}
function save(){ // exports the visible region at source (native) resolution, not screen resolution
  if(!S.orig)return;
  const{cw,ch}=view(),g=geometry(cw,ch);
  const out=document.createElement('canvas');out.width=Math.max(1,Math.round(g.ssw));out.height=Math.max(1,Math.round(g.ssh));
  out.getContext('2d').drawImage(S.hc&&S.enh?S.enh:S.orig,g.sx,g.sy,g.ssw,g.ssh,0,0,out.width,out.height);
  out.toBlob(b=>{
    if(!b)return;
    const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='hallmark.jpg';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);out.width=out.height=0;
  },'image/jpeg',.92);
}

export function destroyScanner(){stopCamera();closeSnap();G.abort()}
export function initScanner(){
  $('camStart').onclick=startCamera;
  $('camStop').onclick=()=>{stopCamera();msg('Sarado ang kamera.')};
  [1,2,4].forEach(n=>$('z'+n).onclick=()=>setZoom(n));
  $('torch').onclick=toggleTorch;setTorchUi('off');
  $('hc').onclick=()=>{const on=$('camBox').classList.toggle('cam-hc');press('hc',on)};
  $('gr').onclick=()=>{const g=$('camBox').querySelector('.loupe-grid');g.hidden=!g.hidden;press('gr',!g.hidden)};
  $('snap').onclick=capture;
  $('camFile').onchange=e=>{fromFile(e.target.files&&e.target.files[0]);e.target.value=''};
  [1,2,4,8].forEach(n=>$('sz'+n).onclick=()=>{S.z=n;if(n===1){S.cx=S.orig?S.orig.width/2:0;S.cy=S.orig?S.orig.height/2:0}render()});
  $('snapHc').onclick=()=>{S.hc=!S.hc;render()};
  $('snapSave').onclick=save;
  $('snapClose').onclick=()=>closeSnap(false);
  // Any way the page can lose focus: release the camera so the indicator light turns off.
  const kill=()=>{if(S.stream){stopCamera();msg('Naka-pause ang kamera. Pindutin ulit ang "Buksan ang kamera".')}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden)kill()},{signal:G.signal});
  window.addEventListener('pagehide',()=>{stopCamera()},{signal:G.signal});
  window.addEventListener('blur',kill,{signal:G.signal});
  if(!supported())msg('Hindi available ang live na kamera dito (kailangan ng HTTPS). Gamitin ang "Gumamit ng larawan".');
}
