'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadPrices, priceFor, costOf, validate, diff } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'prices.js'));

const entry = (match, input, extra = {}) => ({ match, input, cache_write_5m: input * 1.25, cache_write_1h: input * 2, cache_read: input * 0.1, output: input * 5, ...extra });
const TABLE = { models: [entry('claude-opus-5', 5), entry('claude-opus-5-5', 4), entry('claude-haiku-4', 1)] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keel-prices-'));

test('priceFor: longest matching prefix wins, in any table order', () => {
  assert.equal(priceFor('claude-opus-5-5', TABLE).input, 4);
  assert.equal(priceFor('claude-opus-5-1', TABLE).input, 5);
  assert.equal(priceFor('claude-opus-5', { models: [...TABLE.models].reverse() }).input, 5);
});

test('priceFor: a date or suffix after the match still matches; unknown model is null', () => {
  assert.equal(priceFor('claude-haiku-4-5-20251001', TABLE).match, 'claude-haiku-4');
  assert.equal(priceFor('claude-opus-5-5[1m]', TABLE).match, 'claude-opus-5-5');
  assert.equal(priceFor('gpt-5', TABLE), null);
  assert.equal(priceFor(undefined, TABLE), null);
});

test('costOf: every token kind has its own price; missing keys count as 0; unknown model is null', () => {
  const t = { models: [{ match: 'm', input: 1, cache_write_5m: 2, cache_write_1h: 3, cache_read: 4, output: 5 }] };
  assert.equal(costOf('m-1', { in: 1e6 }, t), 1);
  assert.equal(costOf('m-1', { cw5: 1e6 }, t), 2);
  assert.equal(costOf('m-1', { cw1h: 1e6 }, t), 3);
  assert.equal(costOf('m-1', { cr: 1e6 }, t), 4);
  assert.equal(costOf('m-1', { out: 1e6 }, t), 5);
  assert.equal(costOf('m-1', { in: 1e6, cw5: 1e6, cw1h: 1e6, cr: 1e6, out: 1e6 }, t), 15);
  assert.equal(costOf('m-1', {}, t), 0);
  assert.equal(costOf('other', { in: 1e6 }, t), null);
});

test('loadPrices: bundled by default; a valid override wins and bundled-only models stay', () => {
  const dir = tmp();
  const bundledPath = path.join(dir, 'bundled.json');
  const overridePath = path.join(dir, 'override.json');
  fs.writeFileSync(bundledPath, JSON.stringify({ about: 'b', models: [entry('claude-opus-5', 5), entry('claude-haiku-4', 1)] }));
  const bundled = loadPrices({ overridePath, bundledPath });
  assert.equal(bundled.source, 'bundled');
  assert.equal(bundled.about, 'b');
  fs.writeFileSync(overridePath, JSON.stringify({ models: [entry('claude-opus-5', 9), entry('claude-new-1', 2)] }));
  const t = loadPrices({ overridePath, bundledPath });
  assert.equal(t.source, 'override');
  assert.deepEqual(t.models.map((m) => m.match), ['claude-opus-5', 'claude-new-1', 'claude-haiku-4']);
  assert.equal(priceFor('claude-opus-5', t).input, 9);
});

test('loadPrices: invalid or unreadable override falls back to bundled without throwing', () => {
  const dir = tmp();
  const bundledPath = path.join(dir, 'bundled.json');
  const overridePath = path.join(dir, 'override.json');
  fs.writeFileSync(bundledPath, JSON.stringify({ models: [entry('claude-haiku-4', 1)] }));
  for (const text of ['{ not json', '[]', '{"models": "x"}', '{"models": [{"input": 1}]}']) {
    fs.writeFileSync(overridePath, text);
    const t = loadPrices({ overridePath, bundledPath });
    assert.equal(t.source, 'bundled', text);
    assert.equal(t.models.length, 1);
  }
  assert.equal(loadPrices({ overridePath: path.join(dir, 'missing.json'), bundledPath }).source, 'bundled');
});

test('loadPrices: an override saved with a byte order mark is used, not dropped for the bundled table', () => {
  const dir = tmp();
  const bundledPath = path.join(dir, 'bundled.json');
  const overridePath = path.join(dir, 'override.json');
  fs.writeFileSync(bundledPath, JSON.stringify({ models: [entry('claude-haiku-4', 1)] }));
  fs.writeFileSync(overridePath, '\uFEFF' + JSON.stringify({ models: [entry('claude-haiku-4', 3)] }));
  const t = loadPrices({ overridePath, bundledPath });
  assert.equal(t.source, 'override');
  assert.equal(priceFor('claude-haiku-4', t).input, 3);
});

test('loadPrices: the shipped table loads and validate flags its deliberate opus-5-5 cache_read', () => {
  const t = loadPrices({ overridePath: path.join(tmp(), 'none.json') });
  assert.equal(t.source, 'bundled');
  const warnings = validate(t);
  assert.ok(warnings.some((w) => w.startsWith('claude-opus-5-5:') && w.includes('cache_read')), warnings.join('\n'));
  assert.ok(!warnings.some((w) => w.startsWith('claude-opus-4:')));
});

test('validate: ratio mismatches, missing and negative prices are warned about, never thrown', () => {
  assert.deepEqual(validate(TABLE), []);
  const w = validate({ models: [entry('a', 10, { cache_read: 0.5 }), entry('b', 10, { cache_write_5m: 10 }), entry('c', 10, { cache_write_1h: 25 }),
    entry('d', 10, { output: -1 }), { match: 'e', input: 1 }] });
  assert.ok(w.some((s) => s.startsWith('a:') && s.includes('cache_read')));
  assert.ok(w.some((s) => s.startsWith('b:') && s.includes('cache_write_5m')));
  assert.ok(w.some((s) => s.startsWith('c:') && s.includes('cache_write_1h')));
  assert.ok(w.some((s) => s.startsWith('d:') && s.includes('output') && s.includes('invalid')));
  assert.ok(w.some((s) => s.startsWith('e:') && s.includes('cache_read is missing')));
});

test('diff: added, removed and changed prices', () => {
  const oldT = { models: [entry('a', 1), entry('b', 2)] };
  const newT = { models: [entry('a', 1, { output: 9 }), entry('c', 3)] };
  const d = diff(oldT, newT);
  assert.deepEqual(d.filter((x) => x.field === 'output'), [{ match: 'a', field: 'output', old: 5, new: 9 }]);
  assert.deepEqual(d.filter((x) => x.field === 'added').map((x) => x.match), ['c']);
  assert.deepEqual(d.filter((x) => x.field === 'removed').map((x) => x.match), ['b']);
  assert.equal(d.length, 3);
  assert.deepEqual(diff(oldT, oldT), []);
});

test('long_context: a prompt (input + cache tokens) above `over` costs mult times, at or below it the normal price', () => {
  const t = { models: [{ match: 'lc', input: 1, cache_write_5m: 1, cache_write_1h: 1, cache_read: 1, output: 1, long_context: { over: 100, mult: 5 } }] };
  assert.equal(costOf('lc', { in: 100, out: 1000 }, t), 1100 / 1e6, 'exactly over is still the normal price');
  assert.equal(costOf('lc', { in: 101, out: 1000 }, t), 5 * 1101 / 1e6, 'output is multiplied too');
  assert.equal(costOf('lc', { in: 10, cw5: 30, cw1h: 30, cr: 31 }, t), 5 * 101 / 1e6, 'every cache kind counts toward the prompt');
  assert.equal(costOf('lc', { out: 1e6 }, t), 1, 'output alone is not a prompt');
  // a malformed long_context is ignored, and validate says so
  const bad = { models: [{ match: 'b', input: 1, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, output: 5, long_context: { over: 'x', mult: 5 } }] };
  assert.equal(costOf('b', { in: 1e6 }, bad), 1);
  assert.ok(validate(bad).some((w) => w.startsWith('b: long_context')));
  assert.deepEqual(validate(TABLE), []);
});

test('diff: a changed long_context is reported', () => {
  const a = { models: [entry('m', 1)] };
  const b = { models: [entry('m', 1, { long_context: { over: 200000, mult: 2 } })] };
  assert.deepEqual(diff(a, b), [{ match: 'm', field: 'long_context', old: 'none', new: 'over 200000 tokens x2' }]);
  assert.deepEqual(diff(b, b), []);
});

// The shipped price table, pinned by hand. Changing a price in data/prices.json means updating this list on
// purpose: a typo in the table must not pass silently. [match, input $/M, output $/M]
const PINNED = [
  ['claude-opus-5-5', 4, 20], ['claude-opus-5', 5, 25], ['claude-opus-4', 5, 25],
  ['claude-opus-4-0', 15, 75], ['claude-opus-4-1', 15, 75], ['claude-opus-4-2025', 15, 75],
  ['claude-sonnet-5-5', 2, 10], ['claude-sonnet-5', 2, 10], ['claude-sonnet-4', 3, 15],
  ['claude-haiku-5-5', 0.1, 0.5], ['claude-haiku-4', 1, 5],
];

test('shipped prices: every model row costs exactly the pinned input and output price per million tokens', () => {
  const t = loadPrices({ overridePath: path.join(tmp(), 'none.json') });
  assert.deepEqual(t.models.map((m) => m.match).sort(), PINNED.map(([m]) => m).sort(), 'a row was added or removed: update PINNED');
  for (const [match, input, output] of PINNED) {
    const row = t.models.find((m) => m.match === match);
    // a row with long_context is priced below its threshold, so the pin is the list price, not the surcharge
    const n = row.long_context ? row.long_context.over : 1e6;
    assert.ok(Math.abs(costOf(match, { in: n }, t) - (input * n) / 1e6) < 1e-12, `${match} input`);
    assert.ok(Math.abs(costOf(match, { out: 1e6 }, t) - output) < 1e-12, `${match} output`);
  }
  assert.deepEqual(t.models.find((m) => m.match === 'claude-haiku-5-5').long_context, { over: 100000, mult: 5 });
  assert.ok(t.models.filter((m) => m.long_context).length === 1, 'only haiku-5-5 has a long-context surcharge in the table');
});

test('shipped prices: Opus 4 and 4.1 keep their old price, Opus 4.5 and later the new one, dated ids included', () => {
  const t = loadPrices({ overridePath: path.join(tmp(), 'none.json') });
  for (const id of ['claude-opus-4-0', 'claude-opus-4-20250514', 'claude-opus-4-1', 'claude-opus-4-1-20250805']) assert.equal(priceFor(id, t).input, 15, id);
  for (const id of ['claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']) assert.equal(priceFor(id, t).input, 5, id);
  assert.ok(!validate(t).some((w) => w.startsWith('claude-opus-4')), 'the old rows keep the usual cache ratios');
});
