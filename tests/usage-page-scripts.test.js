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
const { validate } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'schema.js'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'schemas', 'usage-day.schema.json'), 'utf8'));

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
      let from = '';
      const q = {
        where: (f, op, v) => { if (op === '>=') from = v; return q; }, orderBy: () => q, limit: () => q,
        get: async () => {
          const docs = (name === 'days' ? all.filter((d) => d.date >= from).slice(0, 1000) : []).map((d) => ({ id: d.id, data: () => d }));
          return { docs, size: docs.length };
        },
      };
      return q;
    },
    doc: () => ({ get: async () => ({ exists: true, data: () => ({ language: 'uk' }) }) }),
  };
  const out = await L.loadFromDb(db, '2026-01-01', '2026-01-31');
  assert.equal(out.docs.length, 1500, 'each day once, across two pages');
  assert.deepEqual(out.settings, { language: 'uk' });
});

test('demo.js: the sample is the index and month files, valid in the page-file format, and the page reads them', () => {
  const { KeelUsageDemo } = load('demo.js');
  const { files } = KeelUsageDemo((v) => Date.parse(v));
  const index = files['data/index.json'];
  assert.deepEqual(Object.keys(index.pcs), ['office', 'laptop']);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(index)), { ...SCHEMA.$defs.index, $defs: SCHEMA.$defs }), []);
  const monthPaths = Object.keys(files).filter((p) => p !== 'data/index.json');
  assert.ok(monthPaths.length >= 2);
  for (const p of monthPaths) {
    assert.deepEqual(validate(JSON.parse(JSON.stringify(files[p])), { ...SCHEMA.$defs.month, $defs: SCHEMA.$defs }), [], p);
    assert.ok(p in files && files[p].month in index.pcs[files[p].pc].months, `${p} is listed in the index`);
  }
  const docs = monthPaths.flatMap((p) => P.docsOfMonth(files[p].pc, index.pcs[files[p].pc].user, files[p].days));
  const flat = P.flatten(docs);
  assert.equal(flat.sessions.length, 7);
  assert.ok(flat.snapshots.length > 0 && flat.hours.length > 0);
});

// ---- index.html: the whole page script on its own, with a stub page, a stub database and stub files -------------
// Runs the page's inline script against the real pivot.js, i18n, format.js and colors.js. Returns the elements the
// page writes to, once the first data load has finished.
async function openPage({ files, db, hash = '#sessions', search = '', nav = 'en' }) {
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
    fetch: async (p) => {
      fetched.push(p);
      if (!(p in files)) return { ok: false, status: 404 };
      return { ok: true, status: 200, json: async () => files[p] };
    },
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

// The first month of the period and the months the page asks for: today's and the one a week back may differ.
const monthsOf = (d) => [...new Set([d(8), d(1), d(0)].map((x) => x.slice(0, 7)))];
const totalRow = /Total · Sessions: (\d+)<\/td><td data-label="\$">\$([\d.,]+)<\/td>/;

function pageFixture() {
  const { d, sess } = fixtureDays();
  const idx = () => ({
    schema: 2, kind: 'index', language: 'en', template: 't',
    pcs: { office: { name: 'office', user: 'me@x.com', synced_until: `${d(0)}T12:00:00Z`, last_seen: `${d(0)}T12:00:00Z`, calib: null, months: { ...Object.fromEntries(monthsOf(d).map((m) => [m, 'x'])), '2020-01': 'x' } } },
  });
  const day = (n, sessions, synced) => ({ date: d(n), synced_until: synced, contrib: sessions.map((s) => s.id), hours: [], snapshots: [], sessions });
  const files = (days) => {
    const out = { 'data/index.json': idx() };
    for (const m of monthsOf(d)) out[`data/office-${m}.json`] = { schema: 2, kind: 'month', pc: 'office', month: m, days: days.filter((x) => x.date.startsWith(m)) };
    return out;
  };
  const dbDoc = (n, sessions, synced) => ({ schema: 1, date: d(n), pc: 'office', user: 'me@x.com', part: 1, parts: 1, synced_until: synced, hours: [], snapshots: [], sessions });
  return { d, sess, files, day, dbDoc };
}

test('index.html: reads data/index.json and the month files of the period, and counts files and database together', async () => {
  const { d, sess, files, day, dbDoc } = pageFixture();
  const f = files([day(1, [sess('both', 0.31, d(1)), sess('file', 0.17, d(1))], `${d(1)}T23:00:00Z`)]);
  const page = await openPage({ files: f, db: stubDb({ days: [dbDoc(1, [sess('both', 0.29, d(1)), sess('db', 0.13, d(1))], `${d(1)}T12:00:00Z`)] }) });
  assert.ok(page.fetched.includes('data/index.json'));
  assert.deepEqual(page.fetched.filter((p) => p !== 'data/index.json').sort(), monthsOf(d).map((m) => `data/office-${m}.json`).sort(), 'a month outside the period is not fetched');
  const [, n, usd] = totalRow.exec(page.view());
  assert.deepEqual([n, usd], ['3', '0.61'], 'the shared session once, with the newer copy: 0.31 + 0.17 + 0.13');
});

test('index.html: the same session synced later through the database wins over the file copy', async () => {
  const { d, sess, files, day, dbDoc } = pageFixture();
  const f = files([day(1, [sess('both', 0.31, d(1)), sess('file', 0.17, d(1))], `${d(1)}T12:00:00Z`)]);
  const page = await openPage({ files: f, db: stubDb({ days: [dbDoc(1, [sess('both', 0.29, d(1)), sess('db', 0.13, d(1))], `${d(1)}T23:00:00Z`)] }) });
  const [, n, usd] = totalRow.exec(page.view());
  assert.deepEqual([n, usd], ['3', '0.59'], '0.29 + 0.17 + 0.13');
});

test('index.html: a database that does not load leaves the page files on the page', async () => {
  const { d, sess, files, day } = pageFixture();
  const f = files([day(1, [sess('file', 0.17, d(1))], `${d(1)}T23:00:00Z`)]);
  const broken = { collection: () => { const q = { where: () => q, orderBy: () => q, limit: () => q, get: async () => { throw Object.assign(new Error('down'), { code: 'internal' }); } }; return q; }, doc: () => ({ get: async () => { throw new Error('down'); } }) };
  const page = await openPage({ files: f, db: broken });
  assert.deepEqual(totalRow.exec(page.view()).slice(1, 3), ['1', '0.17']);
  const none = await openPage({ files: {}, db: broken });
  assert.doesNotMatch(none.view(), /Total · Sessions/, 'with no source loaded the page shows its error');
});

test('index.html: a month file that does not load does not break the page; the rest shows', async () => {
  const { d, sess, files, day } = pageFixture();
  const f = files([day(1, [sess('file', 0.17, d(1))], `${d(1)}T23:00:00Z`)]);
  f['data/index.json'].pcs.laptop = { ...f['data/index.json'].pcs.office, name: 'laptop' }; // listed, but its files are not on the page
  const page = await openPage({ files: f });
  assert.ok(page.fetched.some((p) => p.startsWith('data/laptop-')));
  assert.deepEqual(totalRow.exec(page.view()).slice(1, 3), ['1', '0.17']);
});

test('index.html: a page with an index and no data shows the empty state; with nothing to read it says so', async () => {
  const { files } = pageFixture();
  const empty = await openPage({ files: files([]), hash: '#dash' });
  assert.match(empty.view(), /class="empty"/);
  assert.doesNotMatch(empty.view(), /Loading data|Could not load/);
  const emptyDb = await openPage({ files: {}, db: stubDb({}), hash: '#dash' });
  assert.match(emptyDb.view(), /No data yet/);
  const none = await openPage({ files: {}, hash: '#dash' });
  assert.match(none.view(), /No data connection/);
});

test('index.html: ?demo=1 without a database shows the demo files through the page-file loading path', async () => {
  const page = await openPage({ files: {}, search: '?demo=1&lang=en', hash: '#sessions' });
  assert.deepEqual(totalRow.exec(page.view()).slice(1, 2), ['7']);
  assert.match(page.banner(), /Sample data for a layout check/);
  assert.deepEqual(page.fetched, [], 'the demo does not touch the network');
});

test('index.html: the page language sets the texts and the html lang; a page without one keeps the browser\'s', async () => {
  const { d, sess, files, day } = pageFixture();
  const f = files([day(1, [sess('file', 0.17, d(1))], `${d(1)}T23:00:00Z`)]);
  f['data/index.json'].language = 'uk';
  assert.equal((await openPage({ files: f, nav: 'en-US' })).htmlLang(), 'uk');
  f['data/index.json'].language = null;
  const page = await openPage({ files: f, nav: 'uk-UA' });
  assert.equal(page.htmlLang(), 'uk');
  assert.doesNotMatch(page.view(), /Total · Sessions/, 'Ukrainian texts, not English');
  assert.equal((await openPage({ files: f, nav: 'en-US' })).htmlLang(), 'en');
});

test('index.html: a visible notice when a month file did not load; none when all loaded', async () => {
  const { d, sess, files, day } = pageFixture();
  const f = files([day(1, [sess('file', 0.17, d(1))], `${d(1)}T23:00:00Z`)]);
  assert.doesNotMatch((await openPage({ files: f })).banner(), /could not be loaded/);
  delete f[`data/office-${monthsOf(d)[0]}.json`];
  assert.match((await openPage({ files: f })).banner(), /Some data files could not be loaded/);
});
