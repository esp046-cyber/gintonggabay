import {calc,STONES,customsCheck,CUSTOMS} from './calculator.js';
import {initScanner,stopCamera} from './scanner.js';
import {makeIcon,setFavicon} from './icons-gen.js';

const $=id=>document.getElementById(id);
const KARATS=[24,22,21,18];
const DEFAULT_RATES={24:480,22:440,21:420,18:360}; // placeholders: edit to today's DGJG board rate
const DEFAULT_FX=15.5;

// localStorage with in-memory fallback (private mode / blocked storage)
const mem={};
const store={
  get(k,d){try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v)}catch{}return k in mem?mem[k]:d},
  set(k,v){mem[k]=v;try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}}
};
const posNum=(v,d)=>Number.isFinite(+v)&&+v>0?+v:d;

const state={
  rates:(()=>{const s=store.get('rates',{});const r={};KARATS.forEach(k=>r[k]=posNum(s&&s[k],DEFAULT_RATES[k]));return r})(),
  fx:posNum(store.get('fx',DEFAULT_FX),DEFAULT_FX),
  stamp:store.get('ratesStamp',null)
};
const fmt=(n,d=2)=>(Number.isFinite(n)?n:0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});

/* ---------- Icons with fallback ---------- */
function renderIcons(){
  try{if(window.lucide&&lucide.createIcons)lucide.createIcons()}catch{}
  // Any <i data-lucide> still present was not replaced by an SVG: show its fallback text.
  document.querySelectorAll('i[data-lucide]').forEach(el=>{
    if(!el.querySelector('svg')&&!el.textContent.trim()){el.textContent=el.dataset.fb||'•';el.classList.add('text-base','leading-none','not-italic')}
  });
}

/* ---------- Rates (persistent) ---------- */
function renderRates(){
  KARATS.forEach(k=>{$('r'+k).value=state.rates[k]});
  $('fx').value=state.fx;
  $('stamp').textContent=state.stamp?('Na-save: '+new Date(state.stamp).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'})):'Placeholder pa ang rates. I-update ayon sa DGJG board ngayon.';
  $('stamp').className='text-xs '+(state.stamp?'text-slate-400':'text-amber-300');
}
function readRates(){
  KARATS.forEach(k=>{state.rates[k]=posNum($('r'+k).value,state.rates[k])});
  state.fx=posNum($('fx').value,state.fx);
  state.stamp=Date.now();
  store.set('rates',state.rates);store.set('fx',state.fx);store.set('ratesStamp',state.stamp);
  renderRates0();runCalc();runCustoms();
}
function renderRates0(){ // refresh stamp text only (do not overwrite what the user is typing)
  $('stamp').textContent='Na-save: '+new Date(state.stamp).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
  $('stamp').className='text-xs text-slate-400';
}
function resetRates(){
  if(!confirm('Ibalik ang rates sa placeholder values?'))return;
  state.rates={...DEFAULT_RATES};state.fx=DEFAULT_FX;state.stamp=null;
  store.set('rates',state.rates);store.set('fx',state.fx);store.set('ratesStamp',null);
  renderRates();runCalc();runCustoms();
}

/* ---------- Calculator ---------- */
function loadCalcInputs(){
  const s=store.get('calc',{});
  $('gross').value=s.gross??'20.86';$('karat').value=s.karat??'18';$('stone').value=STONES[s.stone]?s.stone:'malachite';$('making').value=s.making??'25';
}
function runCalc(){
  const inp={gross:$('gross').value,karat:$('karat').value,stone:$('stone').value,making:$('making').value};
  store.set('calc',inp);
  const r=calc({...inp,rates:state.rates,fx:state.fx});
  const out=$('out');
  if(!r.valid){out.innerHTML='<p class="text-slate-300">Ilagay ang bigat (g) at siguraduhing may rate ang napiling karat.</p>';return}
  const good=r.loss<15;
  const row=(a,b)=>`<div class="flex items-start justify-between gap-3 border-b border-dashed border-slate-700 py-2 last:border-0"><span class="text-slate-300">${a}</span><b class="text-right text-slate-50">${b}</b></div>`;
  out.innerHTML=
    row('Gross cost (rate + upah)',`${fmt(r.grossCost)} AED<br><span class="font-medium text-amber-300">₱${fmt(r.grossPHP,0)}</span>`)+
    row('Stone penalty (tinatanggal)',`−${fmt(r.stoneG)} g`)+
    row('Net gold weight',`${fmt(r.net)} g`)+
    row('Real-world sangla value (~92% scrap)',`${fmt(r.pawn)} AED<br><span class="font-medium text-amber-300">₱${fmt(r.pawnPHP,0)}</span>`)+
    `<div class="mt-3 rounded-xl border-l-4 p-3 ${good?'border-emerald-400 bg-emerald-950/60':'border-rose-400 bg-rose-950/60'}"><p class="text-lg font-bold ${good?'text-emerald-300':'text-rose-300'}">Lugi Alert: ${fmt(r.loss,1)}%</p><p class="text-sm text-slate-200">Kung isasangla agad, mawawala ang ${fmt(r.lossAED)} AED (₱${fmt(r.lossPHP,0)}). ${good?'Maliit ang lugi; okay bilang ipon.':'Malaki ito dahil sa upah at/o bato. Pang-suot ito, hindi pang-emergency fund.'}</p></div>
     <p class="mt-2 text-xs text-slate-400">Pagtatantya lang. Average ang stone %, at iba-iba ang presyo ng pawnshop.</p>`;
}

/* ---------- Checklist ---------- */
const CHECKS=[
 ['Tare zero','Siguraduhing 0.00 g ang timbangan bago ilagay ang gold, at walang nakadikit sa tray.'],
 ['DGJG itemized receipt','Dapat nakahiwalay ang gold rate, upah, VAT, at bigat ng bawat piraso.'],
 ['DCL / Bareeq check','Hanapin ang hallmark at certificate. Itanong kung registered ang tindahan sa Dubai Central Laboratory.'],
 ['VAT Planet sticker/slip','Hingin ang Planet Tax Free tag kung eligible bilang turista. Hindi ito para sa mga residente.'],
 ['Magnet test','Hindi dumidikit ang tunay na gold sa magnet. Hindi ito sapat na patunay, pero nakakatanggal ng pekeng bakal.']];
function renderChecks(){
  const saved=store.get('checks',[]);
  $('checks').innerHTML=CHECKS.map((c,i)=>`<div class="flex items-start gap-3 border-b border-dashed border-slate-700 py-3 last:border-0"><input type="checkbox" id="c${i}" class="mt-1 h-6 w-6 shrink-0 accent-amber-400" ${saved.includes(i)?'checked':''}><label for="c${i}" class="text-slate-100">${c[0]}<small class="block text-sm text-slate-400">${c[1]}</small></label></div>`).join('');
  const upd=()=>{const on=CHECKS.map((_,i)=>$('c'+i).checked?i:-1).filter(i=>i>=0);store.set('checks',on);$('meter').style.width=on.length/CHECKS.length*100+'%';$('score').textContent=on.length+' sa '+CHECKS.length+' ang na-check'};
  CHECKS.forEach((_,i)=>$('c'+i).onchange=upd);upd();
}

/* ---------- Customs value check ---------- */
const CMSG={
  deminimis:['ok','Hindi lalampas sa PHP 10,000, kaya walang duties at taxes ayon sa Sec. 423 CMTA. Ideklara pa rin ang alahas sa eTravel, at tiyaking may malinaw na fineness mark ang bawat piraso.'],
  exempt:['warn','Lampas sa PHP 10,000 pero hindi lalampas sa PHP 150,000. Maaaring sakop ng exemption ng mga Pilipino para sa personal effects (hanggang 3 beses kada taon) kung hindi commercial. Ideklara at itago ang resibo.'],
  over:['bad','Lampas sa PHP 150,000. Asahan ang pagtatasa ng duties at taxes. Ideklara ito at kausapin ang BOC officer sa NAIA.'],
  commercial:['bad','Maaaring ituring na commercial (bar, maraming magkakaparehong piraso, pang-benta). Hindi ito sakop ng personal exemption at maaaring buwisan. Ideklara at magtanong sa BOC bago bumiyahe.']
};
function runCustoms(){
  const v=$('cval').value,commercial=$('cmode').value==='commercial';
  store.set('customs',{v,m:$('cmode').value});
  const r=customsCheck({valueAED:v,fx:state.fx,commercial});
  const [lvl,text]=CMSG[r.key];
  const cls={ok:'border-emerald-400 bg-emerald-950/60',warn:'border-amber-400 bg-amber-950/50',bad:'border-rose-400 bg-rose-950/60'}[lvl];
  $('cout').className='mt-3 rounded-xl border-l-4 p-3 text-sm text-slate-100 '+cls;
  $('cout').innerHTML=`<b class="block text-base">Tinatayang halaga: ₱${fmt(r.php,0)}</b>${text}`;
}

/* ---------- Tabs ---------- */
const TABS=['calc','scan','roi','travel'];
function tabs(){
  const go=id=>{
    document.querySelectorAll('section[data-sec]').forEach(s=>s.classList.toggle('on',s.id===id));
    document.querySelectorAll('.tab').forEach(t=>{const on=t.dataset.t===id;t.setAttribute('aria-selected',String(on));t.classList.toggle('text-amber-400',on);t.classList.toggle('text-slate-400',!on);t.classList.toggle('border-amber-400',on);t.classList.toggle('border-transparent',!on)});
    if(id!=='scan')stopCamera();
    try{if(location.hash!=='#'+id)history.replaceState(null,'','#'+id)}catch{}
    window.scrollTo({top:0});
  };
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>go(t.dataset.t));
  const h=location.hash.slice(1);go(TABS.includes(h)?h:'calc');
}

/* ---------- ZIP export ---------- */
async function downloadZip(){
  const btn=$('zipBtn'),label='I-download ang Project ZIP';
  if(typeof JSZip==='undefined'){btn.textContent='Hindi na-load ang JSZip. Kailangan ng internet sa unang bukas.';setTimeout(()=>btn.textContent=label,4000);return}
  btn.disabled=true;btn.textContent='Ginagawa ang ZIP...';
  try{
    const files=['index.html','manifest.webmanifest','sw.js','offline.html','css/styles.css','js/app.js','js/calculator.js','js/scanner.js','js/icons-gen.js','icons/icon.svg'];
    const root=new JSZip().folder('gintonggabay');
    for(const f of files){const r=await fetch(f);if(!r.ok)throw new Error(f);root.file(f,await r.blob())}
    root.file('icons/icon-192.png',await makeIcon(192));root.file('icons/icon-512.png',await makeIcon(512));
    const blob=await root.generateAsync({type:'blob'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='gintonggabay.zip';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    btn.textContent='Na-download na ang ZIP';
  }catch(e){btn.textContent='Nabigo ('+e.message+'). Subukan ulit.'}
  finally{btn.disabled=false;setTimeout(()=>btn.textContent=label,4000)}
}

function netBadge(){
  const set=()=>{const on=navigator.onLine;$('net').textContent=on?'Online':'Offline';$('net').className='rounded-full px-2 py-0.5 text-xs font-medium '+(on?'bg-emerald-900 text-emerald-300':'bg-slate-700 text-amber-300')};
  window.addEventListener('online',set);window.addEventListener('offline',set);set();
}

function init(){
  setFavicon();
  $('stone').innerHTML=Object.entries(STONES).map(([k,v])=>`<option value="${k}">${v.n}${v.p?` (~${Math.round(v.p*100)}%)`:''}</option>`).join('');
  renderRates();loadCalcInputs();
  const c=store.get('customs',{v:'3000',m:'personal'});$('cval').value=c.v??'3000';$('cmode').value=c.m||'personal';
  [...KARATS.map(k=>'r'+k),'fx'].forEach(i=>{$(i).addEventListener('input',readRates);$(i).addEventListener('change',readRates)});
  $('resetRates').onclick=resetRates;
  ['gross','karat','stone','making'].forEach(i=>$(i).addEventListener('input',runCalc));
  ['cval','cmode'].forEach(i=>$(i).addEventListener('input',runCustoms));
  runCalc();runCustoms();renderChecks();tabs();initScanner();netBadge();
  $('zipBtn').onclick=downloadZip;
  renderIcons();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js',{scope:'./'}).catch(()=>{});
}
init();
