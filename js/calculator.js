// Pure calculation + formatting logic (no DOM). Safe to unit-test in Node.
export const PURITY={24:.999,22:.916,21:.875,18:.75};           // UAE hallmark fineness
export const STONES={
  none:{n:'Solid / Walang bato',p:0},
  malachite:{n:'Malachite',p:.12},
  onyx:{n:'Onyx',p:.10},
  mop:{n:'Mother of Pearl',p:.08},
  zirconia:{n:'Zirconia',p:.04},
  custom:{n:'Custom (ilagay ang gramo)',p:null}
};
export const LTV={conservative:{n:'Conservative',v:.75},moderate:{n:'Moderate',v:.82},high:{n:'High',v:.90}}; // estimates, not quotes from any pawnshop
export const VAT={RATE:.05,SHARE:.85,TAG_FEE:4.80,MIN_SPEND:250};  // UAE 5% VAT; Planet Tax Free refund terms
export const CUSTOMS={DE_MINIMIS_PHP:10000,FILIPINO_EXEMPT_PHP:150000,CASH_PHP:50000,CASH_USD:10000,AED_PER_USD:3.6725};
export const BAR_PRESETS=[{g:1,label:'1 g'},{g:2.5,label:'2.5 g'},{g:5,label:'5 g'},{g:10,label:'10 g'},{g:11.66,label:'1 Tola (11.66 g)'},{g:20,label:'20 g'},{g:50,label:'50 g'},{g:100,label:'100 g'},{g:1000,label:'1 kg'}];

/* ---------- formatting: AED #,##0.00 and PHP ₱#,##0.00 ---------- */
export const fmtNum=(n,d=2)=>(Number.isFinite(n)?n:0).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
export const fmtAED=n=>'AED '+fmtNum(n);
export const fmtPHP=n=>'₱'+fmtNum(n);
export const r2=n=>Math.round((n+Number.EPSILON)*100)/100;

/* ---------- strict input parsing ---------- */
export function parseNum(raw,{allowZero=true,max=Infinity,required=true}={}){
  let s=String(raw??'').trim();
  if(s==='')return required?{ok:false,value:0,error:'Kailangan ito.'}:{ok:true,value:0};
  if(s.includes(',')&&!s.includes('.'))s=s.replace(',','.');   // 20,86 -> 20.86
  else s=s.replace(/,/g,'');                                   // 1,234.50 -> 1234.50
  if(/^-/.test(s)&&/^-\s*(\d|\.\d)/.test(s))return{ok:false,value:0,error:'Hindi puwede ang negatibong numero.'};
  if(!/^(\d+\.?\d*|\.\d+)$/.test(s))return{ok:false,value:0,error:'Numero lang ang puwede (hal. 20.86).'};
  const v=parseFloat(s);
  if(!Number.isFinite(v))return{ok:false,value:0,error:'Hindi wastong numero.'};
  if(!allowZero&&v===0)return{ok:false,value:0,error:'Dapat mas mataas sa 0.'};
  if(v>max)return{ok:false,value:0,error:'Masyadong malaki ang numero.'};
  return{ok:true,value:v};
}

/* ---------- UAE VAT + Planet Tax Free ---------- */
export function vatBreakdown(subtotal,{zeroRated=false}={}){
  const sub=r2(subtotal),vat=zeroRated?0:r2(sub*VAT.RATE);
  return{subtotal:sub,vat,total:r2(sub+vat)};      // never named 'net': that key belongs to gold weight
}
// Refund = (Total gross * 5/105) * 85% - 4.80 AED per tag; only if total >= AED 250 (incl. VAT). Never negative.
export function planetRefund(totalGross){
  const total=r2(totalGross),vat=r2(total*5/105),eligible=total>=VAT.MIN_SPEND;
  const share=r2(vat*VAT.SHARE);
  const fee=eligible?VAT.TAG_FEE:0;
  const refund=eligible?Math.max(0,r2(share-fee)):0;
  return{eligible,total,vat,share,fee,refund};
}

/* ---------- Sangla vs. Suot ---------- */
// netGoldWeight = gross - stone (custom g or % preset)
// pureFineContent = netGoldWeight x purity (0.999 / 0.916 / 0.875 / 0.750)
// sangla (Manila loan estimate) = pureFineContent x 24K spot x LTV (75% / 82% / 90%)
export function calc({gross,karat,stone,stoneGrams=0,making,rates,fx,ltv,vatRefund=false}){
  const purity=PURITY[karat]||0,spot=+rates[24]||0,boardRate=+rates[karat]||0;
  const pct=stone==='custom'?null:(STONES[stone]||STONES.none).p;
  const stoneG=Math.min(gross,stone==='custom'?Math.max(0,stoneGrams):gross*pct);
  const netGoldWeight=gross-stoneG,pureFineContent=netGoldWeight*purity;
  const ltvV=(LTV[ltv]||LTV.moderate).v;
  const appraisalAED=pureFineContent*spot,pawnAED=appraisalAED*ltvV;
  const subtotal=gross*(boardRate+making),upahTotal=gross*making;
  const inv=vatBreakdown(subtotal),ref=planetRefund(inv.total);
  const netCostAED=vatRefund?r2(inv.total-ref.refund):inv.total;
  const spentPHP=r2(inv.total*fx),basisPHP=r2(netCostAED*fx),appraisalPHP=r2(appraisalAED*fx),pawnPHP=r2(pawnAED*fx);
  const deficitPHP=r2(basisPHP-pawnPHP);
  const lossPct=basisPHP>0?Math.max(0,deficitPHP/basisPHP*100):0;
  return{purity,spot,boardRate,pct,stoneG,netGoldWeight,pureFineContent,ltv:ltvV,appraisalAED:r2(appraisalAED),appraisalPHP,pawnAED:r2(pawnAED),pawnPHP,
    subtotal:r2(subtotal),upahTotal:r2(upahTotal),vat:inv.vat,total:inv.total,refund:ref,netCostAED,spentPHP,basisPHP,deficitPHP,lossPct,
    ok:gross>0&&spot>0&&boardRate>0&&fx>0};
}

export function barValue({grams,spot,fx}){const aed=r2(grams*spot);return{aed,php:r2(aed*fx)}}

/* ---------- Customs ---------- */
export function customsCheck({valueAED,fx,commercial}){
  const php=r2(Math.max(0,valueAED)*Math.max(0,fx));
  if(commercial)return{php,level:'bad',key:'commercial'};
  if(php<=CUSTOMS.DE_MINIMIS_PHP)return{php,level:'ok',key:'deminimis'};
  if(php<=CUSTOMS.FILIPINO_EXEMPT_PHP)return{php,level:'warn',key:'exempt'};
  return{php,level:'bad',key:'over'};
}
// Physical cash: PHP over 50,000, or foreign currency over USD 10,000 (AED peg 3.6725).
export function cashCheck({amount,currency}){
  if(currency==='PHP')return{over:amount>CUSTOMS.CASH_PHP,key:'php'};
  const usd=currency==='USD'?amount:amount/CUSTOMS.AED_PER_USD;
  return{over:usd>CUSTOMS.CASH_USD,key:'fx',usd,aed:usd*CUSTOMS.AED_PER_USD};
}

/* ---------- Live rates (pure helpers) ---------- */
export const OZ_G=31.1034768; // grams per troy ounce
export const aedPerGramFromUsdOz=usdPerOz=>usdPerOz/OZ_G*CUSTOMS.AED_PER_USD; // AED is pegged to USD at 3.6725
// 24K = spot; 22K/21K/18K = spot x (karat / 24)
export function ratesFromSpot24(spot){
  const s=Math.max(0,+spot||0);
  return{24:r2(s),22:r2(s*22/24),21:r2(s*21/24),18:r2(s*18/24)};
}
// gold-api.com: {"currency":"USD","price":<per troy oz>,"symbol":"XAU","updatedAt":"..."}. Returns USD per troy oz or null.
export function parseGoldResponse(j){
  if(!j||typeof j!=='object')return null;
  if(j.currency&&String(j.currency).toUpperCase()!=='USD')return null;
  const p=+j.price;
  return Number.isFinite(p)&&p>=500&&p<=100000?p:null;
}
// open.er-api.com (base AED): {result:"success",rates:{PHP:..}}; jsDelivr currency-api: {aed:{php:..}}. Returns {php} or null.
export function parseFxResponse(j){
  if(!j||typeof j!=='object')return null;
  if(j.result&&j.result!=='success')return null;
  const php=+((j.rates&&j.rates.PHP)??(j.aed&&j.aed.php));
  return Number.isFinite(php)&&php>=2&&php<=60?Math.round(php*10000)/10000:null;
}
