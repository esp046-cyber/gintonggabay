// Pure calculation engine
export const STONES = {
  none: { n: 'Solid / Walang Bato', p: 0 },
  malachite: { n: 'Malachite (VCA style)', p: 0.12 },
  onyx: { n: 'Onyx / Black Agate', p: 0.10 },
  mop: { n: 'Mother of Pearl', p: 0.08 },
  zirconia: { n: 'Cubic Zirconia / Glass', p: 0.04 }
};

export const KARAT_PURITY = {
  24: 0.999,
  22: 0.916,
  21: 0.875,
  18: 0.750
};

export const LTV_TIERS = {
  conservative: { label: 'Conservative (75% LTV)', mult: 0.75 },
  moderate: { label: 'Moderate / Palawan (82% LTV)', mult: 0.82 },
  high: { label: 'High / Villarica (90% LTV)', mult: 0.90 }
};

export const CUSTOMS = {
  DE_MINIMIS_PHP: 10000,
  FILIPINO_EXEMPT_PHP: 150000,
  BSP_CASH_PHP: 50000,
  BSP_FX_USD: 10000
};

const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function calcVATRefund(grossAED) {
  const g = Math.max(0, num(grossAED));
  if (g < 250) return { eligible: false, refundAED: 0, tagFee: 4.80 };
  const rawVAT = g * (5 / 105);
  const refundAED = Math.max(0, (rawVAT * 0.85) - 4.80);
  return { eligible: true, refundAED, tagFee: 4.80, rawVAT };
}

export function calc({ gross, karat, stone, customStoneG, making, ltvTier = 'moderate', claimVAT = false, rates, fx }) {
  gross = Math.max(0, num(gross));
  making = Math.max(0, num(making));
  fx = Math.max(0, num(fx));
  
  const selectedKarat = num(karat) || 18;
  const rate24 = Math.max(0, num(rates && rates[24]));
  const boardRate = Math.max(0, num(rates && rates[selectedKarat]));
  
  // Stone calculation: manual override or preset percentage
  const stoneData = STONES[stone] || STONES.none;
  let stoneWeight = 0;
  if (num(customStoneG) > 0) {
    stoneWeight = Math.min(gross, num(customStoneG));
  } else {
    stoneWeight = gross * stoneData.p;
  }
  
  const netGold = Math.max(0, gross - stoneWeight);
  const grossCostAED = gross * (boardRate + making);
  
  // VAT Refund logic
  const vat = calcVATRefund(grossCostAED);
  const effectiveCostAED = claimVAT && vat.eligible ? Math.max(0, grossCostAED - vat.refundAED) : grossCostAED;
  
  // Manila Pawn Scrap Calculation
  // Pure fine grams = Net Gold * Karat Fineness Factor
  const fineness = KARAT_PURITY[selectedKarat] || 0.75;
  const pureFineGrams = netGold * fineness;
  const spotRatePureAED = rate24 > 0 ? rate24 : (boardRate / fineness);
  
  const ltvFactor = (LTV_TIERS[ltvTier] || LTV_TIERS.moderate).mult;
  const pawnAED = pureFineGrams * spotRatePureAED * ltvFactor;
  
  const lossAED = Math.max(0, effectiveCostAED - pawnAED);
  const lossPct = effectiveCostAED > 0 ? (lossAED / effectiveCostAED) * 100 : 0;
  
  return {
    boardRate,
    grossCostAED,
    grossCostPHP: grossCostAED * fx,
    effectiveCostAED,
    effectiveCostPHP: effectiveCostAED * fx,
    stoneWeight,
    netGold,
    pureFineGrams,
    pawnAED,
    pawnPHP: pawnAED * fx,
    lossPct,
    lossAED,
    lossPHP: lossAED * fx,
    vat,
    valid: gross > 0 && boardRate > 0
  };
}

export function customsCheck({ valueAED, fx, commercial }) {
  const php = Math.max(0, num(valueAED)) * Math.max(0, num(fx));
  if (commercial) return { php, level: 'bad', key: 'commercial' };
  if (php <= CUSTOMS.DE_MINIMIS_PHP) return { php, level: 'ok', key: 'deminimis' };
  if (php <= CUSTOMS.FILIPINO_EXEMPT_PHP) return { php, level: 'warn', key: 'exempt' };
  return { php, level: 'bad', key: 'over' };
}