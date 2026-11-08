import {calc,parseNum,STONES,LTV,BAR_PRESETS,CUSTOMS,fmtNum,fmtAED,fmtPHP,barValue,customsCheck,cashCheck,ratesFromSpot24,aedPerGramFromUsdOz,parseGoldResponse,parseFxResponse} from './calculator.js';
import {initScanner,stopCamera} from './scanner.js';
import {makeIcon,setFavicon} from './icons-gen.js';

const $=id=>document.getElementById(id);
const KARATS=[24,22,21,18];
const DEFAULT_RATES={24:480,22:440,21:420,18:360};   // placeholders: replace with today's DGJG board rate
const DEFAULT_FX=15.5;
const DAY=864e5;
const FOUR_HOURS=4*36e5,FETCH_TIMEOUT=6000;
const GOLD_URL='https://api.gold-api.com/price/XAU';           // keyless; USD per troy ounce
const FX_URLS=['https://open.er-api.com/v6/latest/AED','https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/aed.json'];

/* ---------- storage: localStorage with memory fallback and 300 ms debounced saves ---------- */
const mem={},timers={};
const rawGet=(k,d)=>{try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v)}catch{}return k in mem?mem[k]:d};
const rawSet=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
const store={
  get:rawGet,
  set(k,v){mem[k]=v;rawSet(k,v)},
  save(k,v,ms=300){mem[k]=v;clearTimeout(timers[k]);timers[k]=setTimeout(()=>{delete timers[k];rawSet(k,v)},ms)},
  flush(){Object.keys(timers).forEach(k=>{clearTimeout(timers[k]);delete timers[k];rawSet(k,mem[k])})}
};

/* ---------- inline validation helpers ---------- */
function errEl(id){
  let e=$('e-'+id);
  if(!e){
    const inp=$(id);e=document.createElement('p');e.id='e-'+id;e.className='err';e.setAttribute('role','alert');e.hidden=true;
    inp.insertAdjacentElement('afterend',e);inp.setAttribute('aria-describedby',e.id);
  }
  return e;
}
function setErr(id,message){
  const inp=$(id),e=errEl(id);
  e.hidden=!message;e.textContent=message||'';
  inp.classList.toggle('is-bad',!!message);inp.setAttribute('aria-invalid',String(!!message));
}
function field(id,opts){const r=parseNum($(id).value,opts);setErr(id,r.ok?null:r.error);return r}

/* ---------- state ---------- */
const sane=(v,d)=>Number.isFinite(+v)&&+v>0?+v:d;
const state={
  rates:(()=>{const s=store.get('rates',{})||{},r={};KARATS.forEach(k=>r[k]=sane(s[k],DEFAULT_RATES[k]));return r})(),
  fx:sane(store.get('fx',DEFAULT_FX),DEFAULT_FX),
  stamp:Number.isFinite(+store.get('ratesStamp',null))&&store.get('ratesStamp',null)?+store.get('ratesStamp',null):null
};
state.source=['live','manual','default'].includes(store.get('ratesSource',null))?store.get('ratesSource',null):(state.stamp?'manual':'default');
state.liveStamp=Number.isFinite(+store.get('liveStamp',null))&&store.get('liveStamp',null)?+store.get('liveStamp',null):null;
state.status=state.source==='live'?(navigator.onLine?'live':'offline'):state.source;   // live | partial | offline | manual | default
state.note='';
let lastCopy='';

/* ---------- icons (decorative, with text fallback) ---------- */
function renderIcons(){
  document.querySelectorAll('i[data-lucide]').forEach(el=>el.setAttribute('aria-hidden','true'));
  try{if(window.lucide&&lucide.createIcons)lucide.createIcons()}catch{}
  document.querySelectorAll('i[data-lucide]').forEach(el=>{
    if(!el.querySelector('svg')&&!el.textContent.trim()){el.textContent=el.dataset.fb||'•';el.classList.add('not-italic','leading-none')}
  });
}

/* ---------- rates + 24h expiry ---------- */
function ageText(ms){const h=Math.floor(ms/36e5);return h>=48?Math.floor(h/24)+' araw':h+' oras'}
function updateStale(){
  const age=state.stamp?Date.now()-state.stamp:Infinity,stale=age>DAY;
  const b=$('stale');b.hidden=!stale;
  b.querySelector('span').textContent=state.stamp?('Lumang rates: huling na-update '+ageText(age)+' na ang nakalipas. I-check ang DGJG board bago magkalkula.'):'Placeholder pa ang rates. Ilagay ang DGJG board rates ngayon.';
  KARATS.forEach(k=>$('r'+k).parentElement.classList.toggle('stale-rate',stale));
  renderStatus();
  return stale;
}
function renderRates(){
  KARATS.forEach(k=>{const el=$('r'+k);el.value=state.rates[k];el.classList.remove('is-bad');el.removeAttribute('aria-invalid')});
  $('fx').value=state.fx;$('fx').classList.remove('is-bad');$('fx').removeAttribute('aria-invalid');$('rateErr').hidden=true;
}
function commitRates(source){
  state.stamp=Date.now();state.source=source;state.status=source;
  store.save('rates',state.rates);store.save('fx',state.fx);store.save('ratesStamp',state.stamp);store.save('ratesSource',source);
}
function renderStatus(){
  const dot=$('dot'),txt=$('stampTxt');if(!dot||!txt)return;
  const t=ms=>new Date(ms).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'});
  const d=ms=>new Date(ms).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short'});
  let cls,text;
  if(state.status==='live'){cls='bg-emerald-400 animate-pulse';text='Live rates na-update: '+t(state.liveStamp||state.stamp)}
  else if(state.status==='partial'){cls='bg-amber-400';text=state.note}
  else if(state.status==='offline'){cls='bg-amber-400';text=state.source==='default'?'Offline / Placeholder pa ang rates':'Offline / Naka-cache ang rates'+(state.stamp?' · huling update '+d(state.stamp):'')}
  else if(state.status==='manual'){cls='bg-slate-400';text='Manual ang rates · huling update '+d(state.stamp)}
  else{cls='bg-rose-400';text='Placeholder pa ang rates. I-refresh o ilagay ang DGJG board rates.'}
  dot.className='inline-block h-2.5 w-2.5 shrink-0 rounded-full '+cls;
  txt.textContent=text;
}

/* ---------- Live rates: gold-api.com (XAU, USD/oz) + open.er-api.com (AED->PHP) ---------- */
let fetching=false;
function setBusy(b){
  const btn=$('refreshRates');btn.disabled=b;btn.setAttribute('aria-busy',String(b));
  $('spin').classList.toggle('hidden',!b);$('refreshIcon').classList.toggle('hidden',b);
  $('refreshTxt').textContent=b?'Kinukuha...':'I-refresh ang Rates';
}
async function getJSON(url,signal){
  const r=await fetch(url,{signal,cache:'no-store'});          // plain GET, no custom headers: no CORS preflight
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.json();
}
async function fetchGold(signal){
  const usdOz=parseGoldResponse(await getJSON(GOLD_URL,signal));
  if(usdOz==null)throw new Error('Hindi wasto ang gold data');
  return aedPerGramFromUsdOz(usdOz);                           // AED per gram of 24K (AED pegged at 3.6725)
}
async function fetchFx(signal){
  let last=new Error('fx');
  for(const u of FX_URLS){
    try{const p=parseFxResponse(await getJSON(u,signal));if(p)return p;last=new Error('Hindi wasto ang FX data')}
    catch(e){last=e;if(signal.aborted)throw e}
  }
  throw last;
}
export async function fetchLiveRates(){
  if(fetching)return false;
  if(!navigator.onLine){if(state.status!=='default'){state.status='offline'}renderStatus();return false}
  fetching=true;setBusy(true);
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),FETCH_TIMEOUT);   // 6 s hard limit for slow souk signal
  try{
    const [g,f]=await Promise.allSettled([fetchGold(ac.signal),fetchFx(ac.signal)]);
    const goldOk=g.status==='fulfilled',fxOk=f.status==='fulfilled';
    if(fxOk){state.fx=f.value;store.set('fx',state.fx)}
    if(goldOk){
      state.rates=ratesFromSpot24(g.value);state.stamp=Date.now();state.source='live';
      store.set('rates',state.rates);store.set('ratesStamp',state.stamp);store.set('ratesSource','live');
    }
    if(goldOk||fxOk){
      state.liveStamp=Date.now();store.set('liveStamp',state.liveStamp);
      state.status=goldOk&&fxOk?'live':'partial';
      if(!goldOk)state.note='Naka-cache ang gold rates · live lang ang AED→PHP';
      else if(!fxOk)state.note='Live ang gold rates · naka-cache ang AED→PHP';
      renderRates();
    }else state.status='offline';                              // cached rates stay untouched
  }catch{state.status='offline'}
  finally{clearTimeout(timer);fetching=false;setBusy(false);updateStale();runAll()}
  return state.status==='live';
}
const ratesAreOld=()=>!state.stamp||Date.now()-state.stamp>FOUR_HOURS;
function autoFetchIfNeeded(){if(navigator.onLine&&ratesAreOld())fetchLiveRates()}

function readRates(){
  const errs=[],next={...state.rates};
  KARATS.forEach(k=>{
    const el=$('r'+k),r=parseNum(el.value,{allowZero:false,max:1e6});
    el.classList.toggle('is-bad',!r.ok);el.setAttribute('aria-invalid',String(!r.ok));
    if(r.ok)next[k]=r.value;else errs.push(k+'K: '+r.error);
  });
  const f=parseNum($('fx').value,{allowZero:false,max:1e4});
  $('fx').classList.toggle('is-bad',!f.ok);$('fx').setAttribute('aria-invalid',String(!f.ok));
  if(!f.ok)errs.push('AED→PHP: '+f.error);
  const e=$('rateErr');e.hidden=!errs.length;e.textContent=errs.join(' · ');
  if(errs.length)return;
  state.rates=next;state.fx=f.value;commitRates('manual');updateStale();runAll();
}

/* ---------- Sangla vs. Suot ---------- */
function loadForm(){
  const s=store.get('form',{})||{};
  $('gross').value=s.gross??'20.86';
  $('karat').value=['24','22','21','18'].includes(s.karat)?s.karat:'18';
  $('stone').value=STONES[s.stone]?s.stone:'malachite';
  $('stoneG').value=s.stoneG??'';
  $('making').value=s.making??'25';
  $('ltv').value=LTV[s.ltv]?s.ltv:'moderate';
  $('vatRefund').checked=!!s.vatRefund;
}
function saveForm(){
  store.save('form',{gross:$('gross').value,karat:$('karat').value,stone:$('stone').value,stoneG:$('stoneG').value,making:$('making').value,ltv:$('ltv').value,vatRefund:$('vatRefund').checked});
}
const row=(label,val,sub='')=>`<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 border-b border-dashed border-slate-700 py-2 last:border-0"><span class="min-w-0 text-sm text-slate-300">${label}</span><b class="num ml-auto max-w-full text-right text-sm text-slate-50 sm:text-base">${val}${sub?`<br><span class="font-medium text-amber-300">${sub}</span>`:''}</b></div>`;
const head=t=>`<h4 class="mt-3 mb-1 text-sm font-bold uppercase tracking-wide text-amber-400 first:mt-0">${t}</h4>`;

function runCalc(){
  const out=$('out');
  const g=field('gross',{allowZero:false,max:100000});
  const m=field('making',{max:10000});
  const stone=$('stone').value;
  $('stoneWrap').hidden=stone!=='custom';
  let sg={ok:true,value:0};
  if(stone==='custom'){
    sg=field('stoneG',{max:100000});
    if(sg.ok&&g.ok&&sg.value>=g.value){sg={ok:false};setErr('stoneG','Dapat mas mababa sa gross weight.')}
  }else setErr('stoneG',null);
  if(!(g.ok&&m.ok&&sg.ok)){out.innerHTML='<p class="text-sm font-medium text-rose-300">Ayusin muna ang mga pulang field para lumabas ang computation.</p>';lastCopy='';$('copyBtn').disabled=true;return}
  const r=calc({gross:g.value,karat:$('karat').value,stone,stoneGrams:sg.value,making:m.value,rates:state.rates,fx:state.fx,ltv:$('ltv').value,vatRefund:$('vatRefund').checked});
  if(!r.ok){out.innerHTML='<p class="text-sm text-slate-300">Kulang ang rates. Ilagay ang 24K at karat rate sa itaas.</p>';lastCopy='';$('copyBtn').disabled=true;return}
  const vr=$('vatRefund').checked,k=$('karat').value,fine=Math.round(r.purity*1000);
  const stoneLbl=r.pct==null?'Custom':(STONES[stone].n+(r.pct?' ~'+Math.round(r.pct*100)+'%':''));
  const ltvN=LTV[$('ltv').value];
  const good=r.lossPct<15,deficit=r.deficitPHP;
  let h=head('Timbang')+
    row('Gross weight',fmtNum(g.value)+' g')+
    row('Stone deduction ('+stoneLbl+')','−'+fmtNum(r.stoneG)+' g')+
    row('Net gold weight',fmtNum(r.netGoldWeight)+' g')+
    row('Purity ('+k+'K / '+fine+')','Pure gold: '+fmtNum(r.pureFineContent,3)+' g')+
    head('Binayaran sa Dubai')+
    row('Gold + upah (bago ang VAT)',fmtAED(r.subtotal),'Upah: '+fmtAED(r.upahTotal)+' ('+fmtAED(m.value)+'/g)')+
    row('VAT 5% (kasama sa invoice)',fmtAED(r.vat))+
    row('Total na ginastos',fmtAED(r.total),fmtPHP(r.spentPHP));
  if(vr){
    const f=r.refund;
    h+=head('Planet VAT refund (DXB)');
    if(f.eligible){
      h+=row('VAT sa invoice',fmtAED(f.vat))+row('85% ng VAT',fmtAED(f.share))+row('Bayad kada tag','−'+fmtAED(f.fee))+
        row('Refund',fmtAED(f.refund),fmtPHP(f.refund*state.fx))+
        row('Net cost matapos ang refund',fmtAED(r.netCostAED),fmtPHP(r.basisPHP));
    }else h+=`<p class="py-2 text-sm text-amber-300">Hindi eligible: ${fmtAED(f.total)} ang total, mas mababa sa minimum na ${fmtAED(250)} kada transaksyon. Walang refund.</p>`;
  }
  h+=head('Manila pawn (tantya)')+
    row('Appraisal (net × purity × 24K spot)',fmtPHP(r.appraisalPHP),fmtAED(r.appraisalAED))+
    row('Sangla value ('+ltvN.n+', '+Math.round(r.ltv*100)+'% LTV)',fmtPHP(r.pawnPHP),fmtAED(r.pawnAED))+
    `<div class="mt-3 rounded-xl border-l-4 p-3 ${good?'border-emerald-400 bg-emerald-950/60':'border-rose-400 bg-rose-950/60'}" role="status">
      <p class="num text-lg font-bold ${good?'text-emerald-300':'text-rose-300'}">Lugi Alert: ${fmtNum(r.lossPct,1)}%</p>
      <p class="num text-base font-semibold text-slate-50">Cash deficit: ${deficit>0?'−':''}${fmtPHP(Math.abs(deficit))}</p>
      <p class="text-sm text-slate-200">${vr&&r.refund.eligible?'Net cost matapos ang VAT refund':'Total na ginastos'} (${fmtPHP(r.basisPHP)}) bawas ang agarang sangla value (${fmtPHP(r.pawnPHP)}). ${deficit<=0?'Walang lugi sa agarang sangla.':good?'Maliit ang lugi; okay bilang ipon.':'Malaki ito dahil sa upah, VAT at/o bato. Pang-suot ito, hindi pang-emergency fund.'}</p></div>
     <p class="mt-2 text-xs text-slate-400">Tantya lang. Ginagamit ang 24K board rate bilang spot; iba-iba ang spot at LTV ng bawat pawnshop sa Pilipinas.</p>`;
  if(updateStale())h+='<p class="mt-2 rounded-lg bg-rose-950/60 p-2 text-sm font-medium text-rose-300" role="alert">Babala: lampas 24 oras na ang rates na ginamit. I-update muna para tumpak.</p>';
  out.innerHTML=h;
  lastCopy=[
    'GintongGabay: Sangla vs. Suot',
    'Gross weight: '+fmtNum(g.value)+' g',
    'Stone deduction: '+fmtNum(r.stoneG)+' g ('+stoneLbl+')',
    'Net gold weight: '+fmtNum(r.netGoldWeight)+' g ('+k+'K / '+fine+')',
    'Upah: '+fmtAED(m.value)+'/g = '+fmtAED(r.upahTotal),
    'VAT 5%: '+fmtAED(r.vat),
    'Total na ginastos: '+fmtAED(r.total)+' = '+fmtPHP(r.spentPHP),
    ...(vr?['VAT refund (Planet): '+(r.refund.eligible?fmtAED(r.refund.refund)+'; net cost '+fmtAED(r.netCostAED)+' = '+fmtPHP(r.basisPHP):'hindi eligible (mas mababa sa AED 250)')]:[]),
    'Manila pawn ('+ltvN.n+' '+Math.round(r.ltv*100)+'% LTV): '+fmtPHP(r.pawnPHP),
    'Lugi: '+fmtNum(r.lossPct,1)+'% | Cash deficit: '+(deficit>0?'-':'')+fmtPHP(Math.abs(deficit)),
    'Rates: 24K spot '+fmtAED(state.rates[24])+'/g; 1 AED = '+fmtNum(state.fx)+' PHP'
  ].join('\n');
  $('copyBtn').disabled=false;
}
async function copyBreakdown(){
  const msg=$('copyMsg');if(!lastCopy)return;
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(lastCopy);
    else{ // iOS/older fallback
      const t=document.createElement('textarea');t.value=lastCopy;t.setAttribute('readonly','');t.style.cssText='position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t);t.select();t.setSelectionRange(0,t.value.length);
      const ok=document.execCommand('copy');document.body.removeChild(t);if(!ok)throw new Error('copy');
    }
    msg.textContent='Na-copy! I-paste sa WhatsApp o Messenger.';
  }catch{msg.textContent='Hindi na-copy. Pindutin nang matagal ang teksto para piliin at i-copy.'}
  setTimeout(()=>{msg.textContent=''},4000);
}

/* ---------- Bullion presets ---------- */
const bar=store.get('bar',{g:10,custom:''})||{g:10,custom:''};
function renderBarButtons(){
  $('barBtns').innerHTML=BAR_PRESETS.map(p=>`<button type="button" class="btn-ghost" data-g="${p.g}" aria-pressed="false" aria-label="Presyo ng ${p.label} na 24K bar">${p.label}</button>`).join('');
  $('barBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{bar.g=+b.dataset.g;bar.custom='';$('barCustom').value='';runBar();store.save('bar',bar)});
}
function runBar(){
  let grams=bar.g;const c=$('barCustom').value.trim();
  if(c!==''){const r=field('barCustom',{allowZero:false,max:1e6});if(r.ok){grams=r.value;bar.custom=c}else{$('barOut').innerHTML='';return}}else setErr('barCustom',null);
  $('barBtns').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(c===''&&+b.dataset.g===grams)));
  const v=barValue({grams,spot:state.rates[24],fx:state.fx});
  $('barOut').innerHTML=row('Timbang',fmtNum(grams,grams<10?2:1)+' g')+row('Halaga sa 24K spot ('+fmtAED(state.rates[24])+'/g)',fmtAED(v.aed),fmtPHP(v.php))+
    `<p class="mt-2 text-xs text-slate-400">Spot value lang, wala pang premium ng dealer. Karaniwang 0% VAT ang investment-grade na bar (99% pataas); kumpirmahin sa invoice.${updateStale()?' <b class="text-rose-300">Lumang rates ang gamit.</b>':''}</p>`;
  store.save('bar',bar);
}

/* ---------- Checklists (persisted) ---------- */
const SOUK=[
 ['Tare zero','Siguraduhing 0.00 g ang timbangan bago ilagay ang gold, at walang nakadikit sa tray.'],
 ['DGJG itemized receipt','Dapat nakahiwalay ang gold rate, upah, VAT, at bigat ng bawat piraso.'],
 ['DCL / Bareeq check','Hanapin ang hallmark at certificate. Itanong kung registered ang tindahan sa Dubai Central Laboratory.'],
 ['VAT Planet sticker/slip','Hingin ang Planet Tax Free tag kung eligible bilang turista. Hindi ito para sa mga residente.'],
 ['Magnet test','Hindi dumidikit ang tunay na gold sa magnet. Hindi ito sapat na patunay, pero nakakatanggal ng pekeng bakal.']];
const DOCS=[
 ['Orihinal na tax invoice','Mula sa tindahan (hal. sa Deira) na may TRN at itemized: timbang, karat, upah, VAT.'],
 ['Planet validation slip / tag','Kung kukuha ng VAT refund. Nakadikit sa likod ng invoice at na-validate sa DXB.'],
 ['Certificate of authenticity','Mula sa tindahan, kung mayroon. Itugma ang karat at timbang sa hallmark.'],
 ['Pasaporte at eTravel QR','Isang beses lang i-register sa etravel.gov.ph o eGovPH app, sa loob ng 72 oras bago dumating.'],
 ['Patunay ng bayad','Resibo ng card o cash, para sa halaga ng pagtatasa ng customs.']];
function checklist(box,items,key,meter,score,unit){
  const saved=store.get(key,[])||[];
  $(box).innerHTML=items.map((c,i)=>`<div class="flex items-start gap-3 border-b border-dashed border-slate-700 py-3 last:border-0"><input type="checkbox" id="${key}${i}" class="mt-1 h-6 w-6 shrink-0 accent-amber-400" ${saved.includes(i)?'checked':''}><label for="${key}${i}" class="text-slate-100">${c[0]}<small class="block text-sm text-slate-400">${c[1]}</small></label></div>`).join('');
  const upd=()=>{const on=items.map((_,i)=>$(key+i).checked?i:-1).filter(i=>i>=0);store.save(key,on);$(meter).style.width=on.length/items.length*100+'%';$(score).textContent=on.length+' sa '+items.length+' '+unit};
  items.forEach((_,i)=>$(key+i).onchange=upd);upd();
}

/* ---------- Customs + cash ---------- */
const CMSG={
  deminimis:['ok','Hindi lalampas sa PHP 10,000, kaya walang duties at taxes ayon sa Sec. 423 CMTA. Ideklara pa rin ang alahas sa eTravel, at tiyaking may malinaw na fineness mark ang bawat piraso.'],
  exempt:['warn','Lampas sa PHP 10,000 pero hindi lalampas sa PHP 150,000. Maaaring sakop ng exemption ng mga Pilipino para sa personal effects (hanggang 3 beses kada taon) kung hindi commercial. Ideklara at itago ang resibo.'],
  over:['bad','Lampas sa PHP 150,000. Asahan ang pagtatasa ng duties at taxes. Ideklara ito at kausapin ang BOC officer sa NAIA.'],
  commercial:['bad','Maaaring ituring na commercial (bar, maraming magkakaparehong piraso, pang-benta). Hindi ito sakop ng personal exemption at maaaring buwisan. Ideklara at magtanong sa BOC bago bumiyahe.']
};
const LVL={ok:'border-emerald-400 bg-emerald-950/60',warn:'border-amber-400 bg-amber-950/50',bad:'border-rose-400 bg-rose-950/60'};
function runCustoms(){
  const o=$('cout'),commercial=$('cmode').value==='commercial';
  store.save('customs',{v:$('cval').value,m:$('cmode').value});
  const r=field('cval',{max:1e9});
  if(!r.ok){o.className='hidden';o.innerHTML='';return}
  const c=customsCheck({valueAED:r.value,fx:state.fx,commercial}),[lvl,text]=CMSG[c.key];
  o.className='mt-3 rounded-xl border-l-4 p-3 text-sm text-slate-100 '+LVL[lvl];
  o.innerHTML=`<b class="num block text-base">Tinatayang halaga: ${fmtPHP(c.php)}</b>${text}`;
}
function runCash(){
  const o=$('cashOut');store.save('cash',{v:$('ccash').value,c:$('ccur').value});
  const r=field('ccash',{max:1e12});
  if(!r.ok||r.value===0){o.className='hidden';o.innerHTML='';return}
  const c=cashCheck({amount:r.value,currency:$('ccur').value});let lvl,text;
  if(c.key==='php'){
    lvl=c.over?'bad':'ok';
    text=c.over?`Lampas sa ${fmtPHP(CUSTOMS.CASH_PHP)}. Kailangan ng deklarasyon at paunang nakasulat na pahintulot ng BSP; limitado ang pinapayagang dahilan.`:`Pasok sa ${fmtPHP(CUSTOMS.CASH_PHP)} na limit para sa pisikal na pera.`;
  }else{
    lvl=c.over?'bad':'ok';
    text=c.over?`Lampas sa USD 10,000 (≈ ${fmtAED(CUSTOMS.CASH_USD*CUSTOMS.AED_PER_USD)}). Kailangang ideklara ang buong halaga sa e-CDF.`:`Pasok sa USD 10,000 (≈ ${fmtAED(CUSTOMS.CASH_USD*CUSTOMS.AED_PER_USD)}) na limit. Katumbas ng dala mo: USD ${fmtNum(c.usd)}.`;
  }
  o.className='mt-3 rounded-xl border-l-4 p-3 text-sm text-slate-100 '+LVL[lvl];o.textContent=text;
}

/* ---------- Tabs ---------- */
const TABS=['calc','scan','roi','travel'];
function tabs(){
  const go=(id,focus)=>{
    document.querySelectorAll('section[data-sec]').forEach(s=>s.classList.toggle('on',s.id===id));
    document.querySelectorAll('.tab').forEach(t=>{
      const on=t.dataset.t===id;
      t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;
      t.classList.toggle('text-amber-400',on);t.classList.toggle('text-slate-400',!on);t.classList.toggle('border-amber-400',on);t.classList.toggle('border-transparent',!on);
      if(on&&focus)t.focus();
    });
    if(id!=='scan')stopCamera();                        // camera light off the moment you leave the scanner
    try{if(location.hash!=='#'+id)history.replaceState(null,'','#'+id)}catch{}
    window.scrollTo({top:0});
  };
  const list=[...document.querySelectorAll('.tab')];
  list.forEach((t,i)=>{
    t.onclick=()=>go(t.dataset.t);
    t.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();go(list[(i+(e.key==='ArrowRight'?1:list.length-1))%list.length].dataset.t,true)}};
  });
  window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABS.includes(h))go(h)});
  const h=location.hash.slice(1);go(TABS.includes(h)?h:'calc');
}

/* ---------- ZIP export: keeps the css/, js/, icons/ folders, no wrapper folder, no loose duplicates ---------- */
const REPO_FILES=['index.html','manifest.webmanifest','sw.js','offline.html','css/styles.css','js/app.js','js/calculator.js','js/scanner.js','js/icons-gen.js','icons/icon.svg','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-192.png','icons/icon-maskable-512.png'];
function isPng(blob){
  return new Promise(res=>{
    const fr=new FileReader();
    fr.onload=()=>{const u=new Uint8Array(fr.result);res(u.length>=4&&u[0]===0x89&&u[1]===0x50&&u[2]===0x4E&&u[3]===0x47)};
    fr.onerror=()=>res(false);fr.readAsArrayBuffer(blob.slice(0,4));
  });
}
async function downloadZip(){
  const btn=$('zipBtn'),label='I-download ang Project ZIP';
  if(typeof JSZip==='undefined'){btn.textContent='Hindi na-load ang JSZip. Kailangan ng internet.';setTimeout(()=>btn.textContent=label,4000);return}
  btn.disabled=true;btn.textContent='Ginagawa ang ZIP...';
  try{
    const zip=new JSZip();
    for(const f of REPO_FILES){
      let blob=null;
      try{const r=await fetch(f,{cache:'no-cache'});if(r.ok)blob=await r.blob()}catch{}
      const m=/^icons\/icon(-maskable)?-(\d+)\.png$/.exec(f);
      if(m&&!(blob&&await isPng(blob))){      // your icon file is missing or not a valid PNG: redraw it so the manifest never 404s
        try{blob=await makeIcon(+m[2],{maskable:!!m[1]})}catch{blob=null}
      }
      if(!blob)throw new Error(f);
      zip.file(f,blob);                       // the path creates css/, js/ and icons/ inside the archive; nothing goes at the root
    }
    zip.file('.nojekyll','');
    const out=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    const a=document.createElement('a');a.href=URL.createObjectURL(out);a.download='gintonggabay.zip';a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),4000);
    btn.textContent='Na-download na ang ZIP';
  }catch(e){btn.textContent='Nabigo ('+e.message+'). Subukan ulit.'}
  finally{btn.disabled=false;setTimeout(()=>btn.textContent=label,4000)}
}

function netBadge(){
  const set=()=>{const on=navigator.onLine;$('net').textContent=on?'Online':'Offline';$('net').className='rounded-full px-2 py-0.5 text-xs font-medium '+(on?'bg-emerald-900 text-emerald-300':'bg-slate-700 text-amber-300')};
  window.addEventListener('online',set);window.addEventListener('offline',set);set();
}
function runAll(){runCalc();runBar();runCustoms();runCash()}

function init(){
  $('stone').innerHTML=Object.entries(STONES).map(([k,v])=>`<option value="${k}">${v.n}${v.p?` (~${Math.round(v.p*100)}%)`:''}</option>`).join('');
  $('ltv').innerHTML=Object.entries(LTV).map(([k,v])=>`<option value="${k}">${v.n} (${Math.round(v.v*100)}% LTV)</option>`).join('');
  setFavicon();renderRates();loadForm();renderBarButtons();
  $('barCustom').value=bar.custom||'';
  const c=store.get('customs',{v:'3000',m:'personal'})||{};$('cval').value=c.v??'3000';$('cmode').value=c.m==='commercial'?'commercial':'personal';
  const cs=store.get('cash',{v:'',c:'PHP'})||{};$('ccash').value=cs.v??'';$('ccur').value=['PHP','USD','AED'].includes(cs.c)?cs.c:'PHP';
  [...KARATS.map(k=>'r'+k),'fx'].forEach(i=>$(i).addEventListener('input',readRates));
  $('confirmRates').onclick=()=>{commitRates('manual');updateStale();runAll()};
  $('refreshRates').onclick=()=>fetchLiveRates();
  $('resetRates').onclick=()=>{
    if(!confirm('Ibalik ang rates sa placeholder values?'))return;
    state.rates={...DEFAULT_RATES};state.fx=DEFAULT_FX;state.stamp=null;state.source='default';state.status='default';state.liveStamp=null;
    store.set('rates',state.rates);store.set('fx',state.fx);store.set('ratesStamp',null);store.set('ratesSource','default');store.set('liveStamp',null);
    renderRates();updateStale();runAll();
  };
  ['gross','karat','stone','stoneG','making','ltv','vatRefund'].forEach(i=>{const ev=$(i).type==='checkbox'||$(i).tagName==='SELECT'?'change':'input';$(i).addEventListener(ev,()=>{runCalc();saveForm()});if(ev==='change')$(i).addEventListener('input',()=>{runCalc();saveForm()})});
  $('barCustom').addEventListener('input',()=>{runBar()});
  ['cval','cmode'].forEach(i=>$(i).addEventListener('input',runCustoms));
  ['ccash','ccur'].forEach(i=>$(i).addEventListener('input',runCash));
  $('copyBtn').onclick=copyBreakdown;
  checklist('checks',SOUK,'checks','meter','score','ang na-check');
  checklist('docs',DOCS,'docs','docsMeter','docsScore','ang handa');
  updateStale();runAll();tabs();initScanner();netBadge();
  $('zipBtn').onclick=downloadZip;
  renderIcons();
  window.addEventListener('offline',()=>{if(state.status==='live'||state.status==='partial'){state.status='offline'}renderStatus()});
  window.addEventListener('online',()=>{if(state.source==='live'&&!ratesAreOld())state.status='live';renderStatus();autoFetchIfNeeded()});
  autoFetchIfNeeded();                                   // once at start: online + cached rates older than 4 hours
  setInterval(()=>{updateStale()},60000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)store.flush();else{updateStale();runAll()}});
  window.addEventListener('pagehide',()=>store.flush());
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js',{scope:'./'}).catch(()=>{});
}
init();
