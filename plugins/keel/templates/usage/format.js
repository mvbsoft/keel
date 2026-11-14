'use strict';
// keel usage page: number, date and label formatting. window.KeelFormat(P, t, lang) gives the
// helpers: P is window.KeelPivot, t the UI string lookup, lang() the page's current language (it changes
// after the page settings load).
window.KeelFormat = function (P, t, lang) {
  // ---- formatting ----------------------------------------------------------------------------------
  const loc = () => (lang() === 'uk' ? 'uk-UA' : 'en-GB');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  // d digits after the point; dMax, when given, lets the number show up to dMax digits and drop trailing zeros.
  function nf(x, d, dMax) { return new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: dMax == null ? d : dMax }).format(x); }
  function fUsd(x) { if (!fin(x)) return '—'; return '$' + nf(x, Math.abs(x) >= 1000 ? 0 : 2); }
  function fPct(x, d) { return fin(x) ? nf(x, d == null ? 1 : d) + ' %' : '—'; }
  const fPctAuto = (x) => (fin(x) ? nf(x, 0, 1) + ' %' : '—');
  function fTok(x) {
    x = Number(x) || 0;
    if (x >= 1e9) return nf(x / 1e9, 2) + 'B';
    if (x >= 1e6) return nf(x / 1e6, x >= 1e7 ? 1 : 2) + 'M';
    if (x >= 1e3) return nf(x / 1e3, 0) + 'k';
    return nf(x, 0);
  }
  function fDur(min) {
    min = Math.round(Number(min) || 0);
    const h = Math.floor(min / 60); const m = min % 60;
    return h ? `${h} ${t('common.hours_short')} ${m} ${t('common.minutes_short')}` : `${m} ${t('common.minutes_short')}`;
  }
  const fHrs = (min) => nf((Number(min) || 0) / 60, 1) + ' ' + t('common.hours_short');
  const fInt = (x) => nf(Number(x) || 0, 0);
  function toMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const n = Date.parse(v); return Number.isFinite(n) ? n : NaN;
  }
  function fDay(dateStr) { // 'YYYY-MM-DD' (UTC date) -> 'dd.mm'
    const p = String(dateStr || '').split('-').map(Number);
    if (p.length < 3 || p.some((x) => !Number.isFinite(x))) return String(dateStr || '—');
    return new Intl.DateTimeFormat(loc(), { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(p[0], p[1] - 1, p[2])));
  }
  function fDT(v) { const m = toMs(v); return Number.isFinite(m) ? new Intl.DateTimeFormat(loc(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(m)) : '—'; }
  function fHM(v) { const m = toMs(v); return Number.isFinite(m) ? new Intl.DateTimeFormat(loc(), { hour: '2-digit', minute: '2-digit' }).format(new Date(m)) : '—'; }
  function fDate(v) { const m = toMs(v); return Number.isFinite(m) ? new Intl.DateTimeFormat(loc(), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(m)) : '—'; }
  function fWhen(v) { const m = toMs(v); return Number.isFinite(m) ? new Intl.DateTimeFormat(loc(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(m)) : '—'; }
  // A span in milliseconds as "2 d 13 h" (a day or more), "3 h 5 min" or "12 min".
  function fSpan(span) {
    const min = Math.max(0, Math.round((Number(span) || 0) / 60000));
    const d = Math.floor(min / (24 * 60)); const h = Math.floor((min % (24 * 60)) / 60);
    if (d) return `${d} ${t('common.days_short')} ${h} ${t('common.hours_short')}`;
    return fDur(min);
  }
  const unitOf = (id) => (P.measures.find((m) => m.id === id) || { unit: 'count' }).unit;
  function fMeasure(v, id) {
    const u = unitOf(id);
    if (u === 'usd') return fUsd(v);
    if (u === 'tokens') return fTok(v);
    if (u === 'min') return fHrs(v);
    return fInt(v);
  }
  const chartVal = (v, id) => (unitOf(id) === 'min' ? v / 60 : v);
  const walletName = (w) => t('wallet.' + (['subscription', 'api', 'credit'].includes(w) ? w : 'unknown'));
  // The plan is the default look; real money (an API key, credit) gets the violet pill and says so on hover.
  const walletChip = (w) => (w === 'api' || w === 'credit'
    ? `<span class="pill api" title="${esc(t('wallet.no_percent'))}">${esc(walletName(w))}</span>`
    : `<span class="pill">${esc(walletName(w))}</span>`);
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
  // 'opus-5-5' -> 'Opus 5.5'; a name that is not family-version stays as it is.
  function modelName(key) {
    const m = /^([a-z]+)-(\d+(?:-\d+)*)$/.exec(String(key));
    return m ? `${cap(m[1])} ${m[2].replace(/-/g, '.')}` : String(key);
  }
  function dimLabel(dim, key) {
    if (key == null || key === 'unknown' || key === '') return t('common.unknown');
    switch (dim) {
      case 'day': return fDay(key);
      case 'week': return String(key).replace(/^\d{4}-/, '');
      case 'hour': return key + ':00';
      case 'participant': return key === 'main' ? t('participant.main') : key;
      case 'wallet': return walletName(key);
      case 'model': return modelName(key);
      default: return String(key);
    }
  }
  // The days in the data are UTC days, so the period ends on the current UTC day, not the local one.
  const today = () => new Date().toISOString().slice(0, 10);
  const addDays = (ds, n) => { const p = ds.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)); return d.toISOString().slice(0, 10); };

  return {
    loc, esc, fin, nf, fUsd, fPct, fPctAuto, fTok, fDur, fHrs, fInt, toMs, fDay, fDT, fHM, fDate, fWhen, fSpan, unitOf, fMeasure, chartVal,
    walletName, walletChip, cap, modelName, dimLabel, today, addDays,
  };
};
