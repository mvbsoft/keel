'use strict';
// The usage page's separate browser scripts. index.html, format.js, charts.js, load.js and demo.js each define their window
// function and give everything app.js takes from it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dir, P, load } = require('./fixtures/usage-page.js');

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

// The names app.js destructures from a helper object, e.g. `const { esc } = F;` or `... = window.KeelLoad();`.
function taken(pattern) {
  const m = pattern.exec(appSource);
  assert.ok(m, `app.js takes names with ${pattern}`);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

test('index.html: a fragment that loads keel.css, then style.css, then keel-theme.js before its first element; no chart library', () => {
  // The publish tool wraps the file in its own page skeleton, so the template has none.
  assert.doesNotMatch(html, /<!doctype|<\/?(?:html|head|body)\b|charset|name="viewport"/i);
  assert.match(html, /^<title>keel usage<\/title>\n/);
  const top = html.slice(0, html.indexOf('<div class="wrap">'));
  const at = (s) => top.indexOf(s);
  assert.ok(at('fonts.googleapis.com/css2') > 0 && at('fonts.googleapis.com/css2') < at('href="keel.css"'), 'the fonts before keel.css');
  assert.ok(at('href="keel.css"') > 0 && at('href="keel.css"') < at('href="style.css"'), 'keel.css before style.css');
  assert.ok(at('src="keel-theme.js"') > at('href="style.css"'), 'keel-theme.js after the styles, before the first element');
  assert.doesNotMatch(top, /<script[^>]*\b(?:defer|async)\b/, 'keel-theme.js is a plain script');
  assert.doesNotMatch(html, /chart\.js|chart\.umd|cdnjs|<canvas/i, 'no chart library');
  assert.doesNotMatch(html, /<script>/, 'no inline script');
  assert.ok(!fs.existsSync(path.join(dir, 'colors.js')), 'the colour helper file is gone');
  assert.ok(html.indexOf('<script src="menu.js"></script>') > 0 && html.indexOf('src="menu.js"') < html.indexOf('src="app.js"'), 'menu.js is loaded before the frame uses it');
  assert.ok(html.indexOf('<script src="calendar.js"></script>') > 0 && html.indexOf('src="calendar.js"') < html.indexOf('src="app.js"'), 'calendar.js is loaded before the frame uses it');
  for (const f of fs.readdirSync(dir).filter((n) => /\.(js|html)$/.test(n))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /<select|<option/, `${f}: a choice is a keel menu, not a browser select`);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /type="date"/, `${f}: a date is a keel calendar, not the browser's date field`);
  }
});

test('format.js: gives every helper the page takes, and follows the page language as it changes', () => {
  const { KeelFormat } = load('format.js');
  let lang = 'en';
  const F = KeelFormat(P, (key) => key, () => lang);
  for (const name of taken(/const \{([^}]*)\} = F;/)) assert.ok(name in F, `format.js gives ${name}`);
  assert.equal(F.fUsd(12.3), '$12.30');
  assert.equal(F.esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(F.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(F.fMeasure(90, 'time_min'), '1.5 common.hours_short');
  assert.equal(F.fPctAuto(34), '34 %');
  assert.equal(F.fPctAuto(34.25), '34.3 %', 'one digit at most');
  assert.equal(F.fSpan((2 * 1440 + 13 * 60) * 60000), '2 common.days_short 13 common.hours_short');
  assert.equal(F.fSpan(-5), '0 common.minutes_short', 'a moment in the past is zero');
  assert.equal(F.modelName('opus-5-5'), 'Opus 5.5');
  assert.equal(F.modelName('claude-weird'), 'claude-weird', 'a name that is not family-version stays');
  assert.equal(F.dimLabel('model', 'haiku-3-5'), 'Haiku 3.5');
  assert.match(F.walletChip('api'), /class="pill api"/);
  assert.match(F.walletChip('subscription'), /class="pill"/);
  lang = 'uk';
  assert.equal(F.fUsd(12.3), '$12,30', 'the locale is read on each call');
});

test('charts.js: a key keeps its series class; models by family and age, token kinds, any other dimension by index', () => {
  const order = {};
  const { KeelCharts } = load('charts.js');
  const C = KeelCharts({ esc: (s) => String(s), t: (k) => k, order });
  order.model = ['opus-5-5', 'sonnet-5-5', 'opus-4-1'];
  assert.equal(C.seriesClass('model', 'opus-5-5'), 'opus');
  assert.equal(C.seriesClass('model', 'opus-4-1'), 'opus-2', 'an older model of the family is the softer step');
  assert.equal(C.seriesClass('model', 'sonnet-5-5'), 'sonnet');
  assert.equal(C.seriesClass('model', 'fable-5-2'), 'fable');
  assert.equal(C.seriesClass('model', 'haiku-3-5'), 'haiku', 'the only haiku loaded is the newest');
  assert.equal(C.seriesClass('model', 'unknown'), 'm-other');
  assert.equal(C.seriesClass('model', 'gpt-x'), 'm-other');
  assert.deepEqual(['out', 'cw5', 'cw1h', 'cr', 'in'].map((k) => C.seriesClass('kind', k)), ['kind1', 'kind2', 'kind2', 'kind3', 'kind4']);
  order.pc = ['office', 'laptop'];
  assert.deepEqual([C.seriesClass('pc', 'office'), C.seriesClass('pc', 'laptop')], ['s1', 's2']);
  const stray = C.seriesClass('pc', 'cloud');
  assert.match(stray, /^s[1-8]$/);
  assert.equal(C.seriesClass('pc', 'cloud'), stray, 'the same key, the same class');
  order.project = Array.from({ length: 9 }, (_, i) => `p${i}`);
  assert.equal(C.seriesClass('project', 'p8'), 's1', 'the ninth key starts the eight colours again');
});

test('charts.js: nice ticks, columns, bars, stack, line and tables are escaped, labelled text', () => {
  const { KeelCharts } = load('charts.js');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = KeelCharts({ esc, t: (k) => k, order: {} });
  // The script runs in its own realm: compare plain copies.
  const scale = (max) => JSON.parse(JSON.stringify(C.niceScale(max)));
  assert.deepEqual(scale(33.9), { max: 40, ticks: [10, 20, 30, 40] });
  assert.deepEqual(scale(0.3).ticks.map((v) => +v.toFixed(3)), [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(scale(0).ticks, [0.25, 0.5, 0.75, 1], 'nothing to draw still gives a scale');
  assert.deepEqual(scale(10).ticks, [2.5, 5, 7.5, 10]);

  const cols = [{ label: '01.11', tip: '01.11 · $4', parts: [{ cls: 'opus', value: 3 }, { cls: 'haiku', value: 1 }], pick: '2026-11-01' },
    { label: '02.11', tip: '02.11 · $0', parts: [{ cls: 'opus', value: 0 }], pick: null }];
  const picked = C.columns({ cols, fmt: (v) => `$${v}`, summary: 'Spend <by> day' });
  assert.match(picked, /role="group" aria-label="Spend &lt;by&gt; day"/, 'buttons stay reachable: a group, not an image');
  assert.match(picked, /<button type="button" class="colm" data-pick="2026-11-01" title="01.11 · \$4" aria-label="01.11 · \$4"><i class="opus" style="height:75.00%"><\/i><i class="haiku" style="height:25.00%"><\/i><\/button>/);
  assert.match(picked, /<div class="colm" title="02.11 · \$0"><\/div>/, 'an empty day is a plain column');
  assert.equal((picked.match(/class="y"/g) || []).length, 4, 'four y ticks');
  assert.match(C.columns({ cols: [cols[1]], fmt: String, summary: 's' }), /role="img"/, 'nothing to press: an image');

  const bars = C.bars([{ name: '<keel>', value: '$9', pct: '50 %', width: 100, pick: 'keel' }, { name: 'x', value: '$1', note: 'note', cls: 'kind1' }]);
  assert.match(bars, /<button type="button" class="name" data-pick="keel" title="&lt;keel&gt;">&lt;keel&gt;<\/button>/);
  assert.match(bars, /<div class="track"><i style="width:100.0%"><\/i><\/div>/);
  assert.match(bars, /<i class="dot kind1"><\/i>x/);
  assert.match(C.stack([{ cls: 'kind1', share: 42.34 }], 'Output 42 %'), /role="img" aria-label="Output 42 %"><i class="kind1" style="width:42.3%">/);
  assert.match(C.legend([{ cls: 'opus', label: 'Opus 5.5' }]), /<span><i class="dot opus"><\/i>Opus 5.5<\/span>/);
  assert.match(C.table(['A', 'B'], [['<x>', '1']]), /<th scope="col">A<\/th><th scope="col" class="r">B<\/th>[\s\S]*<td>&lt;x&gt;<\/td><td class="r">1<\/td>/);
  assert.match(C.tableDetails(['A'], [['1']]), /^<details class="fallback"><summary>chart\.table<\/summary>/);

  const svg = C.line({
    xMin: 0, xMax: 100, yMax: 34, fmtY: (v) => `${v} %`, summary: 'Weekly',
    xTicks: [{ x: 0, label: 'Sun' }, { x: 100, label: 'Sat' }],
    series: [{ pts: [{ x: 0, y: 0 }, { x: 50, y: 20 }, null, { x: 60, y: 5 }, { x: 80, y: 30 }], area: true, dot: true, label: '30 % now' },
      { pts: [{ x: 80, y: 30 }, { x: 100, y: 40 }], dashed: true }],
  });
  assert.match(svg, /^<svg class="lc" viewBox="0 0 700 220" role="img" aria-label="Weekly">/);
  assert.equal((svg.match(/class="ln"/g) || []).length, 2, 'a gap in the data breaks the line');
  assert.equal((svg.match(/class="area"/g) || []).length, 2);
  assert.equal((svg.match(/class="dash"/g) || []).length, 1);
  assert.match(svg, /<circle [^>]*r="6"><\/circle><text class="end"[^>]*>30 % now<\/text>/);
  assert.match(svg, /<text x="32" y="194" text-anchor="end">0 %<\/text>/);
  assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b|rgb|hsl/i, 'no colour in the drawing');
});

test('load.js: gives every loader the page takes; database days are read page by page past 1000', async () => {
  const { KeelLoad } = load('load.js', { setTimeout });
  const L = KeelLoad();
  for (const name of taken(/const \{([^}]*)\} = window\.KeelLoad\(/)) assert.ok(name in L, `load.js gives ${name}`);
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
  assert.match(appSource, /Object\.assign\(S, window\.KeelUsageDemo\(toMs\)\)/);
  const demo = KeelUsageDemo((v) => Date.parse(v));
  assert.deepEqual(Object.keys(demo).sort(), ['calibs', 'docs', 'machines']);
  const flat = P.flatten(demo.docs);
  assert.deepEqual(Array.from(demo.machines, (m) => m.name), ['office', 'laptop']);
  assert.deepEqual(Array.from(demo.calibs, (c) => c.pc), ['office', 'laptop']);
  assert.ok(flat.snapshots.length > 0 && flat.hours.length > 0);
  // A month of use, not a few days: about 40 sessions on about three weeks of the 30 days, in four projects.
  const days = new Set(flat.sessions.map((s) => s.date));
  assert.ok(flat.sessions.length >= 35 && flat.sessions.length <= 45, `${flat.sessions.length} sessions`);
  assert.ok(days.size >= 18 && days.size <= 27, `${days.size} days with work, the rest without`);
  assert.deepEqual([...new Set(flat.sessions.map((s) => s.project))].sort(), ['keel', 'mobile-api', 'shop', 'tools']);
  assert.deepEqual([...new Set(flat.sessions.map((s) => s.wallet))].sort(), ['api', 'subscription']);
  assert.deepEqual([...new Set(flat.sessions.map((s) => (s.keel && s.keel.level) || 'none'))].sort(), ['basic', 'maximum', 'none', 'standard']);
  assert.deepEqual([...new Set(flat.rows.map((r) => P.family(r.model)))].sort(), ['fable-5-2', 'haiku-5-5', 'opus-5-5', 'sonnet-5-5']);
  assert.deepEqual([...new Set(flat.rows.filter((r) => r.kind === 'agent').map((r) => r.participant))].sort(), ['context', 'implementer', 'qa', 'reviewer', 'verifier']);
  const fable = flat.rows.filter((r) => r.model.includes('fable')).map((r) => r.date).sort();
  assert.ok(fable[0] >= [...days].sort()[days.size - 7], 'the newest model appears only in the last days');
  const withDetails = flat.sessions.filter((s) => s.turns.some((x) => x.tok));
  assert.ok(withDetails.length >= 2 && withDetails.length < flat.sessions.length, 'some sessions keep the per-message details, the rest has none');
  const titles = flat.sessions.map((s) => s.keel && s.keel.task).filter(Boolean);
  assert.equal(new Set(titles).size, titles.length, 'every checked session has its own title');
  const points = demo.calibs[0].weekly.points.length + demo.calibs[0].five_hour.points.length;
  assert.ok(points >= 18 && points <= 28, `${points} measurements`);
});

test('demo.js: the same moment gives the same month, and the weekly limit has readings over the week', () => {
  const NOW = Date.UTC(2026, 10, 14, 13, 30);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const run = () => load('demo.js', { Date: FixedDate }).KeelUsageDemo((v) => Date.parse(v));
  assert.deepEqual(JSON.parse(JSON.stringify(run())), JSON.parse(JSON.stringify(run())));
  const flat = P.flatten(run().docs);
  const week = flat.snapshots.filter((s) => Date.parse(s.t) > NOW - 3.6 * 864e5 && typeof s.seven_day === 'number').sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  assert.ok(week.length >= 6, 'enough readings for a line this week');
  assert.deepEqual(week.map((s) => s.seven_day), week.map((s) => s.seven_day).slice().sort((a, b) => a - b), 'the percentage only grows within a week');
});

test('the page scripts: a group of pills is written in one place, the frame\'s helper the views call', () => {
  const source = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
  const scripts = fs.readdirSync(dir).filter((n) => /\.js$/.test(n));
  assert.deepEqual(scripts.filter((n) => /class="seg/.test(source(n))), ['app.js']);
  assert.equal(source('app.js').match(/class="seg/g).length, 1);
  assert.deepEqual(scripts.filter((n) => /app\.seg\(/.test(source(n))).sort(), ['view-analysis.js', 'view-overview.js', 'view-sessions.js']);
});

test('the page scripts: every text key they use is in the English texts', () => {
  const { en } = require(path.join(dir, 'i18n.js'));
  const used = new Set();
  for (const f of fs.readdirSync(dir).filter((n) => /\.js$/.test(n) && !/^(i18n|pivot)/.test(n))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\bt\(\s*['"`]([a-z_.0-9]+)['"`]/g)) used.add(m[1]);
  }
  used.delete('wallet.'); // walletName builds wallet.<name>; every wallet has its key
  assert.deepEqual([...used].filter((k) => !(k in en)), []);
});
