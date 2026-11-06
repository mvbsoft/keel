'use strict';
// The usage page's browser scripts outside the page: format.js, colors.js and demo.js each define their
// window function and give everything index.html takes from it.
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
