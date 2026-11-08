// Icon generator used by the ZIP export as a safety net: if an icon file can't be fetched or isn't a valid PNG,
// it is redrawn on a canvas (plain drawing calls, no SVG decoding, which is unreliable on Safari) and verified.
// The files in icons/ always win; this only fills gaps.
const BG='#0f172a';

// Artwork lives in a 512 box. Maskable icons keep it inside the 80% safe zone (scaled 0.72 about its own centre).
export function drawIcon(ctx,size,{maskable=false}={}){
  const k=size/512,s=maskable?0.72:1;
  const X=x=>(maskable?(x-256)*s+256:x)*k;
  const Y=y=>(maskable?(y-284)*s+256:y)*k;
  ctx.fillStyle=BG;ctx.fillRect(0,0,size,size);
  ctx.fillStyle='#fbbf24';ctx.beginPath();
  ctx.moveTo(X(96),Y(330));ctx.lineTo(X(190),Y(190));ctx.lineTo(X(322),Y(190));ctx.lineTo(X(416),Y(330));ctx.closePath();ctx.fill();
  ctx.strokeStyle=BG;ctx.lineWidth=14*k*s;ctx.lineJoin='round';ctx.beginPath();
  ctx.moveTo(X(190),Y(190));ctx.lineTo(X(256),Y(330));ctx.lineTo(X(322),Y(190));ctx.stroke();
  ctx.fillStyle='#d97706';ctx.beginPath();
  const x=X(96),y=Y(344),w=320*k*s,h=34*k*s,r=6*k*s;
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.fill();
}
function toBlob(c){
  return new Promise(res=>{
    const viaData=()=>{try{const b=atob(c.toDataURL('image/png').split(',')[1]),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);res(new Blob([u],{type:'image/png'}))}catch{res(null)}};
    if(c.toBlob)c.toBlob(b=>b?res(b):viaData(),'image/png');else viaData();
  });
}
async function verify(blob,size){
  if(!blob||blob.size<200)return false;
  const sig=new Uint8Array(await blob.slice(0,8).arrayBuffer());
  if(![0x89,0x50,0x4E,0x47].every((v,i)=>sig[i]===v))return false;
  return new Promise(res=>{
    const u=URL.createObjectURL(blob),img=new Image();
    img.onload=()=>{URL.revokeObjectURL(u);res(img.naturalWidth===size&&img.naturalHeight===size)};
    img.onerror=()=>{URL.revokeObjectURL(u);res(false)};
    img.src=u;
  });
}
// Returns a verified PNG Blob of the requested size, or throws.
export async function makeIcon(size,opts={}){
  const c=document.createElement('canvas');c.width=c.height=size;
  drawIcon(c.getContext('2d'),size,opts);
  const blob=await toBlob(c);
  if(!(await verify(blob,size)))throw new Error('icon '+size+(opts.maskable?' maskable':'')+' invalid');
  return blob;
}
// Adds <link rel="icon"> only if the page doesn't already declare one.
export function setFavicon(){
  if(document.querySelector('link[rel="icon"]'))return;
  const l=document.createElement('link');l.rel='icon';l.type='image/svg+xml';l.href='icons/icon.svg';document.head.appendChild(l);
}
