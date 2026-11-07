'use strict';
// The usage page's browser scripts outside the page: format.js, colors.js, load.js and demo.js each define
// their window function and give everything index.html takes from it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'usage');
const P = require(path.join(dir, 'pivot.js'));
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

// Runs a page script with only the globals given; returns its `window`.
function load(name, globals = {}) {
  const window = { ...(globals.window || {}) };
  vm.runInNewContext(fs.readFileSync(path.join(dir, name), 'utf8'), { ...globals, window });
  return window;
}
// The names index.html destructures from a call such as `window.KeelFormat(`.
function taken(call) {
  const m = new RegExp(`const \\{([^}]*)\\} = window\\.${call}\\(`).exec(html);
  assert.ok(m, `index.html takes names from ${call}`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

test('format.js: gives every helper the page takes, and follows the page language as it changes', () => {
  const { KeelFormat } = load('format.js');
  let lang = 'en';
  const F = KeelFormat(P, (key) => key, () => lang);
  for (const name of taken('KeelFormat')) assert.ok(name in F, `format.js gives ${name}`);
  assert.equal(F.fUsd(12.3), '$12.30');
  assert.equal(F.esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(F.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(F.fMeasure(90, 'time_min'), '1.5 common.hours_short');
  lang = 'uk';
  assert.equal(F.fUsd(12.3), '$12,30', 'the locale is read on each call');
});

test('colors.js: gives every color helper the page takes; colors come from the CSS tokens', () => {
  const tokens = { '--m-opus': '#a00', '--m-opus-2': '#b00', '--c1': '#111', '--muted': '#777', '--line': '#ccc', '--font-ui': 'Plex' };
  const Chart = { defaults: { font: {}, plugins: { legend: { labels: {} } } } };
  const { KeelColors } = load('colors.js', {
    Chart,
    window: { Chart },
    document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: (n) => ` ${tokens[n] || ''} ` }),
    matchMedia: () => ({ matches: true }),
  });
  const C = KeelColors();
  for (const name of taken('KeelColors')) assert.ok(name in C, `colors.js gives ${name}`);
  C.order.model = ['claude-opus-5-5-20260101', 'claude-opus-4-1-20250805'];
  assert.equal(C.colorFor('model', 'claude-opus-5-5-20260101'), '#a00');
  assert.equal(C.colorFor('model', 'claude-opus-4-1-20250805'), '#b00');
  C.order.pc = ['office'];
  assert.equal(C.colorFor('pc', 'office'), '#111');
  C.chartDefaults();
  assert.equal(Chart.defaults.color, '#777');
  assert.equal(Chart.defaults.font.family, 'Plex');
  assert.equal(Chart.defaults.animation, false, 'reduced motion: no animation');
});

test('load.js: gives every loader the page takes; database days are read page by page past 1000', async () => {
  const { KeelLoad } = load('load.js', { setTimeout });
  const L = KeelLoad();
  for (const name of taken('KeelLoad')) assert.ok(name in L, `load.js gives ${name}`);
  const all = Array.from({ length: 1500 }, (_, i) => ({ id: `d${i}`, date: `2026-01-${String(1 + Math.floor(i / 50)).padStart(2, '0')}` }));
  const db = {
    collection: (name) => {
      let from = ''; let to = '';
      const q = {
        where: (f, op, v) => { if (op === '>=') from = v; if (op === '<=') to = v; return q; }, orderBy: () => q, limit: () => q,
        get: async () => {
          const docs = (name === 'days' ? all.filter((d) => d.date >= from && d.date <= to).slice(0, 1000) : []).map((d) => ({ id: d.id, data: () => d }));
          return { docs, size: docs.length };
        },
      };
      return q;
    },
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ language: 'uk' }) }) }),
  };
  const out = await L.loadFromDb(db, '2026-01-01', '2026-01-31');
  assert.equal(out.docs.length, 1500, 'each day once, across two pages');
  assert.equal((await L.loadFromDb(db, '2026-01-01', '2026-01-10')).docs.length, 500, 'the end date bounds the query');
  assert.deepEqual(out.settings, { language: 'uk' });
});

test('demo.js: the sample days, machines and calibrations read as the page reads its database', () => {
  const { KeelUsageDemo } = load('demo.js');
  assert.match(html, /Object\.assign\(S, window\.KeelUsageDemo\(toMs\)\)/);
  const demo = KeelUsageDemo((v) => Date.parse(v));
  assert.deepEqual(Object.keys(demo).sort(), ['calibs', 'docs', 'machines']);
  const flat = P.flatten(demo.docs);
  assert.equal(flat.sessions.length, 7);
  assert.ok(flat.snapshots.length > 0 && flat.hours.length > 0);
  assert.deepEqual(Array.from(demo.machines, (m) => m.name), ['office', 'laptop']);
  assert.deepEqual(Array.from(demo.calibs, (c) => c.pc), ['office', 'laptop']);
});

// ---- index.html: the whole page script on its own, with a stub page and a stub database ------------------------
// Runs the page's inline script against the real pivot.js, i18n, format.js, colors.js, load.js and demo.js. Returns
// the elements the page writes to, once the first data load has finished; `fetched` lists any network request.
async function openPage({ db, hash = '#sessions', search = '', nav = 'en' }) {
  const elements = {};
  const el = (id) => elements[id] || (elements[id] = {
    id, innerHTML: '', hidden: false, dataset: {}, setAttribute() {}, addEventListener() {}, querySelector: () => null, closest: () => null,
  });
  const window = { claude: { use: async (n) => (n === 'db' && db ? db : Promise.reject(new Error('no capability'))) }, addEventListener() {}, scrollTo() {} };
  const fetched = [];
  const root = { lang: '', getAttribute: () => null };
  const ctx = vm.createContext({
    window, self: window, console: { warn() {}, log() {} }, setTimeout, clearTimeout, Intl, URL,
    document: { getElementById: el, documentElement: root, addEventListener() {}, createElement: () => ({}), body: { appendChild() {} } },
    location: { search, hash }, history: { length: 1 }, navigator: { language: nav },
    sessionStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    MutationObserver: class { observe() {} },
    fetch: async (p) => { fetched.push(p); return { ok: false, status: 404 }; },
  });
  for (const f of ['pivot.js', 'i18n.js', 'i18n.uk.js', 'format.js', 'colors.js', 'load.js', 'demo.js']) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  const script = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];
  vm.runInContext(script, ctx, { filename: 'index.html' });
  for (let i = 0; i < 400 && (!el('view').innerHTML || /class="loading"/.test(el('view').innerHTML)); i++) await new Promise((r) => setTimeout(r, 5));
  return { view: () => el('view').innerHTML, banner: () => el('banner').innerHTML, fetched, window, htmlLang: () => root.lang };
}

// A database that answers the three collections and the settings document the page reads.
function stubDb({ days = [], machines = [], calib = [], settings = null }) {
  const snap = (arr) => ({ docs: arr.map(([id, data]) => ({ id, data: () => data })), size: arr.length });
  return {
    collection: (name) => {
      const arr = name === 'days' ? days.map((d, i) => [`d${i}`, d]) : name === 'machines' ? machines : calib;
      const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => snap(arr) };
      return q;
    },
    doc: () => ({ get: async () => ({ exists: !!settings, data: () => settings }) }),
  };
}

function fixtureDays() {
  const { today, addDays } = load('format.js').KeelFormat(P, (k) => k, () => 'en');
  const d = (n) => addDays(today(), -n);
  const sess = (id, usd, date) => ({
    id, project: 'shop', wallet: 'subscription', start: `${date}T10:00:00Z`, end: `${date}T10:30:00Z`, active_min: 5, usd, keel: null, turns: [],
    participants: [{ kind: 'main', model: 'claude-sonnet-5-5-20260101', by_model: { 'claude-sonnet-5-5-20260101': { requests: 1, tok: { in: 1, cw5: 0, cw1h: 0, cr: 0, out: 0 }, usd } }, start: `${date}T10:00:00Z`, end: `${date}T10:30:00Z`, active_min: 5, requests: 1, tools: {}, agents_launched: 0, tok: { in: 1, cw5: 0, cw1h: 0, cr: 0, out: 0 }, usd, output_estimated: false, resumed: false }],
  });
  return { d, sess };
}

const totalRow = /Total · Sessions: (\d+)<\/td><td data-label="\$">\$([\d.,]+)<\/td>/;

function pageFixture() {
  const { d, sess } = fixtureDays();
  const dbDoc = (n, sessions, synced) => ({ schema: 1, date: d(n), pc: 'office', user: 'me@x.com', part: 1, parts: 1, synced_until: synced, hours: [], snapshots: [], sessions });
  return { d, sess, dbDoc };
}

test('index.html: shows the database days of the period; a day synced twice counts once, with the newer copy', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const db = stubDb({ days: [dbDoc(2, [sess('a', 0.13, d(2))], `${d(2)}T23:00:00Z`), dbDoc(1, [sess('b', 0.29, d(1))], `${d(1)}T12:00:00Z`), dbDoc(1, [sess('b', 0.31, d(1))], `${d(1)}T23:00:00Z`)] });
  const page = await openPage({ db });
  const [, n, usd] = totalRow.exec(page.view());
  assert.deepEqual([n, usd], ['2', '0.44'], '0.31 + 0.13');
  assert.deepEqual(page.fetched, [], 'the page reads only its database');
});

test('index.html: a database that does not load shows the error', async () => {
  const broken = { collection: () => { const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => { throw Object.assign(new Error('down'), { code: 'internal' }); } }; return q; }, doc: () => ({ get: async () => { throw new Error('down'); } }) };
  const page = await openPage({ db: broken });
  assert.doesNotMatch(page.view(), /Total · Sessions/);
  assert.match(page.view(), /down/);
});

test('index.html: a database with no data shows the empty state; without a database the page says so', async () => {
  const emptyDb = await openPage({ db: stubDb({}), hash: '#dash' });
  assert.match(emptyDb.view(), /No data yet/);
  const none = await openPage({ hash: '#dash' });
  assert.match(none.view(), /No data connection/);
});

test('index.html: ?demo=1 without a database shows the sample data', async () => {
  const page = await openPage({ search: '?demo=1&lang=en', hash: '#sessions' });
  assert.deepEqual(totalRow.exec(page.view()).slice(1, 2), ['7']);
  assert.match(page.banner(), /Sample data for a layout check/);
  assert.deepEqual(page.fetched, [], 'the demo does not touch the network');
});

test('index.html: the page language sets the texts and the html lang; a page without one keeps the browser\'s', async () => {
  const { d, sess, dbDoc } = pageFixture();
  const days = [dbDoc(1, [sess('a', 0.17, d(1))], `${d(1)}T23:00:00Z`)];
  assert.equal((await openPage({ db: stubDb({ days, settings: { language: 'uk' } }), nav: 'en-US' })).htmlLang(), 'uk');
  const page = await openPage({ db: stubDb({ days }), nav: 'uk-UA' });
  assert.equal(page.htmlLang(), 'uk');
  assert.doesNotMatch(page.view(), /Total · Sessions/, 'Ukrainian texts, not English');
  assert.equal((await openPage({ db: stubDb({ days }), nav: 'en-US' })).htmlLang(), 'en');
});
