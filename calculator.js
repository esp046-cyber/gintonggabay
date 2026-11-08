// Pure calculation logic (no DOM). Safe to unit-test in Node.
export const STONES={
  none:{n:'Solid / Walang bato',p:0},
  malachite:{n:'Malachite',p:.12},
  onyx:{n:'Onyx',p:.10},
  mop:{n:'Mother of Pearl',p:.08},
  zirconia:{n:'Zirconia',p:.04}
};
export const PAWN_LTV=.92; // pawnshops value net scrap at roughly 90-95%
export const CUSTOMS={DE_MINIMIS_PHP:10000,FILIPINO_EXEMPT_PHP:150000}; // BOC advisory (eTravel, 2024); verify before travel

const num=v=>Number.isFinite(+v)?+v:0;

export function calc({gross,karat,stone,making,rates,fx}){
  gross=Math.max(0,num(gross));making=Math.max(0,num(making));fx=Math.max(0,num(fx));
  const rate=Math.max(0,num(rates&&rates[karat]));
  const pct=(STONES[stone]||STONES.none).p;
  const grossCost=gross*(rate+making);
  const stoneG=gross*pct;
  const net=gross-stoneG;
  const pawn=net*rate*PAWN_LTV;
  const lossAED=Math.max(0,grossCost-pawn);
  const loss=grossCost>0?(lossAED/grossCost)*100:0;
  return{rate,grossCost,grossPHP:grossCost*fx,stoneG,net,pawn,pawnPHP:pawn*fx,loss,lossAED,lossPHP:lossAED*fx,valid:gross>0&&rate>0};
}

// Rough BOC check for what you carry home. level: ok | warn | bad
export function customsCheck({valueAED,fx,commercial}){
  const php=Math.max(0,num(valueAED))*Math.max(0,num(fx));
  if(commercial) return{php,level:'bad',key:'commercial'};
  if(php<=CUSTOMS.DE_MINIMIS_PHP) return{php,level:'ok',key:'deminimis'};
  if(php<=CUSTOMS.FILIPINO_EXEMPT_PHP) return{php,level:'warn',key:'exempt'};
  return{php,level:'bad',key:'over'};
}
