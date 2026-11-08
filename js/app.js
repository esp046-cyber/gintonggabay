import { calc, parseNum, STONES, LTV, BAR_PRESETS, CUSTOMS, fmtNum, fmtAED, fmtPHP, barValue, customsCheck, cashCheck } from './calculator.js';
import { initScanner, stopCamera } from './scanner.js';
import { makeIcon, setFavicon } from './icons-gen.js';

const $ = id => document.getElementById(id);
const KARATS = [24, 22, 21, 18];
const DEFAULT_RATES = { 24: 480, 22: 440, 21: 420, 18: 360 };
const DEFAULT_FX = 15.5;
const DAY = 864e5;

const mem = {}, timers = {};
const rawGet = (k, d) => { try { const v = localStorage.getItem(k); if (v !== null) return JSON.parse(v); } catch {} return k in mem ? mem[k] : d; };
const rawSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const store = {
  get: rawGet,
  set(k, v) { mem[k] = v; rawSet(k, v); },
  save(k, v, ms = 300) { mem[k] = v; clearTimeout(timers[k]); timers[k] = setTimeout(() => { delete timers[k]; rawSet(k, v); }, ms); },
  flush() { Object.keys(timers).forEach(k => { clearTimeout(timers[k]); delete timers[k]; rawSet(k, mem[k]); }); }
};

const sane = (v, d) => Number.isFinite(+v) && +v > 0 ? +v : d;
const state = {
  rates: (() => { const s = store.get('rates', {}) || {}, r = {}; KARATS.forEach(k => r[k] = sane(s[k], DEFAULT_RATES[k])); return r; })(),
  fx: sane(store.get('fx', DEFAULT_FX), DEFAULT_FX),
  stamp: Number.isFinite(+store.get('ratesStamp', null)) && store.get('ratesStamp', null) ? +store.get('ratesStamp', null) : null
};
let lastCopy = '';

function renderIcons() {
  document.querySelectorAll('i[data-lucide]').forEach(el => el.setAttribute('aria-hidden', 'true'));
  try { if (window.lucide && lucide.createIcons) lucide.createIcons(); } catch {}
}

function updateStale() {
  const age = state.stamp ? Date.now() - state.stamp : Infinity;
  const stale = age > DAY;
  const b = $('stale');
  if (b) b.classList.toggle('hidden', !stale);
  const dot = $('dot');
  if (dot) dot.className = `inline-block h-2.5 w-2.5 shrink-0 rounded-full ${stale ? 'bg-amber-400' : 'bg-emerald-400'}`;
  const txt = $('stampTxt');
  if (txt) {
    txt.textContent = state.stamp 
      ? `Na-update: ${new Date(state.stamp).toLocaleString('en-PH', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Default placeholder rates';
  }
  return stale;
}

function renderRates() {
  KARATS.forEach(k => { const el = $('r' + k); if (el) el.value = state.rates[k]; });
  const fxEl = $('fx');
  if (fxEl) fxEl.value = state.fx;
}

function commitRates() {
  state.stamp = Date.now();
  store.save('rates', state.rates);
  store.save('fx', state.fx);
  store.save('ratesStamp', state.stamp);
}

function readRates() {
  const errs = [], next = { ...state.rates };
  KARATS.forEach(k => {
    const el = $('r' + k);
    if (!el) return;
    const r = parseNum(el.value, { allowZero: false, max: 1e6 });
    if (r.ok) next[k] = r.value;
    else errs.push(`${k}K: ${r.error}`);
  });
  const f = parseNum($('fx').value, { allowZero: false, max: 1e4 });
  if (!f.ok) errs.push(`AED→PHP: ${f.error}`);
  const e = $('rateErr');
  if (e) { e.hidden = !errs.length; e.textContent = errs.join(' · '); }
  if (errs.length) return;
  state.rates = next;
  state.fx = f.value;
  commitRates();
  updateStale();
  runAll();
}

async function fetchLiveRates() {
  const btn = $('refreshRates'), icon = $('refreshIcon'), spin = $('spin'), txt = $('refreshTxt');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('hidden');
  if (spin) spin.classList.remove('hidden');
  if (txt) txt.textContent = 'Kinukuha...';

  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 6000);

    const [goldRes, fxRes] = await Promise.all([
      fetch('https://gold-api.com/api/XAU/AED', { signal: ctl.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('https://open.er-api.com/v6/latest/AED', { signal: ctl.signal }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    clearTimeout(tm);

    if (goldRes && goldRes.price) {
      const g24 = goldRes.price_gram_24k || (goldRes.price / 31.1035);
      state.rates[24] = Math.round(g24 * 100) / 100;
      state.rates[22] = Math.round(g24 * (22 / 24) * 100) / 100;
      state.rates[21] = Math.round(g24 * (21 / 24) * 100) / 100;
      state.rates[18] = Math.round(g24 * (18 / 24) * 100) / 100;
    }

    if (fxRes && fxRes.rates && fxRes.rates.PHP) {
      state.fx = Math.round(fxRes.rates.PHP * 100) / 100;
    }

    commitRates();
    renderRates();
    updateStale();
    runAll();
  } catch (err) {
    console.warn('Live fetch error:', err);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('hidden');
    if (spin) spin.classList.add('hidden');
    if (txt) txt.textContent = 'I-refresh ang Rates';
  }
}

const row = (label, val, sub = '') => `<div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 border-b border-dashed border-slate-700 py-2 last:border-0"><span class="min-w-0 text-sm text-slate-300">${label}</span><b class="num ml-auto max-w-full text-right text-sm text-slate-50 sm:text-base">${val}${sub ? `<br><span class="font-medium text-amber-300">${sub}</span>` : ''}</b></div>`;
const head = t => `<h4 class="mt-3 mb-1 text-sm font-bold uppercase tracking-wide text-amber-400 first:mt-0">${t}</h4>`;

function runCalc() {
  const out = $('out');
  if (!out) return;
  const g = parseNum($('gross').value, { allowZero: false, max: 100000 });
  const m = parseNum($('making').value, { max: 10000 });
  const stone = $('stone').value;
  const stoneWrap = $('stoneWrap');
  if (stoneWrap) stoneWrap.hidden = stone !== 'custom';
  let sg = { ok: true, value: 0 };
  if (stone === 'custom') {
    sg = parseNum($('stoneG').value, { max: 100000 });
  }
  if (!(g.ok && m.ok && sg.ok)) {
    out.innerHTML = '<p class="text-sm font-medium text-rose-300">Ilagay ang wastong timbang (gross weight).</p>';
    if ($('copyBtn')) $('copyBtn').disabled = true;
    return;
  }
  const r = calc({
    gross: g.value,
    karat: $('karat').value,
    stone,
    stoneGrams: sg.value,
    making: m.value,
    rates: state.rates,
    fx: state.fx,
    ltv: $('ltv').value,
    vatRefund: $('vatRefund').checked
  });

  const vr = $('vatRefund').checked, k = $('karat').value, fine = Math.round(r.purity * 1000);
  const stoneLbl = r.pct == null ? 'Custom' : (STONES[stone].n + (r.pct ? ` ~${Math.round(r.pct * 100)}%` : ''));
  const ltvN = LTV[$('ltv').value] || LTV.moderate;
  const good = r.lossPct < 15, deficit = r.deficitPHP;

  let h = head('Timbang') +
    row('Gross weight', fmtNum(g.value) + ' g') +
    row('Stone deduction (' + stoneLbl + ')', '−' + fmtNum(r.stoneG) + ' g') +
    row('Net gold weight', fmtNum(r.net) + ' g') +
    row('Purity (' + k + 'K / ' + fine + ')', 'Pure gold: ' + fmtNum(r.pureG, 3) + ' g') +
    head('Binayaran sa Dubai') +
    row('Gold + upah (bago ang VAT)', fmtAED(r.subtotal), 'Upah: ' + fmtAED(r.upahTotal) + ' (' + fmtAED(m.value) + '/g)') +
    row('VAT 5%', fmtAED(r.vat)) +
    row('Total na ginastos', fmtAED(r.total), fmtPHP(r.spentPHP));

  if (vr) {
    const f = r.refund;
    h += head('Planet VAT refund (DXB)');
    if (f.eligible) {
      h += row('VAT sa invoice', fmtAED(f.vat)) + row('85% refund', fmtAED(f.share)) + row('Bayad kada tag', '−' + fmtAED(f.fee)) +
        row('Makukuhang refund', fmtAED(f.refund), fmtPHP(f.refund * state.fx)) +
        row('Net cost pagkatapos ng refund', fmtAED(r.netCostAED), fmtPHP(r.basisPHP));
    } else {
      h += `<p class="py-2 text-sm text-amber-300">Hindi eligible: ${fmtAED(f.total)} ay mas mababa sa minimum na AED 250.</p>`;
    }
  }

  h += head('Manila pawn (tantya)') +
    row('Appraisal spot', fmtPHP(r.appraisalPHP), fmtAED(r.appraisalAED)) +
    row('Sangla value (' + ltvN.n + ', ' + Math.round(r.ltv * 100) + '% LTV)', fmtPHP(r.pawnPHP), fmtAED(r.pawnAED)) +
    `<div class="mt-3 rounded-xl border-l-4 p-3 ${good ? 'border-emerald-400 bg-emerald-950/60' : 'border-rose-400 bg-rose-950/60'}" role="status">
      <p class="num text-lg font-bold ${good ? 'text-emerald-300' : 'text-rose-300'}">Lugi Alert: ${fmtNum(r.lossPct, 1)}%</p>
      <p class="num text-base font-semibold text-slate-50">Cash deficit: ${deficit > 0 ? '−' : ''}${fmtPHP(Math.abs(deficit))}</p>
    </div>`;

  out.innerHTML = h;
  lastCopy = `GintongGabay: ${g.value}g ${k}K | Net: ${fmtNum(r.net)}g | Bayad: ${fmtAED(r.total)} (₱${fmtNum(r.spentPHP, 0)}) | Sangla: ₱${fmtNum(r.pawnPHP, 0)} | Lugi: -${fmtNum(r.lossPct, 1)}%`;
  if ($('copyBtn')) $('copyBtn').disabled = false;
}

function runBar() {
  const out = $('barOut');
  if (!out) return;
  let grams = 10;
  const c = $('barCustom').value.trim();
  if (c !== '') {
    const r = parseNum(c, { allowZero: false, max: 1e6 });
    if (r.ok) grams = r.value;
  }
  const v = barValue({ grams, spot: state.rates[24], fx: state.fx });
  out.innerHTML = row('Timbang', fmtNum(grams) + ' g') + row('Halaga sa 24K spot', fmtAED(v.aed), fmtPHP(v.php));
}

const CHECKS = [
  ['Tare zero', 'Siguraduhing 0.00 g ang timbangan bago ilagay ang ginto.'],
  ['DGJG itemized receipt', 'Nakahiwalay ang raw gold rate, upah, at VAT.'],
  ['DCL / Bareeq check', 'May certified hallmark stamp (999, 916, 875, 750).'],
  ['VAT Planet tag', 'Humingi ng tax-free tag bago magbayad kung turista.'],
  ['Magnet test', 'Hindi dapat dumidikit sa magnet ang tunay na ginto.']
];

function renderChecks() {
  const box = $('checks');
  if (!box) return;
  box.innerHTML = CHECKS.map((c, i) => `
    <div class="flex items-start gap-3 border-b border-dashed border-slate-700 py-3 last:border-0">
      <input type="checkbox" id="c${i}" class="mt-1 h-5 w-5 shrink-0 accent-amber-400">
      <label for="c${i}" class="text-slate-100 text-sm font-medium cursor-pointer">${c[0]}<small class="block text-xs text-slate-400 font-normal mt-0.5">${c[1]}</small></label>
    </div>
  `).join('');
}

function tabs() {
  const go = id => {
    document.querySelectorAll('section[data-sec]').forEach(s => s.classList.toggle('hidden', s.id !== id));
    document.querySelectorAll('.tab').forEach(t => {
      const on = t.dataset.t === id;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('text-amber-400', on);
      t.classList.toggle('text-slate-400', !on);
      t.classList.toggle('border-amber-400', on);
      t.classList.toggle('border-transparent', !on);
    });
    if (id !== 'scan') stopCamera();
    try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch {}
  };
  document.querySelectorAll('.tab').forEach(t => (t.onclick = () => go(t.dataset.t)));
  const h = location.hash.slice(1);
  go(['calc', 'scan', 'roi', 'travel'].includes(h) ? h : 'calc');
}

function runAll() {
  runCalc();
  runBar();
}

function init() {
  setFavicon();
  renderRates();
  renderChecks();
  tabs();
  initScanner();
  runAll();
  renderIcons();
  updateStale();

  // Wire event handlers
  const refBtn = $('refreshRates');
  if (refBtn) refBtn.onclick = fetchLiveRates;

  const resBtn = $('resetRates');
  if (resBtn) resBtn.onclick = () => {
    state.rates = { ...DEFAULT_RATES };
    state.fx = DEFAULT_FX;
    state.stamp = null;
    commitRates();
    renderRates();
    updateStale();
    runAll();
  };

  const copy = $('copyBtn');
  if (copy) copy.onclick = () => {
    navigator.clipboard.writeText(lastCopy).then(() => {
      const msg = $('copyMsg');
      if (msg) { msg.textContent = 'Na-copy na!'; setTimeout(() => msg.textContent = '', 2500); }
    });
  };

  ['gross', 'karat', 'stone', 'stoneG', 'making', 'ltv', 'vatRefund'].forEach(id => {
    const el = $(id);
    if (el) { el.oninput = runCalc; el.onchange = runCalc; }
  });

  [...KARATS.map(k => 'r' + k), 'fx'].forEach(id => {
    const el = $(id);
    if (el) el.oninput = readRates;
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}