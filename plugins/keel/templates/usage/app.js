'use strict';
// keel usage page: the frame. It loads the data, derives the period's rows, routes, draws the header
// (brand, sections, sync state, period, theme switch) and puts the current view into <main id="view">.
//
// A VIEW is one file, view-<name>.js, that registers itself and touches nothing but `app` and its own DOM:
//
//   window.KeelViews.<name> = (app, route) => ({ html, bind, period });
//
// - `name` is overview | analysis | sessions | session | limit; `route` is { tab, key } (key: a session).
// - Called on every render, when the data is ready. `html` is the view's markup (escape every value).
// - `bind(root)` (optional) runs once the html is in place. Listen through `app.on(type, selector,
//   handler)`: one delegated listener on the view, dropped at the next render; handler(el, event) gets the
//   element that matched. Do not add listeners that outlive the render.
// - `period: false` hides the header's period control (default: shown).
// - Texts come from `app.t(key, vars)`; every key lives in i18n.js and i18n.uk.js under the view's prefix.
//   overview: overview.*   analysis: filter.* group.* split.* dim.* measure.* measure_short.* stats.*
//   sessions: sessions.* sgroup.* col.* drill.* export.*   session: sp.* keel.* cache.*   limit: cal.*
//
// What `app` gives a view:
//   data    state (the page state: range, rows of the period, sessions, flat, calib, machines, an, ss, ov),
//           P (pivot.js), t, lang(), order (colour order per dimension), store.get/set (sessionStorage)
//   format  every helper of format.js: loc esc fin nf fUsd fPct fPctAuto fTok fDur fHrs fInt toMs fDay fDT fHM
//           fDate fWhen fSpan unitOf fMeasure chartVal walletName walletChip cap modelName dimLabel today addDays
//   charts  every helper of charts.js: seriesClass niceScale columns bars stack legend line table tableDetails
//   limits  limitInfo() weeklyRate() fiveRate() weekShare(usd, wallet) fWeekShare(percent)
//   shared  tile(label, value, htmlSub) emptyAll() hasAnyData() uniq(list) $(id)
//           seg({ label | labelledBy, idPrefix, name, value, options: [{ value, label }] }) the markup of a group of pills
//   menu    menu({ id, label, value, options, cls, prefix, data }) the markup of a choice list (menu.js); choosing fires
//           `change` on the trigger (id), so listen with app.on('change', '[data-x]', el => el.value) and put the focus
//           back on el.id after drawing again. choices(list, labelFn, current) makes its options: "all", then the list.
//   actions on(type, selector, handler) navigate(tab, key) drill(dimLabel, valueLabel, sessionKeys)
//           rerender() restoreFocus(id) setRange(field, value) saveFile(filename, text, messageElementId)
(function () {
  const P = window.KeelPivot;
  const I = window.KeelI18n;
  const $ = (id) => document.getElementById(id);
  const VIEW = $('view');
  const TOP = $('top');

  let lang = /^uk/i.test(navigator.language || '') ? 'uk' : 'en';
  const t = (key, vars) => I.t(lang, key, vars);
  if (!P || !I || !window.KeelFormat || !window.KeelCharts || !window.KeelMenu || !window.KeelCalendar || !window.KeelLoad || !window.KeelViews) {
    VIEW.innerHTML = '<div class="empty"><h2>The page scripts did not load.</h2></div>';
    return;
  }
  const F = window.KeelFormat(P, t, () => lang);
  const { esc, fin, toMs, fDT, today, addDays } = F;
  const order = {};
  const C = window.KeelCharts({ esc, t, order });
  const M = window.KeelMenu({ esc, root: VIEW });
  const K = window.KeelCalendar({ esc, t, root: TOP, place: M.place, locale: F.loc, today, addDays });
  const { loadFromDb, sleep } = window.KeelLoad();

  // ---- state ---------------------------------------------------------------------------------------
  const store = {
    get(k) { try { const v = sessionStorage.getItem(`keel-usage.${k}`); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(`keel-usage.${k}`, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };
  const S = {
    mode: 'loading', demo: false, error: null, db: null, downloads: null,
    range: store.get('range') || { preset: '30', from: addDays(today(), -29), to: today() },
    docs: [], machines: [], calibs: [], calib: null,
    flat: { sessions: [], rows: [], hours: [], snapshots: [] }, rows: [], sessions: [],
    an: Object.assign({ pc: '', user: '', project: '', wallet: '', participant: '', model: '', by: 'day', split: 'model', measure: 'usd', touched: false }, store.get('an') || {}),
    ss: Object.assign({ search: '', pc: '', project: '', wallet: '', group: 'none', sort: 'date', dir: 'desc', drill: null }, store.get('ss') || {}),
    ov: Object.assign({ dim: 'project' }, store.get('ov') || {}),
    lastTab: null,
  };
  if (S.range.preset !== 'custom') { const n = Number(S.range.preset) || 30; S.range.from = addDays(today(), -(n - 1)); S.range.to = today(); }

  // ---- data loading --------------------------------------------------------------------------------
  function derive() {
    S.flat = P.flatten(S.docs);
    S.rows = P.filter(S.flat.rows, { from: S.range.from, to: S.range.to });
    S.sessions = S.flat.sessions.filter((s) => s.date >= S.range.from && s.date <= S.range.to);
    S.calib = S.calibs.slice().sort((a, b) => (toMs(b.computed_at) || 0) - (toMs(a.computed_at) || 0))[0] || null;
    // stable colour order per dimension: by total $ over everything loaded
    for (const dim of ['model', 'pc', 'project', 'participant', 'user']) order[dim] = P.group(S.flat.rows, dim).map((g) => g.key);
  }
  let loadSeq = 0;
  async function reload() {
    const seq = ++loadSeq;
    if (S.demo) { derive(); render(); return; }
    if (!S.db) return;
    S.mode = 'loading'; render();
    try {
      const from = S.range.from < addDays(today(), -8) ? S.range.from : addDays(today(), -8); // the plan limit card needs the current week
      const to = S.range.to > today() ? S.range.to : today();
      const db = await loadFromDb(S.db, from, to);
      if (seq !== loadSeq) return;
      S.docs = db.docs; S.machines = db.machines; S.calibs = db.calibs;
      if (db.settings.language) lang = db.settings.language === 'uk' ? 'uk' : 'en';
      derive(); S.mode = 'ready';
    } catch (e) {
      if (seq !== loadSeq) return;
      S.mode = 'error'; S.error = (e && (e.message || e.code)) || String(e);
    }
    render();
  }

  async function boot() {
    const qs = location.search || '';
    const wantDemo = /[?&]demo=1(&|$)/.test(qs);
    let claude = window.claude;
    for (let i = 0, n = wantDemo ? 3 : 30; i < n && !(claude && typeof claude.use === 'function'); i++) { await sleep(100); claude = window.claude; }
    let db = null;
    if (claude && typeof claude.use === 'function') {
      try { db = await claude.use('db'); } catch (e) { db = null; }
      // Only these two views draw a CSV button; any other view stays as it is, so a list the reader has open does not close.
      claude.use('downloads').then((d) => { S.downloads = d; if (['sessions', 'analysis'].includes(route().tab)) rerender(); }).catch(() => {});
    }
    if (!db) {
      if (wantDemo) { loadDemo((/[?&]lang=(en|uk)/.exec(qs) || [])[1] || 'uk'); return; }
      S.mode = 'nodb'; render(); return;
    }
    S.db = db;
    await reload();
  }

  // sample data for a local layout check only
  function loadDemo(l) {
    lang = l === 'en' ? 'en' : 'uk';
    document.documentElement.lang = lang;
    S.demo = true;
    Object.assign(S, window.KeelUsageDemo(toMs));
    S.mode = 'ready';
    derive(); render();
  }

  // ---- routing -------------------------------------------------------------------------------------
  const TABS = [['overview', 'tab.overview'], ['analysis', 'tab.analysis'], ['sessions', 'tab.sessions'], ['limit', 'tab.limit']];
  // Addresses of the earlier page, kept so a saved link still opens the right view.
  const OLD_TABS = { dash: 'overview', calib: 'limit' };
  function route() {
    const h = decodeURIComponent((location.hash || '').slice(1));
    if (h.startsWith('s.')) return { tab: 'session', key: h.slice(2) };
    const id = OLD_TABS[h] || h;
    return TABS.some(([tab]) => tab === id) ? { tab: id } : { tab: 'overview' };
  }
  const navigate = (tab, key) => { location.hash = tab === 'session' ? `#s.${key}` : `#${tab}`; };
  function drill(dim, value, keys) {
    S.ss.drill = { dim, value, keys };
    store.set('ss', S.ss);
    navigate('sessions');
  }

  // ---- plan limit helpers --------------------------------------------------------------------------
  function latestSnap(field) {
    let best = null;
    for (const s of S.flat.snapshots) if (typeof s[field] === 'number' && (!best || toMs(s.t) > toMs(best.t))) best = s;
    return best;
  }
  const weeklyRate = () => (S.calib && S.calib.weekly && fin(S.calib.weekly.rate) && S.calib.weekly.rate > 0 ? S.calib.weekly.rate : null);
  // What a session took of the weekly plan limit, in percent; null when the plan did not pay for it or no rate is measured yet.
  const weekShare = (usd, wallet) => { const rate = weeklyRate(); return wallet === 'subscription' && rate ? usd / rate : null; };
  const fWeekShare = (pct) => F.fPct(pct, 2);
  const fiveRate = () => (S.calib && S.calib.five_hour && fin(S.calib.five_hour.rate) && S.calib.five_hour.rate > 0 ? S.calib.five_hour.rate : null);
  function subUsdSince(ms0, ms1) {
    let usd = 0;
    for (const h of S.flat.hours) { const m = toMs(h.h); if (h.wallet === 'subscription' && m >= ms0 && (ms1 == null || m < ms1)) usd += Number(h.usd) || 0; }
    return usd;
  }
  function limitInfo() {
    const now = Date.now();
    const w = latestSnap('seven_day');
    const f = latestSnap('five_hour');
    const wReset = w ? toMs(w.seven_day_resets_at) : NaN;
    const fReset = f ? toMs(f.five_hour_resets_at) : NaN;
    const weekStart = Number.isFinite(wReset) ? wReset - 7 * 864e5 : now - 7 * 864e5;
    const rate = weeklyRate();
    const wStale = !w || (Number.isFinite(wReset) && wReset < now);
    let forecast = null;
    if (w && !wStale && rate && Number.isFinite(wReset)) {
      const usd48 = subUsdSince(now - 48 * 3600000);
      forecast = Math.round((w.seven_day + (usd48 / 48 / rate) * ((wReset - now) / 3600000)) * 10) / 10;
    }
    return { w, f, wReset, fReset, weekStart, weekUsd: subUsdSince(weekStart), rate, wStale, fStale: !f || (Number.isFinite(fReset) && fReset < now), forecast };
  }

  // ---- shared view helpers -------------------------------------------------------------------------
  const emptyAll = () => `<div class="empty"><h2>${esc(t('empty.state'))}</h2><p>${esc(t('empty.what'))}</p></div>`;
  const hasAnyData = () => S.flat.sessions.length > 0 || S.flat.hours.length > 0;
  const tile = (label, value, sub) => `<div class="tile"><span class="lbl">${esc(label)}</span><span class="mid">${esc(value)}</span>${sub ? `<span class="small muted">${sub}</span>` : ''}</div>`;
  const uniq = (arr) => [...new Set(arr.filter((x) => x != null && x !== ''))].sort();
  // A filter that is no longer in the list (the period changed) stays in it, so its chip still shows it and can clear it.
  const choices = (list, labelFn, cur) => [{ value: '', label: t('common.all') }]
    .concat((cur && !list.includes(cur) ? [...list, cur] : list).map((v) => ({ value: v, label: labelFn ? labelFn(v) : v })));
  // A group of pills with one chosen (the design system's `.seg`). Each button is <idPrefix><value> and carries data-<name>="<value>".
  const seg = ({ label, labelledBy, idPrefix, name, value, options }) => `<div class="seg" role="group" ${labelledBy ? `aria-labelledby="${labelledBy}"` : `aria-label="${esc(label)}"`}>`
    + options.map((o) => `<button type="button" id="${idPrefix}${o.value}" data-${name}="${o.value}"${o.value === value ? ' class="on"' : ''} aria-pressed="${o.value === value}">${esc(o.label)}</button>`).join('')
    + '</div>';
  const restoreFocus = (id) => { const n = id && $(id); if (n) n.focus(); };
  // Saves a CSV through the `downloads` capability; the message goes into the element `messageId`.
  async function saveFile(filename, text, messageId) {
    const msg = $(messageId);
    if (S.downloads) {
      try {
        const r = await S.downloads.save({ filename, data: text });
        if (msg && r && r.status === 'saved') msg.textContent = t('common.export_done');
      } catch (e) {
        if (msg && e && e.code !== 'declined') msg.textContent = t('export.failed', { message: e.message || e.code || '' });
      }
      return;
    }
    // A page without the `downloads` capability (a local copy) saves through a plain link; the artifact viewer blocks that path.
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    if (msg) msg.textContent = t('common.export_done');
  }

  // ---- header --------------------------------------------------------------------------------------
  const PRESETS = ['7', '30', '90', 'custom'];
  let themeControl = null;
  let themeLang = null;
  let periodShown = false;
  // The oldest "synced until" of the machines: the page is complete up to that moment.
  function syncPill() {
    const times = S.machines.map((m) => toMs(m.synced_until)).filter(Number.isFinite);
    return times.length ? `<span class="pill good st">${esc(t('app.sync', { n: times.length, when: fDT(Math.min(...times)) }))}</span>` : '';
  }
  function renderHeader(r) {
    const active = document.activeElement;
    const focusId = active && active.id && TOP.contains && TOP.contains(active) ? active.id : null;
    const tabs = TABS.map(([id, key]) => {
      const on = r.tab === id || (r.tab === 'session' && id === 'sessions');
      return `<a href="#${id}"${on ? ' class="on" aria-current="page"' : ''}>${esc(t(key))}</a>`;
    }).join('');
    const period = periodShown ? seg({ label: t('range.label'), idPrefix: 'rg_', name: 'preset', value: S.range.preset, options: PRESETS.map((p) => ({ value: p, label: t(`range.${p}`) })) }) : '';
    const dates = periodShown && S.range.preset === 'custom'
      ? K.html({ id: 'rgFrom', label: t('filter.from'), value: S.range.from, data: { range: 'from' } }) + K.html({ id: 'rgTo', label: t('filter.to'), value: S.range.to, data: { range: 'to' } })
      : '';
    if (window.KeelTheme && themeLang !== lang) {
      themeControl = window.KeelTheme.control({ label: t('theme.label'), dark: t('theme.dark'), light: t('theme.light') });
      themeLang = lang;
    }
    TOP.innerHTML = `<a class="brand" href="#overview">keel <span>${esc(t('app.name'))}</span></a>
      <nav class="tabs" aria-label="${esc(t('app.sections'))}">${tabs}</nav>
      <div class="right">${S.mode === 'ready' ? syncPill() : ''}${period}${dates}<span id="themeSlot"></span></div>`;
    const slot = $('themeSlot');
    if (themeControl && slot && slot.append) slot.append(themeControl);
    $('banner').innerHTML = S.demo ? `<div class="callout note">${esc(t('demo.banner'))}</div>` : '';
    if (focusId) restoreFocus(focusId);
  }

  // ---- rendering -----------------------------------------------------------------------------------
  const bound = [];
  function on(type, selector, handler) {
    const fn = (e) => { const el = e.target && e.target.closest ? e.target.closest(selector) : null; if (el) handler(el, e); };
    VIEW.addEventListener(type, fn);
    bound.push([type, fn]);
  }
  function render() {
    const r = route();
    document.documentElement.lang = lang;
    while (bound.length) { const [type, fn] = bound.pop(); VIEW.removeEventListener(type, fn); }
    let v = null;
    if (S.mode === 'ready') {
      v = window.KeelViews[r.tab](app, r);
      periodShown = v.period !== false;
    } else if (S.mode !== 'loading') periodShown = false;
    renderHeader(r);
    if (S.mode === 'loading') { VIEW.innerHTML = `<div class="loading">${esc(t('app.loading'))}</div>`; return; }
    if (S.mode === 'nodb') { VIEW.innerHTML = `<div class="empty"><h2>${esc(t('nodb.title'))}</h2><p>${esc(t('nodb.text'))}</p><p class="small">${esc(t('nodb.demo'))}</p></div>`; return; }
    if (S.mode === 'error') { VIEW.innerHTML = `<div class="empty"><h2>${esc(t('app.error', { message: S.error }))}</h2></div>`; return; }
    VIEW.innerHTML = v.html;
    if (v.bind) v.bind(VIEW);
  }
  const rerender = () => { if (S.mode === 'ready') render(); };

  // ---- period and header events --------------------------------------------------------------------
  let rangeTimer = null;
  function setRange(field, value) {
    if (field === 'preset') {
      S.range.preset = value;
      if (value !== 'custom') { const n = Number(value); S.range.from = addDays(today(), -(n - 1)); S.range.to = today(); }
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { S.range[field] = value; S.range.preset = 'custom'; } else return;
    if (S.range.from > S.range.to) { const x = S.range.from; S.range.from = S.range.to; S.range.to = x; }
    store.set('range', S.range);
    renderHeader(route());
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(reload, 300);
  }
  TOP.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button[data-preset]');
    if (b) setRange('preset', b.dataset.preset);
  });
  TOP.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.range) setRange(el.dataset.range, el.value);
  });
  window.addEventListener('hashchange', () => {
    const r = route();
    if (r.tab !== 'session') S.lastTab = r.tab;
    render();
    if (r.tab === 'session') window.scrollTo(0, 0);
  });

  const app = Object.assign({}, F, C, {
    P, t, state: S, order, store, lang: () => lang, $,
    limitInfo, weeklyRate, weekShare, fWeekShare, fiveRate,
    tile, seg, emptyAll, hasAnyData, uniq, menu: M.html, choices,
    on, navigate, drill, rerender, restoreFocus, setRange, saveFile,
  });

  S.lastTab = route().tab === 'session' ? null : route().tab;
  render();
  boot();
})();
