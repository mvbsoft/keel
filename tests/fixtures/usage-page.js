'use strict';
// The usage page's scripts run in a stub page: what the usage page tests share.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('./mini-dom.js');

const dir = path.join(__dirname, '..', '..', 'plugins', 'keel', 'templates', 'usage');
const P = require(path.join(dir, 'pivot.js'));
const VIEW_FILES = fs.readdirSync(dir).filter((f) => /^view-.*\.js$/.test(f)).sort();

// Runs a page script with only the globals given; returns its `window`.
function load(name, globals = {}) {
  const window = { ...(globals.window || {}) };
  vm.runInNewContext(fs.readFileSync(path.join(dir, name), 'utf8'), { ...globals, window });
  return window;
}

// ---- the page: app.js and the views on their own, with a stub page and a stub database ---------------------------
class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }

// Runs the page's scripts against the real pivot.js, i18n, format.js, charts.js, menu.js, calendar.js, load.js and demo.js. Returns the
// elements the page writes to, once the first data load has finished; `fetched` lists any network request.
async function openPage({ db, downloads, hash = '#sessions', search = '', nav = 'en', stored = {} }) {
  const elements = {};
  const focused = [];
  const docListeners = [];
  const el = (id) => elements[id] || (elements[id] = {
    id, innerHTML: '', hidden: false, dataset: {}, listeners: [], setAttribute() {}, querySelector: () => null, closest: () => null, focus() { focused.push(id); },
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(([t2, f2]) => t2 !== type || f2 !== fn); },
  });
  const window = { claude: { use: async (n) => (n === 'db' && db ? db : n === 'downloads' && downloads ? downloads : Promise.reject(new Error('no capability'))) }, addEventListener() {}, scrollTo() {} };
  const fetched = [];
  const saved = {};
  const root = { lang: '', getAttribute: () => null };
  const location = { search, hash };
  const ctx = vm.createContext({
    window, self: window, console: { warn() {}, log() {} }, setTimeout, clearTimeout, Intl, URL, Event,
    document: { getElementById: el, documentElement: root, addEventListener: (type, fn) => docListeners.push([type, fn]), createElement: () => ({}), body: { appendChild() {} } },
    location, history: { length: 1 }, navigator: { language: nav },
    sessionStorage: { getItem: (k) => (stored[k] ? JSON.stringify(stored[k]) : null), setItem: (k, v) => { saved[k] = JSON.parse(v); } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: async (p) => { fetched.push(p); return { ok: false, status: 404 }; },
  });
  const scripts = ['pivot.js', 'i18n.js', 'i18n.uk.js', 'format.js', 'charts.js', 'menu.js', 'calendar.js', 'load.js', 'demo.js', ...VIEW_FILES, 'app.js'];
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  for (let i = 0; i < 400 && (!el('view').innerHTML || /class="loading"/.test(el('view').innerHTML)); i++) await new Promise((r) => setTimeout(r, 5));
  // Presses what `selector` matches inside the view: runs the view's delegated listeners with a stand-in element.
  const press = (type, selector, dataset) => {
    const target = { dataset, closest: (s) => (s === selector ? { dataset } : null) };
    for (const [t2, fn] of el('view').listeners) if (t2 === type) fn({ target });
  };
  // The view as nodes, for what a person does with a menu: events go to the view's listeners (a click on to the document's).
  // Take a new one after every change: the page draws its markup again.
  const dom = () => parse(el('view').innerHTML, (type, event) => {
    for (const [t2, fn] of el('view').listeners) if (t2 === type) fn(event);
    if (type === 'click') for (const [t2, fn] of docListeners) if (t2 === 'click') fn(event);
  });
  // The header as nodes: the same, with the header's listeners (the calendar's and the page's own).
  const header = () => parse(el('top').innerHTML, (type, event) => {
    for (const [t2, fn] of el('top').listeners) if (t2 === type) fn(event);
    if (type === 'click') for (const [t2, fn] of docListeners) if (t2 === 'click') fn(event);
  });
  // Opens the menu with the trigger `id` and chooses the row with `value`, by mouse.
  const choose = (id, value) => {
    const d = dom();
    d.fire('click', d.byId(id));
    const row = d.byId(`${id}_list`).querySelectorAll('.menu-item').find((r) => r.dataset.value === value);
    assert.ok(row, `${id} has a row for ${JSON.stringify(value)}`);
    d.fire('click', row);
  };
  return { el, view: () => el('view').innerHTML, banner: () => el('banner').innerHTML, top: () => el('top').innerHTML, fetched, window, location, saved, press, dom, header, choose, focused, htmlLang: () => root.lang };
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

// The sessions list's total sits in a table foot now (a plain design-system table, no data-label cells).
const totalRow = /Total · Sessions: (\d+)<\/td><td class="r">\$([\d.,]+)<\/td>/;

function pageFixture() {
  const { d, sess } = fixtureDays();
  const dbDoc = (n, sessions, synced, extra = {}) => ({ schema: 1, date: d(n), pc: 'office', user: 'me@x.com', part: 1, parts: 1, synced_until: synced, hours: [], snapshots: [], sessions, ...extra });
  return { d, sess, dbDoc };
}

const demoDocs = () => load('demo.js').KeelUsageDemo((v) => Date.parse(v)).docs;
const demoPage = (hash, lang = 'en') => openPage({ search: `?demo=1&lang=${lang}`, hash });

module.exports = { dir, P, VIEW_FILES, load, openPage, stubDb, totalRow, pageFixture, demoDocs, demoPage };
