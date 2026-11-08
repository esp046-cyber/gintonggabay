import { calc, STONES, customsCheck, CUSTOMS, LTV_TIERS } from './calculator.js';
import { initScanner, stopCamera } from './scanner.js';
import { makeIcon, setFavicon } from './icons-gen.js';

const $ = (id) => document.getElementById(id);
const KARATS = [24, 22, 21, 18];
const DEFAULT_RATES = { 24: 480, 22: 440, 21: 420, 18: 360 };
const DEFAULT_FX = 15.5;

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) return JSON.parse(v);
    } catch {}
    return d;
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  }
};

const posNum = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

const state = {
  rates: (() => {
    const s = store.get('rates', {});
    const r = {};
    KARATS.forEach((k) => (r[k] = posNum(s && s[k], DEFAULT_RATES[k])));
    return r;
  })(),
  fx: posNum(store.get('fx', DEFAULT_FX), DEFAULT_FX),
  stamp: store.get('ratesStamp', null)
};

const fmt = (n, d = 2) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });

function renderIcons() {
  try {
    if (window.lucide && lucide.createIcons) lucide.createIcons();
  } catch {}
}

function checkRateFreshness() {
  const stampEl = $('stamp');
  if (!state.stamp) {
    stampEl.textContent = '⚠️ Placeholder pa ang rates. I-update ayon sa DGJG board ngayon.';
    stampEl.className = 'text-xs text-amber-300 font-medium';
    return;
  }
  const ageHrs = (Date.now() - state.stamp) / (1000 * 60 * 60);
  const timeStr = new Date(state.stamp).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  if (ageHrs > 24) {
    stampEl.textContent = `⚠️ Lumang Board Rate (${timeStr}). Pakitingnan ang DGJG screen sa souk.`;
    stampEl.className = 'text-xs text-rose-300 font-medium';
  } else {
    stampEl.textContent = `Na-save: ${timeStr}`;
    stampEl.className = 'text-xs text-slate-400';
  }
}

function renderRates() {
  KARATS.forEach((k) => { $('r' + k).value = state.rates[k]; });
  $('fx').value = state.fx;
  checkRateFreshness();
}

function readRates() {
  KARATS.forEach((k) => { state.rates[k] = posNum($('r' + k).value, state.rates[k]); });
  state.fx = posNum($('fx').value, state.fx);
  state.stamp = Date.now();
  store.set('rates', state.rates);
  store.set('fx', state.fx);
  store.set('ratesStamp', state.stamp);
  checkRateFreshness();
  runCalc();
  runCustoms();
}

function resetRates() {
  if (!confirm('Ibalik ang rates sa placeholder values?')) return;
  state.rates = { ...DEFAULT_RATES };
  state.fx = DEFAULT_FX;
  state.stamp = null;
  store.set('rates', state.rates);
  store.set('fx', state.fx);
  store.set('ratesStamp', null);
  renderRates();
  runCalc();
  runCustoms();
}

let calcStateCache = null;

function runCalc() {
  const inp = {
    gross: $('gross').value,
    karat: $('karat').value,
    stone: $('stone').value,
    customStoneG: $('customStone').value,
    making: $('making').value,
    ltvTier: $('ltvTier').value,
    claimVAT: $('vatToggle').checked,
    rates: state.rates,
    fx: state.fx
  };
  
  store.set('calc', {
    gross: inp.gross,
    karat: inp.karat,
    stone: inp.stone,
    customStone: inp.customStoneG,
    making: inp.making,
    ltvTier: inp.ltvTier,
    claimVAT: inp.claimVAT
  });
  
  const r = calc(inp);
  calcStateCache = { ...r, fx: state.fx, karat: inp.karat };
  const out = $('out');
  
  if (!r.valid) {
    out.innerHTML = '<p class="text-slate-300 text-sm">Ilagay ang timbang (g) at tiyaking may rate ang napiling karat.</p>';
    $('copyBtn').classList.add('hidden');
    return;
  }
  
  $('copyBtn').classList.remove('hidden');
  const good = r.lossPct < 15;
  const row = (a, b) =>
    `<div class="flex items-start justify-between gap-3 border-b border-dashed border-slate-700 py-2 last:border-0"><span class="text-slate-300 text-sm">${a}</span><b class="text-right text-slate-50 text-sm">${b}</b></div>`;
  
  out.innerHTML =
    row('Tag Price (Gross)', `${fmt(r.grossCostAED)} AED <br><span class="text-amber-300 font-semibold">₱${fmt(r.grossCostPHP, 0)}</span>`) +
    (r.vat.eligible ? row('Planet Tax Free Refund (Est.)', `+${fmt(r.vat.refundAED)} AED <br><span class="text-emerald-300">₱${fmt(r.vat.refundAED * state.fx, 0)}</span>`) : '') +
    (inp.claimVAT && r.vat.eligible ? row('Net Bayad sa Dubai', `${fmt(r.effectiveCostAED)} AED <br><span class="text-slate-200">₱${fmt(r.effectiveCostPHP, 0)}</span>`) : '') +
    row('Bawas Bato (Stone Penalty)', `−${fmt(r.stoneWeight)} g`) +
    row('Netong Purong Ginto (Pure Gold Content)', `${fmt(r.pureFineGrams)} g (fine 999 equivalent)`) +
    row(`Sangla Value (${$('ltvTier').selectedOptions[0].text})`, `${fmt(r.pawnAED)} AED <br><span class="text-amber-300 font-bold text-base">₱${fmt(r.pawnPHP, 0)}</span>`) +
    `<div class="mt-3 rounded-xl border-l-4 p-3 ${good ? 'border-emerald-400 bg-emerald-950/60' : 'border-rose-400 bg-rose-950/60'}">
      <div class="flex items-center justify-between">
        <p class="text-lg font-bold ${good ? 'text-emerald-300' : 'text-rose-300'}">Lugi Alert: −${fmt(r.lossPct, 1)}%</p>
        <span class="text-xs px-2 py-0.5 rounded ${good ? 'bg-emerald-900 text-emerald-200' : 'bg-rose-900 text-rose-200'}">${good ? 'Mababa' : 'Mataas'}</span>
      </div>
      <p class="text-sm text-slate-200 mt-1">Kung isasangla agad, abono ka ng <b>${fmt(r.lossAED)} AED (₱${fmt(r.lossPHP, 0)})</b> kumpara sa binayaran mo sa Dubai.</p>
    </div>`;
}

function copyComputation() {
  if (!calcStateCache) return;
  const c = calcStateCache;
  const text = `--- GintongGabay Appraisal Report ---
Karat: ${c.karat}K | Gross: ${$('gross').value}g
Net Gold: ${fmt(c.netGold)}g | Bawas Bato: ${fmt(c.stoneWeight)}g
Bayad sa Dubai: ${fmt(c.grossCostAED)} AED (₱${fmt(c.grossCostPHP, 0)})
Sangla Appraisal (Manila): ₱${fmt(c.pawnPHP, 0)}
Tinatayang Lugi sa Sangla: −${fmt(c.lossPct, 1)}% (-₱${fmt(c.lossPHP, 0)})
Generated via GintongGabay (esp046-cyber.github.io/gintonggabay/)`;
  
  navigator.clipboard.writeText(text).then(() => {
    const btn = $('copyBtn');
    btn.textContent = 'Na-kopya na!';
    setTimeout(() => { btn.textContent = 'Kopyahin ang Breakdown'; }, 2500);
  });
}

function runCustoms() {
  const v = $('cval').value;
  const commercial = $('cmode').value === 'commercial';
  store.set('customs', { v, m: $('cmode').value });
  const r = customsCheck({ valueAED: v, fx: state.fx, commercial });
  
  const CMSG = {
    deminimis: ['ok', 'Hindi lalampas sa PHP 10,000 (De Minimis). Walang babayarang customs duties at taxes ayon sa Sec. 423 CMTA. Ideklara pa rin sa eTravel.'],
    exempt: ['warn', 'Pasok sa OFW/Filipino personal exemption (hanggang PHP 150,000) kung gamit pansarili at hindi pang-negosyo. Itago ang official store invoice.'],
    over: ['bad', 'Lampas sa PHP 150,000 exemption limit. Asahan ang assessment ng customs duties (karaniwang 3-5%) at 12% VAT sa NAIA. Huwag itago sa maleta upang maiwasan ang 30% surcharge.'],
    commercial: ['bad', 'Itinuturing na commercial shipment (Bullion bars, maramihang piraso). Bawal sa passenger green lane at sasailalim sa regular commercial tariff duties.']
  };
  
  const [lvl, text] = CMSG[r.key];
  const cls = { ok: 'border-emerald-400 bg-emerald-950/60', warn: 'border-amber-400 bg-amber-950/50', bad: 'border-rose-400 bg-rose-950/60' }[lvl];
  $('cout').className = 'mt-3 rounded-xl border-l-4 p-3 text-sm text-slate-100 ' + cls;
  $('cout').innerHTML = `<b class="block text-base mb-1">Tinatayang Halaga: ₱${fmt(r.php, 0)}</b>${text}`;
}

const CHECKS = [
  ['Tare Zero sa Timbangan', 'Siguraduhing 0.00 g ang timbangan bago ilagay ang ginto at walang hangin mula sa AC na tumatama dito.'],
  ['DGJG Itemized Tax Invoice', 'Dapat hiwalay ang raw gold weight, arawang board rate, at making charge (upah) sa resibo.'],
  ['DCL Bareeq Verification', 'May tatak na legal fineness stamp (750, 875, 916, 999) at accredited ng Dubai Central Laboratory.'],
  ['Planet Tax Free Digital Tag', 'Para sa turista (minimum 250 AED resibo): Ipakita ang pasaporte bago magbayad para sa 85% VAT validation.'],
  ['Neodymium Magnet Test', 'Hindi dapat dumidikit sa magnet. Kung kumapit ang lock o kadena, may halong bakal o spring.']
];

function renderChecks() {
  const saved = store.get('checks', []);
  $('checks').innerHTML = CHECKS.map((c, i) =>
    `<div class="flex items-start gap-3 border-b border-dashed border-slate-700 py-3 last:border-0">
      <input type="checkbox" id="c${i}" class="mt-1 h-5 w-5 shrink-0 accent-amber-400" ${saved.includes(i) ? 'checked' : ''}>
      <label for="c${i}" class="text-slate-100 text-sm font-medium cursor-pointer">${c[0]}<small class="block text-xs text-slate-400 font-normal mt-0.5">${c[1]}</small></label>
    </div>`
  ).join('');
  
  const upd = () => {
    const on = CHECKS.map((_, i) => ($('c' + i).checked ? i : -1)).filter((i) => i >= 0);
    store.set('checks', on);
    $('meter').style.width = (on.length / CHECKS.length) * 100 + '%';
    $('score').textContent = `${on.length} sa ${CHECKS.length} ang nakumpleto`;
  };
  CHECKS.forEach((_, i) => ($('c' + i).onchange = upd));
  upd();
}

function quickPresetBar(grams) {
  $('gross').value = grams;
  $('karat').value = '24';
  $('stone').value = 'none';
  $('customStone').value = '';
  $('making').value = '5';
  runCalc();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tabs() {
  const go = (id) => {
    document.querySelectorAll('section[data-sec]').forEach((s) => s.classList.toggle('hidden', s.id !== id));
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.t === id;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('text-amber-400', on);
      t.classList.toggle('text-slate-400', !on);
      t.classList.toggle('border-amber-400', on);
      t.classList.toggle('border-transparent', !on);
    });
    if (id !== 'scan') stopCamera();
    try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch {}
    window.scrollTo({ top: 0 });
  };
  
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => go(t.dataset.t)));
  const h = location.hash.slice(1);
  go(['calc', 'scan', 'roi', 'travel'].includes(h) ? h : 'calc');
}

async function downloadZip() {
  const btn = $('zipBtn');
  btn.disabled = true;
  btn.textContent = 'Inihahanda ang kumpletong package...';
  try {
    const files = [
      'index.html',
      'manifest.webmanifest',
      'sw.js',
      'offline.html',
      'css/styles.css',
      'js/app.js',
      'js/calculator.js',
      'js/scanner.js',
      'js/icons-gen.js',
      'icons/icon.svg'
    ];
    const zip = new JSZip();
    const root = zip.folder('gintonggabay');
    for (const f of files) {
      const r = await fetch(f);
      if (!r.ok) throw new Error(`Hindi ma-fetch ang ${f}`);
      root.file(f, await r.blob());
    }
    root.file('icons/icon-192.png', await makeIcon(192));
    root.file('icons/icon-512.png', await makeIcon(512));
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gintonggabay.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    btn.textContent = 'Na-download na!';
  } catch (e) {
    btn.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'I-download ang Project ZIP'; }, 4000);
  }
}

function init() {
  setFavicon();
  $('stone').innerHTML = Object.entries(STONES).map(([k, v]) =>
    `<option value="${k}">${v.n}${v.p ? ` (~${Math.round(v.p * 100)}%)` : ''}</option>`
  ).join('');
  
  renderRates();
  
  // Load saved calculator state
  const sc = store.get('calc', {});
  $('gross').value = sc.gross ?? '20.86';
  $('karat').value = sc.karat ?? '18';
  $('stone').value = STONES[sc.stone] ? sc.stone : 'malachite';
  $('customStone').value = sc.customStone ?? '';
  $('making').value = sc.making ?? '25';
  $('ltvTier').value = sc.ltvTier ?? 'moderate';
  $('vatToggle').checked = !!sc.claimVAT;
  
  const c = store.get('customs', { v: '3000', m: 'personal' });
  $('cval').value = c.v ?? '3000';
  $('cmode').value = c.m || 'personal';
  
  [...KARATS.map((k) => 'r' + k), 'fx'].forEach((i) => {
    $(i).addEventListener('input', readRates);
  });
  
  $('resetRates').onclick = resetRates;
  ['gross', 'karat', 'stone', 'customStone', 'making', 'ltvTier', 'vatToggle'].forEach((i) => {
    $(i).addEventListener('input', runCalc);
    $(i).addEventListener('change', runCalc);
  });
  
  $('copyBtn').onclick = copyComputation;
  ['cval', 'cmode'].forEach((i) => $(i).addEventListener('input', runCustoms));
  
  // Bullion Quick Presets
  document.querySelectorAll('[data-bar]').forEach((btn) => {
    btn.onclick = () => quickPresetBar(btn.dataset.bar);
  });
  
  runCalc();
  runCustoms();
  renderChecks();
  tabs();
  initScanner();
  
  $('zipBtn').onclick = downloadZip;
  renderIcons();
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
}

init();