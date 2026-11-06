'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');
const { writeSession } = require('./fixtures/usage.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const store = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-store.js'));
const files = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-files.js'));
const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'), 'utf8'));
const asDef = (name) => ({ $defs: SCHEMA.$defs, $ref: `#/$defs/${name}` });

const TABLE = { models: [{ match: 'm1', input: 1000000, cache_write_5m: 1250000, cache_write_1h: 2000000, cache_read: 100000, output: 5000000 }] };
const MACHINE = { pc: 'pc1', user: 'u@x.y', wallet_default: 'subscription', also_api: false, prompt_preview: true };
const DAY = Date.UTC(2026, 2, 3, 12, 0, 0);
const MIN = 60000;
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const req = (t) => ({ t, model: 'm1', tok: { in: 1000 } });
const usdOf = (day) => Math.round(sum(day.hours.map((h) => h.usd)) * 1e6) / 1e6;

function env() {
  const root = tempDir('keel-files-proj-');
  const dir = tempDir('keel-files-usage-');
  const build = (extra = {}) => store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: dir, prices: TABLE, sinceMs: 0, files: true, ...extra });
  return { root, dir, build };
}

function setWallet(dir, id, wallet) {
  fs.appendFileSync(path.join(dir, 'sessions.jsonl'), `${JSON.stringify({ session_id: id, wallet })}\n`);
}

test('buildDays with files: whole days with contrib, no parts; a month file and an index validate', () => {
  const e = env();
  writeSession(e.root, { id: 'a', rows: [{ t: DAY, prompt: 'go' }, req(DAY + MIN), req(DAY + 2 * MIN)] });
  writeSession(e.root, { id: 'quiet', rows: [{ t: DAY + 3 * MIN, prompt: 'only a prompt' }] });
  const { built, days, docs } = e.build();
  assert.equal(docs, undefined, 'no day documents in files mode');
  assert.deepEqual(days, ['2026-03-03']);
  assert.equal(built.length, 1);
  const day = built[0];
  assert.deepEqual(day.contrib, ['a'], 'a session without requests on the day is not a contributor');
  assert.ok(!('part' in day) && !('parts' in day));
  assert.deepEqual(validate(day, asDef('month_day')), []);

  const month = files.monthFiles('pc1', built)['2026-03'];
  assert.deepEqual(validate(month, asDef('month')), []);
  const text = files.serialize(month);
  const index = {
    schema: 2, kind: 'index', language: 'en', template: 'abcdef012345', cleared_at: null,
    pcs: {
      pc1: files.indexEntry(null, {
        machine: MACHINE, installId: 'i-1', nowIso: '2026-03-03T13:00:00.000Z', syncedUntil: day.synced_until,
        recent: files.recentOf([month], 0), months: { '2026-03': files.sha256(text) },
      }),
    },
  };
  assert.deepEqual(validate(index, asDef('index')), []);
  assert.deepEqual(files.identify(JSON.parse(text)), { kind: 'month', pc: 'pc1', month: '2026-03' });
  assert.deepEqual(files.identify(index), { kind: 'index' });
  assert.equal(files.identify({ schema: 1, kind: 'month', pc: 'pc1', month: '2026-03', days: [] }), null);
  assert.equal(files.identify({ schema: 2, kind: 'month', pc: '../x', month: '2026-03', days: [] }), null);
  assert.equal(files.identify([]), null);
});

test('a session across the end of a UTC month: one day in each month file, the session counted in both', () => {
  const e = env();
  const t0 = Date.UTC(2026, 0, 31, 23, 50, 0);
  writeSession(e.root, { id: 'night', rows: [{ t: t0, prompt: 'go' }, req(t0 + 5 * MIN), req(t0 + 20 * MIN)] });
  const out = files.monthFiles('pc1', e.build().built);
  assert.deepEqual(Object.keys(out).sort(), ['2026-01', '2026-02']);
  assert.deepEqual(out['2026-01'].days.map((d) => [d.date, d.contrib, d.sessions.length]), [['2026-01-31', ['night'], 1]]);
  assert.deepEqual(out['2026-02'].days.map((d) => [d.date, d.contrib, d.sessions.length]), [['2026-02-01', ['night'], 0]],
    'the session is listed on the day it started');
  assert.equal(files.fileName('pc1', '2026-02'), 'pc1-2026-02.json');
});

test('a wiped machine: the page copy is the base, days it cannot rebuild stay, nothing is lost', () => {
  const e = env();
  const early = DAY - 2 * 24 * 60 * MIN;
  const oldFile = writeSession(e.root, { id: 'old', rows: [{ t: early, prompt: 'a' }, req(early + MIN)] }).file;
  writeSession(e.root, { id: 'b', rows: [{ t: DAY, prompt: 'b' }, req(DAY + MIN)] });
  const page = files.monthFiles('pc1', e.build().built)['2026-03'];
  // The machine is reinstalled: no cache, and Claude Code has deleted the older transcript.
  fs.rmSync(oldFile);
  const fresh = env();
  fs.cpSync(e.root, fresh.root, { recursive: true });
  writeSession(fresh.root, { id: 'c', rows: [{ t: DAY + 60 * MIN, prompt: 'c' }, req(DAY + 61 * MIN)] });
  const merged = files.monthFiles('pc1', fresh.build().built, { '2026-03': JSON.parse(files.serialize(page)) })['2026-03'];
  assert.deepEqual(merged.days.map((d) => d.date), ['2026-03-01', '2026-03-03']);
  assert.deepEqual(merged.days[0], page.days[0], 'the day no transcript is left for is kept as the page had it');
  assert.deepEqual(merged.days[1].sessions.map((s) => s.id), ['b', 'c']);
  assert.deepEqual(merged.days[1].contrib, ['b', 'c']);
  assert.equal(sum(merged.days[1].hours.map((h) => h.req)), 2);
});

test('a wallet change rebuilds the day without counting it twice', () => {
  const e = env();
  writeSession(e.root, { id: 'a', rows: [{ t: DAY, prompt: 'a' }, req(DAY + MIN), req(DAY + 2 * MIN)] });
  const first = files.monthFiles('pc1', e.build().built);
  const before = first['2026-03'].days[0];
  assert.deepEqual(before.hours.map((h) => h.wallet), ['subscription']);
  setWallet(e.dir, 'a', 'api');
  const day = files.monthFiles('pc1', e.build().built, first)['2026-03'].days[0];
  assert.deepEqual(day.hours.map((h) => h.wallet), ['api']);
  assert.equal(usdOf(day), usdOf(before));
  assert.equal(day.sessions[0].wallet, 'api');
});

test('a contributor missing from the rebuild keeps the old hours; sessions are merged by id', () => {
  const old = {
    date: '2026-03-03', synced_until: 't1', contrib: ['gone', 'x'],
    hours: [{ h: '2026-03-03T10:00:00.000Z', wallet: 'subscription', usd: 3, req: 3, tok: { in: 3, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: { m1: 3 } }],
    snapshots: [{ t: '2026-03-03T10:00:00.000Z', five_hour: 1, seven_day: 2 }],
    sessions: [{ id: 'gone', start: '2026-03-03T09:00:00.000Z' }, { id: 'x', start: '2026-03-03T10:00:00.000Z', usd: 1 }],
  };
  const rebuilt = {
    date: '2026-03-03', synced_until: 't2', contrib: ['x'],
    hours: [{ ...old.hours[0], usd: 1, req: 1 }],
    snapshots: [old.snapshots[0], { t: '2026-03-03T11:00:00.000Z', five_hour: 2, seven_day: 3 }],
    sessions: [{ id: 'x', start: '2026-03-03T10:00:00.000Z', usd: 2 }],
  };
  const m = files.mergeDay(old, rebuilt);
  assert.deepEqual(m.hours, old.hours);
  assert.deepEqual(m.contrib, old.contrib);
  assert.deepEqual(m.sessions.map((s) => [s.id, s.usd]), [['gone', undefined], ['x', 2]], 'the rebuilt session wins');
  assert.equal(m.snapshots.length, 2, 'snapshots are joined without duplicates');
  assert.equal(m.synced_until, 't2');

  const complete = files.mergeDay(old, { ...rebuilt, contrib: ['gone', 'x'] });
  assert.deepEqual(complete.hours, rebuilt.hours, 'with every contributor rebuilt the hours are replaced');
  assert.equal(files.mergeDay(null, rebuilt), rebuilt);
});

test('cleared_at from another machine: nothing from before it stays, and the day of the clear is rebuilt from the clear', () => {
  const e = env();
  const prev = DAY - 24 * 60 * MIN;
  writeSession(e.root, { id: 'p', rows: [{ t: prev, prompt: 'p' }, req(prev + MIN)] });
  writeSession(e.root, { id: 'before', rows: [{ t: DAY, prompt: 'a' }, req(DAY + MIN)] });
  writeSession(e.root, { id: 'after', rows: [{ t: DAY + 120 * MIN, prompt: 'b' }, req(DAY + 121 * MIN)] });
  const page = files.monthFiles('pc1', e.build().built)['2026-03'];
  const clearedAt = new Date(DAY + 60 * MIN).toISOString();

  const cut = files.applyCleared(page, clearedAt);
  assert.deepEqual(cut.days.map((d) => d.date), ['2026-03-03']);
  const day = cut.days[0];
  assert.deepEqual(day.contrib, []);
  assert.deepEqual(day.sessions.map((s) => s.id), ['after']);
  assert.ok(day.hours.every((h) => Date.parse(h.h) >= Date.parse(clearedAt)));
  assert.equal(files.applyCleared(page, null), page);

  const merged = files.monthFiles('pc1', e.build({ fromMs: Date.parse(clearedAt) }).built, { '2026-03': cut })['2026-03'];
  assert.deepEqual(merged.days.map((d) => d.date), ['2026-03-03']);
  assert.deepEqual(merged.days[0].contrib, ['after'], 'the rebuild counts only what came after the clear');
  assert.equal(sum(merged.days[0].hours.map((h) => h.req)), 1);
  assert.deepEqual(merged.days[0].sessions.map((s) => s.id), ['after']);
});

test('a clear on a day boundary drops the earlier days and keeps the later ones whole', () => {
  const file = {
    schema: 2, kind: 'month', pc: 'pc1', month: '2026-03',
    days: ['2026-03-01', '2026-03-02'].map((date) => ({ date, synced_until: 't', contrib: ['s'], hours: [], snapshots: [], sessions: [{ id: 's', start: `${date}T05:00:00.000Z` }] })),
  };
  const cut = files.applyCleared(file, '2026-03-02T00:00:00.000Z');
  assert.deepEqual(cut.days, [file.days[1]]);
});

test('machine name: free, mine, taken by another install, or a question when this install has no id yet', () => {
  const index = { pcs: { pc1: { install_id: 'i-1' } } };
  assert.equal(files.nameOwner(index, 'pc2', 'i-1'), 'free');
  assert.equal(files.nameOwner(null, 'pc1', 'i-1'), 'free');
  assert.equal(files.nameOwner(index, 'pc1', 'i-1'), 'mine');
  assert.equal(files.nameOwner(index, 'pc1', 'i-2'), 'taken');
  assert.equal(files.nameOwner(index, 'pc1', null), 'ask');
  for (const name of ['constructor', '__proto__', 'toString']) assert.equal(files.nameOwner({ pcs: {} }, name, 'i-1'), 'free', name);
});

test('recovery: a month whose page copy differs from the local file, or has no local file, is read first', () => {
  const entry = { months: { '2026-01': 'a'.repeat(64), '2026-02': 'b'.repeat(64), '2026-03': 'c'.repeat(64) } };
  assert.deepEqual(files.toRecover(entry, { '2026-01': 'a'.repeat(64), '2026-02': 'x'.repeat(64) }), ['2026-02', '2026-03']);
  assert.deepEqual(files.toRecover(null, {}), []);
});

test('index entry: months this sync does not publish keep their sha; recent keeps only the window', () => {
  const prev = { months: { '2026-01': 'a'.repeat(64), '2026-02': 'b'.repeat(64) } };
  const e = files.indexEntry(prev, { machine: MACHINE, installId: 'i-1', nowIso: 'n', syncedUntil: 's', recent: { hours: [], snapshots: [] }, months: { '2026-02': 'c'.repeat(64) } });
  assert.deepEqual(e.months, { '2026-01': 'a'.repeat(64), '2026-02': 'c'.repeat(64) });
  assert.deepEqual([e.name, e.user, e.wallet_default, e.install_id, e.calib], ['pc1', 'u@x.y', 'subscription', 'i-1', null]);

  const hour = (h) => ({ h, wallet: 'subscription', usd: 1, req: 1, tok: { in: 1, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: { m1: 1 } });
  const month = {
    schema: 2, kind: 'month', pc: 'pc1', month: '2026-03',
    days: [
      { date: '2026-03-01', synced_until: 't', contrib: [], hours: [hour('2026-03-01T10:00:00.000Z')], snapshots: [{ t: '2026-03-01T10:00:00.000Z', five_hour: 1, seven_day: 1 }], sessions: [] },
      { date: '2026-03-02', synced_until: 't', contrib: [], hours: [hour('2026-03-02T09:00:00.000Z'), hour('2026-03-02T11:00:00.000Z')], snapshots: [{ t: '2026-03-02T11:00:00.000Z', five_hour: 2, seven_day: 2 }], sessions: [] },
    ],
  };
  const r = files.recentOf([month], Date.parse('2026-03-02T10:00:00.000Z'));
  assert.deepEqual(r.hours, [{ h: '2026-03-02T11:00:00.000Z', wallet: 'subscription', usd: 1, by_model: { m1: 1 } }]);
  assert.deepEqual(r.snapshots.map((s) => s.t), ['2026-03-02T11:00:00.000Z']);
});

test('sha256 is taken over the published UTF-8 bytes, also for non-ASCII text', () => {
  const text = files.serialize({ schema: 2, kind: 'month', pc: 'pc1', month: '2026-03', days: [{ branch: 'гілка-✓' }] });
  // Digest of the same bytes computed outside Node (sha256sum of the file written as UTF-8).
  assert.equal(files.sha256(text), '81f3be6fb1d948917916b3d2d27cb8687ce12a9913a18f982e44fb00bf219163');
});

test('buildDays with files and nothing changed: an empty list of days, no day documents', () => {
  const e = env();
  writeSession(e.root, { id: 'a', rows: [{ t: DAY, prompt: 'a' }, req(DAY + MIN)], mtimeMs: DAY });
  const r = e.build({ sinceMs: Date.now() + 60000 });
  assert.deepEqual([r.built, r.days, r.docs], [[], [], undefined]);
});

test('a clear in the middle of an hour drops that hour and the earlier snapshots of the day', () => {
  const hour = (h, req) => ({ h, wallet: 'subscription', usd: req, req, tok: { in: req, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: { m1: req } });
  const file = {
    schema: 2, kind: 'month', pc: 'pc1', month: '2026-03',
    days: [{
      date: '2026-03-03', synced_until: 't', contrib: ['s'],
      hours: [hour('2026-03-03T12:00:00.000Z', 2), hour('2026-03-03T13:00:00.000Z', 1)],
      snapshots: [{ t: '2026-03-03T12:20:00.000Z', five_hour: 1, seven_day: 1 }, { t: '2026-03-03T12:40:00.000Z', five_hour: 2, seven_day: 2 }],
      sessions: [{ id: 's', start: '2026-03-03T12:10:00.000Z' }],
    }],
  };
  const day = files.applyCleared(file, '2026-03-03T12:30:00.000Z').days[0];
  assert.deepEqual(day.hours.map((h) => h.h), ['2026-03-03T13:00:00.000Z'], 'the 12:00 hour held requests from before the clear');
  assert.deepEqual(day.snapshots.map((s) => s.t), ['2026-03-03T12:40:00.000Z']);
  assert.deepEqual(day.sessions, []);
});
