/* GintongGabay service worker.
   Every URL is resolved against the SW scope, so it works at
   https://esp046-cyber.github.io/gintonggabay/ and on localhost without 404s.
   Live-rate API calls (gold-api.com, open.er-api.com, jsDelivr data) are NOT intercepted. */
const CACHE='gintonggabay-v5';
const CORE=['./','index.html','offline.html','manifest.webmanifest','css/styles.css','js/app.js','js/calculator.js','js/scanner.js','js/icons-gen.js','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-192.png','icons/icon-maskable-512.png'];
const CDN=['https://cdn.tailwindcss.com/3.4.17','https://cdn.jsdelivr.net/npm/lucide@0.469.0/dist/umd/lucide.min.js','https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'];
const rel=p=>new URL(p,self.registration.scope).href;

// addAll is atomic (one 404 rejects everything), so on failure retry each URL on its own and swallow individual errors.
async function precache(cache,reqs){
  try{await cache.addAll(reqs)}
  catch{await Promise.all(reqs.map(r=>cache.add(r).catch(()=>{})))}
}
self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    await precache(c,CORE.map(p=>new Request(rel(p),{cache:'reload'})));
    // CDN scripts are cross-origin: cache as opaque responses, each one optional.
    await Promise.all(CDN.map(u=>fetch(new Request(u,{mode:'no-cors'})).then(r=>c.put(u,r)).catch(()=>{})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('gintonggabay-')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
function timeout(ms,p){return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('timeout')),ms);p.then(v=>{clearTimeout(t);res(v)},err=>{clearTimeout(t);rej(err)})})}
async function networkFirst(req){
  const c=await caches.open(CACHE);
  try{
    const r=await timeout(4000,fetch(req));
    if(r&&r.ok)c.put(req,r.clone());
    return r;
  }catch{
    const hit=await c.match(req,{ignoreSearch:true});
    if(hit)return hit;
    if(req.mode==='navigate')return (await c.match(rel('index.html')))||(await c.match(rel('offline.html')))||Response.error();
    return Response.error();
  }
}
async function cacheFirst(req){
  const c=await caches.open(CACHE);
  const hit=await c.match(req);
  const refresh=fetch(req).then(r=>{if(r&&(r.ok||r.type==='opaque'))c.put(req,r.clone());return r}).catch(()=>null);
  return hit||(await refresh)||Response.error();
}
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin===self.location.origin)e.respondWith(networkFirst(req));
  else if(CDN.includes(req.url))e.respondWith(cacheFirst(req));
});
