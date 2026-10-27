'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const store = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-store.js'));
const { validate, checkSchema } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'), 'utf8'));
const { buildSession, price, REQ, SESSION_ID } = require('./fixtures/transcripts.js');
const { writeSession, appendRequest } = require('./fixtures/usage.js');

const TABLE = {
  models: [
    { match: 'test-opus-1', input: 1000, cache_write_5m: 1250, cache_write_1h: 2000, cache_read: 100, output: 5000 },
    { match: 'test-haiku-1', input: 200, cache_write_5m: 250, cache_write_1h: 400, cache_read: 20, output: 1000 },
    { match: 'm1', input: 1000000, cache_write_5m: 1250000, cache_write_1h: 2000000, cache_read: 100000, output: 5000000 },
  ],
};
const MACHINE = { pc: 'pc 1', user: 'u@x.y', wallet_default: 'subscription', cloud_wallet: 'credit', also_api: false, prompt_preview: true };
const DAY = Date.UTC(2026, 2, 3, 12, 0, 0);
const MIN = 60000;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} is not ${b}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

function env() {
  const root = tempDir('keel-store-proj-');
  const dir = tempDir('keel-store-usage-');
  const build = (extra = {}) => store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: dir, prices: TABLE, sinceMs: 0, ...extra });
  return { root, dir, build };
}

const req = (t, tok = { in: 1000 }) => ({ t, model: 'm1', tok });
const byId = (docs) => Object.fromEntries(docs.map((d) => [d.id, d.doc]));
const size = (doc) => Buffer.byteLength(JSON.stringify(doc));

test('the schema is a valid keel schema', () => {
  assert.deepEqual(checkSchema(SCHEMA), []);
});

test('day document: shape validates against the schema, hours and sessions match the transcripts', () => {
  const e = env();
  buildSession(e.root);
  const { docs, days } = e.build();
  assert.deepEqual(days, ['2026-01-01']);
  assert.equal(docs.length, 1);
  const { id, doc } = docs[0];
  assert.equal(id, '2026-01-01_pc_1');
  assert.deepEqual(validate(doc, SCHEMA), []);
  assert.deepEqual([doc.pc, doc.user, doc.part, doc.parts, doc.date], ['pc_1', 'u@x.y', 1, 1, '2026-01-01']);
  assert.equal(doc.hours.length, 1);
  assert.equal(doc.hours[0].h, '2026-01-01T10:00:00.000Z');
  assert.equal(doc.hours[0].req, 9);
  const priced = sum(Object.values(REQ).map((r) => price(r.model, r.tok) || 0));
  near(doc.hours[0].usd, priced);
  assert.deepEqual(Object.keys(doc.hours[0].by_model).sort(), ['test-haiku-1', 'test-opus-1']);
  assert.equal(doc.sessions.length, 1);
  const s = doc.sessions[0];
  assert.equal(s.id, SESSION_ID);
  assert.equal(s.project, 'demo');
  assert.equal(s.branch, 'feature-x');
  assert.equal(s.wallet, 'subscription');
  assert.equal(s.cost_cc, null);
  assert.equal(s.keel, null);
  assert.deepEqual(s.unpriced, ['test-mystery-1']);
  near(s.usd, priced);
  assert.equal(s.participants.length, 3);
  assert.ok(s.turns.every((t) => t.t === null || /^\d{4}-\d\d-\d\dT/.test(t.t)));
  assert.ok(!('requests' in s), 'the per-request list is not stored');
});

test('a session across midnight: hours in two documents, the session in the day it started', () => {
  const e = env();
  const t0 = Date.UTC(2026, 2, 3, 23, 50, 0);
  writeSession(e.root, { id: 'night', rows: [{ t: t0, prompt: 'go' }, req(t0 + 5 * MIN), req(t0 + 20 * MIN)] });
  const { docs, days } = e.build();
  assert.deepEqual(days, ['2026-03-03', '2026-03-04']);
  const d = byId(docs);
  assert.equal(d['2026-03-03_pc_1'].sessions.length, 1);
  assert.equal(d['2026-03-04_pc_1'].sessions.length, 0);
  assert.deepEqual(d['2026-03-03_pc_1'].hours.map((h) => h.h), ['2026-03-03T23:00:00.000Z']);
  assert.deepEqual(d['2026-03-04_pc_1'].hours.map((h) => h.h), ['2026-03-04T00:00:00.000Z']);
  for (const doc of docs.map((x) => x.doc)) assert.deepEqual(validate(doc, SCHEMA), []);
  near(sum(docs.flatMap((x) => x.doc.hours.map((h) => h.usd))), d['2026-03-03_pc_1'].sessions[0].usd);
});

test('wallet: the last sessions.jsonl line wins, unmarked sessions use the default, also_api makes them unknown', () => {
  const e = env();
  for (const id of ['s-api', 's-none']) writeSession(e.root, { id, rows: [{ t: DAY, prompt: 'x' }, req(DAY + MIN)] });
  fs.writeFileSync(path.join(e.dir, 'sessions.jsonl'), [
    { session_id: 's-api', wallet: 'api' }, { session_id: 's-api', wallet: 'credit' }, { session_id: 's-api', wallet: 'bogus' }, { session_id: 'other', wallet: 'api' },
  ].map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
  const wallets = (extra) => Object.fromEntries(e.build(extra).docs[0].doc.sessions.map((s) => [s.id, s.wallet]));
  assert.deepEqual(wallets(), { 's-api': 'credit', 's-none': 'subscription' });
  assert.deepEqual(wallets({ machine: { ...MACHINE, wallet_default: 'api' } }), { 's-api': 'credit', 's-none': 'api' });
  assert.deepEqual(wallets({ machine: { ...MACHINE, also_api: true } }), { 's-api': 'credit', 's-none': 'unknown' });
  const hours = e.build({ machine: { ...MACHINE, also_api: true } }).docs[0].doc.hours;
  assert.deepEqual(hours.map((h) => h.wallet).sort(), ['credit', 'unknown']);
});

test('prompt previews: redacted text when on, none when off, also from a cached summary', () => {
  const e = env();
  writeSession(e.root, { id: 'p1', rows: [{ t: DAY, prompt: 'use key sk-abcdefghijklmnop please' }, req(DAY + MIN)] });
  const turnsOf = (extra) => e.build(extra).docs[0].doc.sessions[0].turns;
  const on = turnsOf();
  assert.match(on[0].text, /use key \[secret\] please/);
  const off = turnsOf({ machine: { ...MACHINE, prompt_preview: false } });
  assert.ok(off.every((t) => !('text' in t)));
  const raw = JSON.stringify(e.build({ machine: { ...MACHINE, prompt_preview: false } }).docs);
  assert.ok(!raw.includes('use key'));
  // a cache written without text is parsed again when previews are switched on
  const e2 = env();
  writeSession(e2.root, { id: 'p2', rows: [{ t: DAY, prompt: 'hello there' }, req(DAY + MIN)] });
  e2.build({ machine: { ...MACHINE, prompt_preview: false } });
  const second = e2.build();
  assert.equal(second.stats.parsed, 1);
  assert.equal(second.docs[0].doc.sessions[0].turns[0].text, 'hello there');
});

test('size split: part 1 keeps hours, parts are numbered, none exceeds the ArtifactData limit', () => {
  const e = env();
  const long = 'word '.repeat(300);
  for (let i = 0; i < 40; i++) {
    const t = DAY + i * 10 * MIN;
    writeSession(e.root, { id: `big-${String(i).padStart(2, '0')}`, rows: Array.from({ length: 6 }, (_, j) => ({ t: t + j * 1000, prompt: `${j} ${long}` })).concat([req(t + 7000)]) });
  }
  const { docs } = e.build({ previewChars: 1500 });
  assert.ok(docs.length >= 2, `expected a split, got ${docs.length} documents`);
  assert.deepEqual(docs.map((d) => d.id), ['2026-03-03_pc_1'].concat(Array.from({ length: docs.length - 1 }, (_, i) => `2026-03-03_pc_1_p${i + 2}`)));
  docs.forEach((d, i) => {
    assert.equal(d.doc.part, i + 1);
    assert.equal(d.doc.parts, docs.length);
    assert.ok(size(d.doc) <= 262144 && size(d.doc) <= store.MAX_DOC_BYTES, `part ${i + 1} is ${size(d.doc)} bytes`);
    assert.deepEqual(validate(d.doc, SCHEMA), []);
    if (i > 0) assert.deepEqual([d.doc.hours, d.doc.snapshots], [[], []]);
  });
  assert.ok(docs[0].doc.hours.length > 0);
  const ids = docs.flatMap((d) => d.doc.sessions.map((s) => s.id));
  assert.equal(ids.length, 40);
  assert.equal(new Set(ids).size, 40);
  assert.deepEqual(ids, [...ids].sort());
});

test('one session too big for a document: turn texts go first, then the turns', () => {
  const e = env();
  const rows = (n) => Array.from({ length: n }, (_, j) => ({ t: DAY + j * 1000, prompt: `Prompt number ${j} with some text to preview here` })).concat([req(DAY + MIN)]);
  writeSession(e.root, { id: 'huge-text', rows: rows(2500) });
  const a = e.build().docs;
  assert.equal(a.length, 1);
  const sa = a[0].doc.sessions[0];
  assert.equal(sa.truncated, true);
  assert.ok(sa.turns.length >= 2500 && sa.turns.every((t) => !('text' in t)));
  assert.ok(size(a[0].doc) <= store.MAX_DOC_BYTES);

  const e2 = env();
  writeSession(e2.root, { id: 'huge-turns', rows: rows(5000) });
  const b = e2.build().docs;
  assert.equal(b.length, 1);
  const sb = b[0].doc.sessions[0];
  assert.equal(sb.truncated, true);
  assert.deepEqual(sb.turns, []);
  assert.ok(sb.usd > 0 && sb.participants.length === 1);
  assert.ok(size(b[0].doc) <= store.MAX_DOC_BYTES);
  assert.deepEqual(validate(b[0].doc, SCHEMA), []);
});

test('summary cache: the second build does not parse again, a changed file does', () => {
  const e = env();
  const s = buildSession(e.root);
  const first = e.build();
  assert.deepEqual(first.stats, { parsed: 1, reused: 0 });
  const cache = JSON.parse(fs.readFileSync(path.join(e.dir, 'usage-cache', `${SESSION_ID}.json`), 'utf8'));
  assert.ok(cache.mtimeMs > 0 && cache.size > 0 && cache.summary.id === SESSION_ID);
  const index = JSON.parse(fs.readFileSync(path.join(e.dir, 'usage-index.json'), 'utf8'));
  assert.deepEqual(index[SESSION_ID].days, ['2026-01-01']);
  const second = e.build();
  assert.deepEqual(second.stats, { parsed: 0, reused: 1 });
  assert.deepEqual(second.docs.map((d) => d.hash), first.docs.map((d) => d.hash));
  // an agent file counts as part of the session
  fs.appendFileSync(s.agentFiles.aaa1, '\n');
  assert.equal(e.build().stats.parsed, 1);
  appendRequest(s.main, SESSION_ID, { t: Date.UTC(2026, 0, 1, 10, 30), model: 'test-opus-1', tok: { in: 5 } });
  const third = e.build();
  assert.equal(third.stats.parsed, 1);
  assert.equal(third.docs[0].doc.hours[0].req, 10);
  // a new price table makes the cached dollars stale
  const dearer = e.build({ prices: { models: TABLE.models.map((m) => ({ ...m, output: m.output * 2 })) } });
  assert.equal(dearer.stats.parsed, 1);
});

test('rebuilding a day takes in sessions that did not change; sessions long before the day do not matter', () => {
  const e = env();
  const old = Date.UTC(2026, 2, 3, 13, 0, 0);
  writeSession(e.root, { id: 'a-old', rows: [{ t: DAY, prompt: 'a' }, req(DAY + MIN)], mtimeMs: old });
  writeSession(e.root, { id: 'b-new', rows: [{ t: DAY + 2 * MIN, prompt: 'b' }, req(DAY + 3 * MIN)] });
  writeSession(e.root, { id: 'c-ancient', rows: [{ t: Date.UTC(2020, 0, 1), prompt: 'c' }, req(Date.UTC(2020, 0, 1) + MIN)], mtimeMs: Date.UTC(2020, 0, 2) });
  const { docs, days, stats } = e.build({ sinceMs: Date.UTC(2026, 2, 10) });
  assert.deepEqual(days, ['2026-03-03']);
  assert.deepEqual(docs[0].doc.sessions.map((s) => s.id), ['a-old', 'b-new']);
  assert.equal(docs[0].doc.hours.reduce((n, h) => n + h.req, 0), 2);
  assert.equal(stats.parsed, 2);
  const none = e.build({ sinceMs: Date.now() + 86400000 });
  assert.deepEqual(none.docs, []);
});

test('keelInfo is merged into its session and remembered in keel-tasks.jsonl', () => {
  const e = env();
  writeSession(e.root, { id: 'k1', rows: [{ t: DAY, prompt: 'x' }, req(DAY + MIN)] });
  const info = { session_id: 'k1', task: 'CAN-1: thing', level: 'standard', findings: { must: 0, should: 1, nice: 2 }, gates: 'pass', lines: { add: 10, del: 2 }, files: 3, steps: [{ title: 'one', model: 'sonnet' }] };
  const doc = e.build({ keelInfo: info }).docs[0].doc;
  const { session_id, ...fields } = info;
  assert.deepEqual(doc.sessions[0].keel, fields);
  assert.deepEqual(validate(doc, SCHEMA), []);
  // a later rebuild without the info keeps it, and the same info is not appended twice
  assert.deepEqual(e.build().docs[0].doc.sessions[0].keel, fields);
  e.build({ keelInfo: info });
  assert.equal(fs.readFileSync(path.join(e.dir, 'keel-tasks.jsonl'), 'utf8').trim().split('\n').length, 1);
  // new fields are merged over the old
  assert.equal(e.build({ keelInfo: { session_id: 'k1', level: 'basic' } }).docs[0].doc.sessions[0].keel.level, 'basic');
});

test('limit snapshots of the day go into the document; cost_cc is the last cost with the session id', () => {
  const e = env();
  const s = buildSession(e.root);
  const snap = (t, extra) => JSON.stringify({ t, five_hour: 1, five_hour_resets_at: 5, seven_day: 2, seven_day_resets_at: 6, session_id: null, cost_usd: null, src: 'statusline', ...extra });
  fs.writeFileSync(path.join(e.dir, 'limits.jsonl'), [
    snap('2026-01-01T10:05:00.000Z', { session_id: s.sessionId, cost_usd: 3.5 }),
    snap('2026-01-01T10:15:00.000Z', { session_id: s.sessionId, cost_usd: 4.5 }),
    snap('2026-01-02T10:15:00.000Z', {}),
  ].join('\n') + '\n');
  const doc = e.build().docs[0].doc;
  assert.equal(doc.snapshots.length, 2);
  assert.equal(doc.sessions[0].cost_cc, 4.5);
  assert.deepEqual(validate(doc, SCHEMA), []);
});

// --- sync state ---

const fake = (key, v, extra = {}) => ({ id: key, key, hash: `h-${key}-${v}`, doc: { date: key, pc: 'p', part: 1, parts: 1, hours: [], snapshots: [], sessions: [], ...extra } });

test('stage and ack: only changed documents are written; versions go up by one and become if_version', () => {
  const state = store.readState(tempDir('keel-state-'));
  assert.equal(state.synced_until, null);
  const w1 = store.stage(state, [fake('d1', 1), fake('d2', 1)], { nowIso: '2026-03-03T10:00:00Z' });
  assert.deepEqual(w1.map((w) => [w.key, w.if_version]), [['d1', null], ['d2', null]]);
  const r1 = store.ack(state);
  assert.equal(r1.committed, 2);
  assert.equal(state.synced_until, '2026-03-03T10:00:00Z');
  assert.deepEqual(state.docs.d1, { version: 1, hash: 'h-d1-1' });
  // d1 unchanged, d2 changed
  const w2 = store.stage(state, [fake('d1', 1), fake('d2', 2)], { nowIso: '2026-03-03T11:00:00Z' });
  assert.deepEqual(w2.map((w) => [w.key, w.if_version]), [['d2', 1]]);
  store.ack(state);
  assert.deepEqual(state.docs.d2, { version: 2, hash: 'h-d2-2' });
  assert.equal(state.synced_until, '2026-03-03T11:00:00Z');
  // an explicit version (after a conflict) replaces the known one
  const w3 = store.stage(state, [fake('d2', 2)], { nowIso: '2026-03-03T12:00:00Z', versions: { d2: 7 } });
  assert.deepEqual(w3.map((w) => [w.key, w.if_version]), [['d2', 7]]);
  store.ack(state);
  assert.equal(state.docs.d2.version, 8);
});

test('ack with failed documents keeps them pending and does not move synced_until', () => {
  const state = store.readState(tempDir('keel-state-'));
  store.stage(state, [fake('d1', 1), fake('d2', 1), fake('machines/pc', 1)], { nowIso: '2026-03-03T10:00:00Z' });
  const r = store.ack(state, { failed: ['d2', 'pc', 'nope'] });
  assert.equal(r.committed, 1);
  assert.deepEqual(r.left.sort(), ['d2', 'machines/pc']);
  assert.deepEqual(r.unknown, ['nope']);
  assert.equal(state.synced_until, null);
  assert.ok(state.docs.d1 && !state.docs.d2);
  // the next stage writes the pending ones again
  const w = store.stage(state, [fake('d1', 1), fake('d2', 1), fake('machines/pc', 1)], { nowIso: '2026-03-03T11:00:00Z', versions: { d2: 4 } });
  assert.deepEqual(w.map((x) => [x.key, x.if_version]), [['d2', 4], ['machines/pc', null]]);
});

test('a day that shrinks from three parts to two gets an empty replacement for the missing part', () => {
  const state = store.readState(tempDir('keel-state-'));
  const three = [fake('2026-03-03_pc', 1), fake('2026-03-03_pc_p2', 1), fake('2026-03-03_pc_p3', 1)];
  store.stage(state, three, { nowIso: 'a' });
  store.ack(state);
  const two = [fake('2026-03-03_pc', 2), fake('2026-03-03_pc_p2', 1)];
  const w = store.stage(state, two, { nowIso: 'b', rebuiltIds: ['2026-03-03_pc'] });
  assert.deepEqual(w.map((x) => x.key), ['2026-03-03_pc', '2026-03-03_pc_p3']);
  const blank = w[1].doc;
  assert.deepEqual([blank.part, blank.parts, blank.hours, blank.sessions], [3, 2, [], []]);
  store.ack(state);
  assert.deepEqual(store.stage(state, two, { nowIso: 'c', rebuiltIds: ['2026-03-03_pc'] }), []);
});

test('unchanged documents keep their hash across builds, a new request changes only its day', () => {
  const e = env();
  writeSession(e.root, { id: 'u1', rows: [{ t: DAY, prompt: 'x' }, req(DAY + MIN)] });
  writeSession(e.root, { id: 'u2', rows: [{ t: DAY + 24 * 60 * MIN, prompt: 'y' }, req(DAY + 24 * 60 * MIN + MIN)] });
  const first = e.build();
  assert.equal(first.docs.length, 2);
  const state = store.readState(e.dir);
  store.stage(state, first.docs.map((d) => ({ ...d, collection: 'days' })), { nowIso: 'a' });
  store.ack(state);
  const again = e.build({ nowMs: Date.now() + 5000 });
  assert.deepEqual(store.stage(state, again.docs, { nowIso: 'b' }), [], 'synced_until alone does not rewrite a document');
  appendRequest(path.join(e.root, 'proj-test', 'u2.jsonl'), 'u2', { t: DAY + 24 * 60 * MIN + 2 * MIN, model: 'm1', tok: { in: 1 } });
  const changed = e.build({ sinceMs: Date.now() - 1000 });
  assert.deepEqual(store.stage(state, changed.docs, { nowIso: 'c' }).map((w) => w.key), ['2026-03-04_pc_1']);
});

test('machine document is rewritten every time', () => {
  const a = store.buildMachineDoc(MACHINE, '2026-03-03T10:00:00.000Z');
  const b = store.buildMachineDoc(MACHINE, '2026-03-03T11:00:00.000Z');
  assert.equal(a.key, 'machines/pc_1');
  assert.notEqual(a.hash, b.hash);
  assert.deepEqual(a.doc, { name: 'pc 1', user: 'u@x.y', wallet_default: 'subscription', synced_until: '2026-03-03T10:00:00.000Z', last_seen: '2026-03-03T10:00:00.000Z' });
});

test('localRequests: every priced request of the period with its wallet', () => {
  const e = env();
  writeSession(e.root, { id: 'r1', rows: [{ t: DAY, prompt: 'x' }, req(DAY + MIN), req(DAY + 2 * MIN, { out: 1 })] });
  fs.writeFileSync(path.join(e.dir, 'sessions.jsonl'), JSON.stringify({ session_id: 'r1', wallet: 'api' }) + '\n');
  const rows = store.localRequests({ projectsRoot: e.root, machine: MACHINE, usageDir: e.dir, prices: TABLE, sinceMs: DAY + 90000 });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].wallet, rows[0].model, rows[0].usd, rows[0].t], ['api', 'm1', 5, new Date(DAY + 2 * MIN).toISOString()]);
});

// --- resumed and forked sessions, deleted transcripts, privacy ---

// A transcript with chosen message ids: rows are {t, prompt} or {t, id, model, tok}; `old` sets the file times.
// keel (default true): a /keel:end-task row without a timestamp, so the usage page lists the session.
function writeIds(root, id, rows, { old, cwd = 'O:\\work\\demo', keel = true } = {}) {
  const usage = ({ in: i = 0, out = 0 }) => ({ input_tokens: i, output_tokens: out, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const lines = rows.map((r) => JSON.stringify('prompt' in r
    ? { sessionId: id, cwd, type: 'user', timestamp: new Date(r.t).toISOString(), message: { role: 'user', content: r.prompt } }
    : { sessionId: id, cwd, type: 'assistant', timestamp: new Date(r.t).toISOString(), message: { role: 'assistant', id: r.id, model: 'm1', content: [{ type: 'text', text: 'ok' }], usage: usage(r.tok || { in: 1 }) } }));
  if (keel) lines.push(JSON.stringify({ sessionId: id, cwd, type: 'user', message: { role: 'user', content: '<command-name>/keel:end-task</command-name>' } }));
  const file = path.join(root, 'proj-test', `${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  if (old) fs.utimesSync(file, new Date(old), new Date(old));
  return file;
}

// parent: two requests on DAY; child: a copy of them (same ids and times) plus one request two days later.
function resumedPair(e) {
  const T = [{ t: DAY, prompt: 'first' }, { t: DAY + MIN, id: 'msg_a' }, { t: DAY + 2 * MIN, id: 'msg_b' }];
  const later = DAY + 2 * 24 * 60 * MIN;
  writeIds(e.root, 'parent', T, { old: DAY + 3 * MIN });
  writeIds(e.root, 'child', [...T, { t: later, prompt: 'resumed' }, { t: later + MIN, id: 'msg_c' }]);
  return { later };
}

test('a resumed session copies its parent: every request is counted once, the child starts at its own first row', () => {
  const e = env();
  const { later } = resumedPair(e);
  const { docs, days } = e.build();
  assert.deepEqual(days, ['2026-03-03', '2026-03-05']);
  const d = byId(docs);
  const hoursUsd = sum(docs.flatMap((x) => x.doc.hours.map((h) => h.usd)));
  assert.equal(sum(docs.flatMap((x) => x.doc.hours.map((h) => h.req))), 3, 'three distinct messages, not five');
  near(hoursUsd, 3);
  assert.deepEqual(d['2026-03-03_pc_1'].sessions.map((s) => [s.id, s.usd]), [['parent', 2]]);
  const child = d['2026-03-05_pc_1'].sessions[0];
  assert.deepEqual([child.id, child.usd, child.start], ['child', 1, new Date(later).toISOString()]);
  assert.equal(child.participants[0].requests, 1);
  assert.deepEqual(child.turns.map((t) => t.text), ['resumed']);
  near(sum(docs.flatMap((x) => x.doc.sessions.map((s) => s.usd))), hoursUsd);
  // the copy-free version is cached: nothing is parsed again
  assert.deepEqual(e.build().stats, { parsed: 0, reused: 2 });
  // calibration sees each request once, and so does the end-of-task summary
  const reqs = store.localRequests({ projectsRoot: e.root, machine: MACHINE, usageDir: e.dir, prices: TABLE, sinceMs: 0 });
  assert.deepEqual(reqs.map((r) => r.session_id).sort(), ['child', 'parent', 'parent']);
  const ref = store.listSessions(e.root).find((r) => r.id === 'child');
  const { summary } = store.sessionSummary(ref, { projectsRoot: e.root, machine: MACHINE, usageDir: e.dir, prices: TABLE });
  assert.deepEqual([summary.usd, summary.start, summary.participants[0].requests], [1, new Date(later).toISOString(), 1]);
});

test('a resumed pair is also counted once when only the child changed', () => {
  const e = env();
  const { later } = resumedPair(e);
  e.build();
  appendRequest(path.join(e.root, 'proj-test', 'child.jsonl'), 'child', { t: later + 2 * MIN, model: 'm1', tok: { in: 1 } });
  const again = e.build({ sinceMs: Date.now() - 60000 });
  assert.deepEqual(again.days, ['2026-03-05']);
  assert.equal(sum(again.docs.flatMap((x) => x.doc.hours.map((h) => h.req))), 2);
  assert.equal(again.summaries.get('child').start, new Date(later).toISOString());
  const ref = store.listSessions(e.root).find((r) => r.id === 'parent');
  const sess = store.sessionSummary(ref, { projectsRoot: e.root, machine: MACHINE, usageDir: e.dir, prices: TABLE });
  assert.equal(sess.summary.usd, 2);
});

test('a session whose transcript Claude Code deleted keeps its history in a rebuilt day', () => {
  const e = env();
  const old = writeIds(e.root, 'gone', [{ t: DAY, prompt: 'a' }, { t: DAY + MIN, id: 'g1' }], { old: DAY + 2 * MIN });
  writeIds(e.root, 'live', [{ t: DAY + 5 * MIN, prompt: 'b' }, { t: DAY + 6 * MIN, id: 'l1' }]);
  const first = e.build();
  assert.equal(first.docs[0].doc.sessions.length, 2);
  fs.rmSync(old);
  const again = e.build({ sinceMs: Date.now() - 60000 });
  const doc = again.docs[0].doc;
  assert.deepEqual(doc.sessions.map((s) => s.id), ['gone', 'live']);
  assert.equal(sum(doc.hours.map((h) => h.req)), 2, 'the deleted session still counts in the hours');
  assert.deepEqual(again.docs.map((d) => d.hash), first.docs.map((d) => d.hash), 'nothing about the day changed');
});

test('cache pruning: a deleted session goes after 180 days unless a live session shares its day', () => {
  const e = env();
  const NOW = Date.UTC(2026, 11, 1);
  const files = {};
  for (const [id, t] of [['stale', Date.UTC(2026, 0, 1)], ['recent', Date.UTC(2026, 10, 1)], ['shared', Date.UTC(2026, 0, 5)]]) {
    files[id] = writeIds(e.root, id, [{ t, prompt: 'x' }, { t: t + MIN, id: `id_${id}` }], { old: t + 2 * MIN });
  }
  writeIds(e.root, 'live', [{ t: Date.UTC(2026, 0, 5, 1), prompt: 'y' }, { t: Date.UTC(2026, 0, 5, 1) + MIN, id: 'id_live' }], { old: NOW });
  e.build({ nowMs: NOW, sinceMs: 0 });
  const cacheOf = (id) => fs.existsSync(path.join(e.dir, 'usage-cache', `${id}.json`));
  assert.ok(['stale', 'recent', 'shared', 'live'].every(cacheOf));
  for (const id of ['stale', 'recent', 'shared']) fs.rmSync(files[id]);
  e.build({ nowMs: NOW, sinceMs: 0 });
  assert.deepEqual(['stale', 'recent', 'shared', 'live'].map(cacheOf), [false, true, true, true]);
  const index = JSON.parse(fs.readFileSync(path.join(e.dir, 'usage-index.json'), 'utf8'));
  assert.deepEqual(Object.keys(index).sort(), ['live', 'recent', 'shared']);
  // an unreadable projects folder never wipes the cache
  store.buildDays({ projectsRoot: path.join(e.root, 'missing'), machine: MACHINE, usageDir: e.dir, prices: TABLE, sinceMs: 0, nowMs: NOW + 400 * 86400000 });
  assert.ok(cacheOf('recent'));
});

test('privacy: only the folder name of the cwd goes out; with previews off no task or step titles either', () => {
  const e = env();
  writeIds(e.root, 'priv', [{ t: DAY, prompt: 'secret plan' }, { t: DAY + MIN, id: 'p1' }], { cwd: 'C:\\Users\\jane\\clients\\acme-corp\\billing' });
  const info = { session_id: 'priv', task: 'ACME-9: fire the CFO', level: 'standard', steps: [{ title: 'Delete the evidence', model: 'sonnet' }, { title: 'Second', model: null }], files: 2 };
  const on = e.build({ keelInfo: info }).docs[0].doc.sessions[0];
  assert.deepEqual([on.cwd, on.project], ['billing', 'billing']);
  assert.equal(on.keel.task, 'ACME-9: fire the CFO');
  assert.equal(on.keel.steps[0].title, 'Delete the evidence');
  const off = e.build({ keelInfo: info, machine: { ...MACHINE, prompt_preview: false } }).docs[0].doc;
  const s = off.sessions[0];
  assert.equal(s.cwd, 'billing');
  assert.deepEqual([s.keel.task, s.keel.steps], [null, [{ title: 'step 1', model: 'sonnet' }, { title: 'step 2', model: null }]]);
  assert.deepEqual([s.keel.level, s.keel.files], ['standard', 2]);
  const raw = JSON.stringify(off);
  for (const leak of ['jane', 'acme-corp', 'Users', 'fire the CFO', 'evidence', 'secret plan']) assert.ok(!raw.includes(leak), leak);
  assert.deepEqual(validate(off, SCHEMA), []);
});

test('ack of one batch records only that batch and keeps synced_until back', () => {
  const state = store.readState(tempDir('keel-state-'));
  store.stage(state, [fake('d1', 1), fake('d2', 1), fake('d3', 1)], { nowIso: '2026-03-03T10:00:00Z' });
  state.pending.d1.batch = 1; state.pending.d2.batch = 1; state.pending.d3.batch = 2;
  const r = store.ack(state, { batch: 1 });
  assert.deepEqual([r.committed, r.left], [2, ['d3']]);
  assert.equal(state.synced_until, null);
  assert.ok(state.docs.d1 && state.docs.d2 && !state.docs.d3);
  assert.equal(store.ack(state, { batch: 2, failed: ['d3'] }).committed, 0);
  store.stage(state, [fake('d1', 1), fake('d2', 1), fake('d3', 1)], { nowIso: '2026-03-03T11:00:00Z' });
  state.pending.d3.batch = 1;
  store.ack(state, { batch: 1 });
  assert.equal(state.synced_until, '2026-03-03T11:00:00Z');
});

test('a project can turn prompt previews off for itself while the machine sends them', () => {
  const e = env();
  const quiet = tempDir('keel-quiet-');
  fs.mkdirSync(path.join(quiet, '.keel', 'local'), { recursive: true });
  fs.writeFileSync(path.join(quiet, '.keel', 'local', 'options.json'), JSON.stringify({ prompt_preview: false }));
  writeIds(e.root, 'loud', [{ t: DAY, prompt: 'loud words' }, { t: DAY + MIN, id: 'l1' }], { cwd: path.join(os.tmpdir(), 'loud-project') });
  writeIds(e.root, 'hush', [{ t: DAY + 2 * MIN, prompt: 'hushed words' }, { t: DAY + 3 * MIN, id: 'h1' }], { cwd: quiet });
  const raw = JSON.stringify(e.build().docs);
  assert.ok(raw.includes('loud words'), 'the machine setting still sends other projects');
  assert.ok(!raw.includes('hushed words'), 'the project setting wins');
});

test('only keel sessions are listed: a workflow command or an end-step record; every session still counts in the hours', () => {
  const e = env();
  const cmd = (name, args = '') => `<command-message>keel:${name}</command-message>\n<command-name>/keel:${name}</command-name>\n<command-args>${args}</command-args>`;
  writeIds(e.root, 'plain', [{ t: DAY, prompt: 'just chatting' }, { t: DAY + MIN, id: 'p1' }], { keel: false });
  writeIds(e.root, 'setup', [{ t: DAY + 2 * MIN, prompt: cmd('configure') }, { t: DAY + 3 * MIN, id: 's1' }], { keel: false });
  writeIds(e.root, 'task', [{ t: DAY + 4 * MIN, prompt: cmd('start-task', 'SHOP-1') }, { t: DAY + 5 * MIN, id: 't1' }], { keel: false });
  writeIds(e.root, 'ended', [{ t: DAY + 6 * MIN, prompt: 'go on' }, { t: DAY + 7 * MIN, id: 'e1' }], { keel: false });
  const doc = e.build({ keelInfo: { session_id: 'ended', level: 'basic' } }).docs[0].doc;
  assert.deepEqual(doc.sessions.map((s) => s.id), ['task', 'ended'], '/keel:configure alone does not make a keel session');
  assert.equal(sum(doc.hours.map((h) => h.req)), 4, 'the calibration hours count every session');
  assert.deepEqual(e.build().summaries.get('task').keel_commands, ['start-task']);
});

test('a planning chat is listed: /keel:start-planning alone makes a keel session', () => {
  const e = env();
  const cmd = (name, args = '') => `<command-message>keel:${name}</command-message>\n<command-name>/keel:${name}</command-name>\n<command-args>${args}</command-args>`;
  writeIds(e.root, 'plain', [{ t: DAY, prompt: 'just chatting' }, { t: DAY + MIN, id: 'p1' }], { keel: false });
  writeIds(e.root, 'plan', [{ t: DAY + 2 * MIN, prompt: cmd('start-planning', 'an idea') }, { t: DAY + 3 * MIN, id: 'q1' }], { keel: false });
  const doc = e.build().docs[0].doc;
  assert.deepEqual(doc.sessions.map((s) => s.id), ['plan']);
  assert.equal(doc.sessions[0].keel, null, 'no end step recorded it, so it has no task fields');
});
