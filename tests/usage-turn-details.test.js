'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');
const { usageOf, writeSession } = require('./fixtures/usage.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const store = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-store.js'));
const { summarizeSession } = require(path.join(PLUGIN, 'scripts', 'lib', 'transcripts.js'));
const { audit } = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-audit.js'));
const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'), 'utf8'));

const SID = 'sess-detail';
const T0 = Date.UTC(2026, 2, 3, 12, 0, 0);
const SEC = 1000;
const DETAIL = ['tools', 'agent_types', 'usd_agents', 'tok', 'ctx_max'];
const OPUS = 'claude-opus-4-test';
const MACHINE = { pc: 'pc 1', user: 'u@x.y', wallet_default: 'subscription', cloud_wallet: 'credit', also_api: false, prompt_preview: true };
const cost = (model, tok) => (tok.in + tok.out) / 1000;
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));

const base = { sessionId: SID, cwd: 'O:\\work\\demo', gitBranch: 'main', entrypoint: 'cli' };
const row = (t, side, type, message) => ({ ...base, isSidechain: side, type, timestamp: new Date(t).toISOString(), message });
const user = (t, text, side = false) => row(t, side, 'user', { role: 'user', content: text });
const reply = (t, id, uses, tok, side = false) => row(t, side, 'assistant', {
  role: 'assistant', id, model: OPUS, usage: usageOf(tok),
  content: uses.map((name, i) => ({ type: 'tool_use', id: `${id}_${i}`, name, input: {} })).concat([{ type: 'text', text: 'ok' }]),
});

// main: rows of the main transcript; agents: [{ id, type, rows }]. The end-task command makes it a keel session.
function put(root, main, agents = []) {
  const keel = { ...base, isSidechain: false, type: 'user', message: { role: 'user', content: '<command-message>keel:end-task</command-message>\n<command-name>/keel:end-task</command-name>' } };
  const file = path.join(root, 'proj-test', `${SID}.jsonl`);
  const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines(main.concat([keel])));
  for (const a of agents) {
    const dir = path.join(root, 'proj-test', SID, 'subagents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `agent-${a.id}.jsonl`), lines(a.rows));
    fs.writeFileSync(path.join(dir, `agent-${a.id}.meta.json`), JSON.stringify({ agentType: a.type }));
  }
  return file;
}

// Turn one: Read x3 and Edit x1, then an agent that runs Bash x2. Turn two: an answer only.
function twoTurns(root) {
  return put(root, [
    user(T0, 'first'),
    reply(T0 + SEC, 'm1', ['Read', 'Read', 'Read', 'Edit'], { in: 100, cr: 1000, out: 5 }),
    reply(T0 + 2 * SEC, 'm2', ['Agent'], { in: 200, cw5: 300, cr: 2000, out: 10 }),
    user(T0 + 60 * SEC, 'second'),
    reply(T0 + 61 * SEC, 'm3', [], { in: 10, cr: 4000, out: 20 }),
  ], [{
    id: 'a1', type: 'implementer',
    rows: [user(T0 + 3 * SEC, 'go', true), reply(T0 + 4 * SEC, 'x1', ['Bash', 'Bash'], { in: 50, out: 10 }, true)],
  }]);
}

test('turn details: tools, agent types, agent dollars, tokens and the largest context after each message', () => {
  const root = tempDir('keel-td-proj-');
  const s = summarizeSession(twoTurns(root), { cost });
  assert.equal(s.turns.length, 2);
  const [one, two] = s.turns;
  assert.deepEqual(one.tools, { Read: 3, Bash: 2, Agent: 1, Edit: 1 });
  assert.deepEqual(Object.keys(one.tools), ['Read', 'Bash', 'Agent', 'Edit'], 'most used first');
  assert.deepEqual(one.agent_types, { implementer: 1 });
  assert.ok(Math.abs(one.usd_agents - 0.06) < 1e-9);
  assert.ok(Math.abs(one.usd - 0.375) < 1e-9, 'the agent request is part of the turn dollars');
  assert.deepEqual(one.tok, { in: 350, cw5: 300, cw1h: 0, cr: 3000, out: 25 });
  assert.equal(one.ctx_max, 2500, 'the largest main request: 200 + 300 + 0 + 2000, agents not counted');
  assert.equal(one.requests, 3);
  assert.deepEqual(two.tok, { in: 10, cw5: 0, cw1h: 0, cr: 4000, out: 20 });
  assert.equal(two.ctx_max, 4010);
  for (const k of ['tools', 'agent_types', 'usd_agents']) assert.ok(!(k in two), `${k} is left out when nothing was done`);
});

test('turn details: at most 6 tools and 4 agent types by count, the rest summed as other', () => {
  const root = tempDir('keel-td-proj-');
  const names = ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'WebFetch', 'Skill'];
  const uses = names.flatMap((n, i) => Array(names.length - i).fill(n));
  const types = ['a', 'a', 'b', 'c', 'd', 'e'];
  const file = put(root, [
    user(T0, 'big'),
    reply(T0 + SEC, 'm1', uses, { in: 1 }),
  ], types.map((type, i) => ({
    id: `g${i}`, type,
    rows: [user(T0 + (2 + i) * SEC, 'go', true), reply(T0 + (2 + i) * SEC + 500, `y${i}`, [], { in: 1 }, true)],
  })));
  const [turn] = summarizeSession(file, { cost }).turns;
  assert.deepEqual(turn.tools, { Read: 8, Edit: 7, Bash: 6, Grep: 5, Glob: 4, Write: 3, other: 3 });
  assert.deepEqual(Object.keys(turn.tools), ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'other']);
  assert.deepEqual(turn.agent_types, { a: 2, b: 1, c: 1, d: 1, other: 1 });
  assert.deepEqual(Object.keys(turn.agent_types), ['a', 'b', 'c', 'd', 'other']);
});

test('names such as constructor, toString and __proto__ are counted like any other name', () => {
  const root = tempDir('keel-td-proj-');
  const odd = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];
  const file = put(root, [
    user(T0, 'odd'),
    reply(T0 + SEC, 'm1', odd.concat(['constructor', 'Read']), { in: 1 }),
  ], odd.map((type, i) => ({
    id: `o${i}`, type,
    rows: [user(T0 + (2 + i) * SEC, 'go', true), reply(T0 + (2 + i) * SEC + 500, `z${i}`, [], { in: 1 }, true)],
  })));
  const s = summarizeSession(file, { cost });
  const [turn] = s.turns;
  const entries = (o) => Object.entries(JSON.parse(JSON.stringify(o)));
  assert.deepEqual(entries(turn.tools), [['constructor', 2], ['Read', 1], ['__proto__', 1], ['hasOwnProperty', 1], ['toString', 1]]);
  assert.deepEqual(entries(turn.agent_types), [['__proto__', 1], ['constructor', 1], ['hasOwnProperty', 1], ['toString', 1]]);
  assert.equal(Object.getPrototypeOf(turn.tools), Object.prototype, 'a plain object');
  assert.equal(Object.getPrototypeOf(turn.agent_types), Object.prototype, 'a plain object');
  const main = s.participants[0];
  assert.deepEqual(Object.getOwnPropertyNames(main.tools).sort(), ['Read', '__proto__', 'constructor', 'hasOwnProperty', 'toString']);
  assert.equal(main.tools.constructor, 2);
  assert.equal(Object.getPrototypeOf(main.tools), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(s)).turns[0].tools.constructor, 2);
});

test('turn details reach the day document and fit its schema', () => {
  const root = tempDir('keel-td-proj-');
  twoTurns(root);
  const { docs } = store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: tempDir('keel-td-usage-'), sinceMs: 0 });
  assert.deepEqual(validate(docs[0].doc, SCHEMA), []);
  const [one, two] = docs[0].doc.sessions[0].turns;
  assert.deepEqual(one.tools, { Read: 3, Bash: 2, Agent: 1, Edit: 1 });
  assert.deepEqual(one.agent_types, { implementer: 1 });
  assert.deepEqual([one.tok, one.ctx_max, one.text], [{ in: 350, cw5: 300, cw1h: 0, cr: 3000, out: 25 }, 2500, 'first']);
  assert.equal(typeof one.usd_agents, 'number');
  assert.deepEqual(two.tok, { in: 10, cw5: 0, cw1h: 0, cr: 4000, out: 20 });
});

test('the schema rejects a turn whose counts are not whole numbers of 1 or more or whose tokens are not an object', () => {
  const root = tempDir('keel-td-proj-');
  twoTurns(root);
  const built = store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: tempDir('keel-td-usage-'), sinceMs: 0 }).docs[0].doc;
  const turn = (extra) => ({ t: null, usd: 0, requests: 0, agents: 0, ...extra });
  const doc = (t) => ({ ...built, sessions: [{ ...built.sessions[0], turns: [t] }] });
  assert.deepEqual(validate(doc(turn({ tools: { Read: 2 }, agent_types: { a: 1 }, tok: { in: 1, cw5: 0, cw1h: 0, cr: 0, out: 1 } })), SCHEMA), []);
  assert.notDeepEqual(validate(doc(turn({ tools: [['Read', 2]] })), SCHEMA), []);
  assert.notDeepEqual(validate(doc(turn({ tools: { Read: 'many' } })), SCHEMA), []);
  assert.notDeepEqual(validate(doc(turn({ tools: { Read: 0 } })), SCHEMA), []);
  assert.notDeepEqual(validate(doc(turn({ agent_types: { a: 1.5 } })), SCHEMA), []);
  assert.notDeepEqual(validate(doc(turn({ tok: [1, 0, 0, 0, 1] })), SCHEMA), []);
});

test('turn details are sent with previews off, and carry no message text', () => {
  const root = tempDir('keel-td-proj-');
  twoTurns(root);
  const { docs } = store.buildDays({ projectsRoot: root, machine: { ...MACHINE, prompt_preview: false }, usageDir: tempDir('keel-td-usage-'), sinceMs: 0 });
  const turns = docs[0].doc.sessions[0].turns;
  assert.ok(turns.every((t) => !('text' in t) && typeof t.tok.cr === 'number'));
});

test('a cache written before the turn details is parsed again, one without a transcript is kept as it is', () => {
  const root = tempDir('keel-td-proj-');
  const dir = tempDir('keel-td-usage-');
  twoTurns(root);
  const build = () => store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: dir, sinceMs: 0 });
  build();
  const cacheFile = path.join(dir, 'usage-cache', `${SID}.json`);
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  cache.v = 2;
  for (const t of cache.summary.turns) for (const k of DETAIL) delete t[k];
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const again = build();
  assert.equal(again.stats.parsed, 1, 'the old cache is not reused');
  assert.ok(again.docs[0].doc.sessions[0].turns.every((t) => typeof t.tok.cr === 'number'));

  // The transcript is gone: its cached summary still goes into the rebuilt day, as the cache has it.
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  fs.rmSync(path.join(root, 'proj-test', `${SID}.jsonl`));
  fs.rmSync(path.join(root, 'proj-test', SID), { recursive: true });
  writeSession(root, { id: 'live', rows: [{ t: T0 + 120 * SEC, prompt: 'x' }, { t: T0 + 121 * SEC, model: OPUS, tok: { in: 1 } }] });
  const kept = build();
  assert.equal(kept.stats.parsed, 1, 'only the live session is parsed');
  const ghost = kept.docs[0].doc.sessions.find((s) => s.id === SID);
  assert.ok(ghost && ghost.turns.length === 2 && ghost.turns.every((t) => !('tok' in t)));
});

function bigDay(root) {
  const main = [];
  const agents = [];
  for (let i = 0; i < 300; i++) {
    const t = T0 + i * 10 * SEC;
    main.push(user(t, `request number ${i} with some words`));
    main.push(reply(t + SEC, `m${i}`, ['Read', 'Read', 'Edit', 'Bash', 'Agent'], { in: 100, cr: 5000, out: 20 }));
    if (i % 15 === 0) agents.push({ id: `b${i}`, type: 'implementer', rows: [user(t + 2 * SEC, 'go', true), reply(t + 3 * SEC, `y${i}`, ['Bash'], { in: 50, out: 5 }, true)] });
  }
  put(root, main, agents);
}

const sessionOf = (doc) => doc.sessions[0];
const without = (t) => Object.fromEntries(Object.entries(t).filter(([k]) => !DETAIL.includes(k)));

test('a day over the size limit loses the turn details before any text, turn or agent', () => {
  const root = tempDir('keel-td-proj-');
  bigDay(root);
  const build = (maxDocBytes) => store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: tempDir('keel-td-usage-'), sinceMs: 0, maxDocBytes });
  const full = build(Infinity).docs[0].doc;
  const fullSession = sessionOf(full);
  assert.ok(fullSession.turns.every((x) => typeof x.tok.cr === 'number'));
  assert.equal(fullSession.participants.length, 21);
  const stripped = { ...full, sessions: [{ ...fullSession, turns: fullSession.turns.map(without) }] };

  const limited = build(bytes(stripped) + 100).docs;
  assert.equal(limited.length, 1);
  const s = sessionOf(limited[0].doc);
  assert.equal(s.truncated, true);
  assert.ok(s.turns.every((x) => DETAIL.every((k) => !(k in x))), 'no turn keeps a detail');
  assert.equal(s.turns.length, 300);
  assert.ok(s.turns.every((x) => typeof x.text === 'string'), 'the texts are kept');
  assert.equal(s.participants.length, 21, 'no agent is dropped');
  assert.ok(Object.keys(s.participants[0].tools).length > 0, 'the tool counts are kept');
  assert.ok(bytes(limited[0].doc) <= bytes(stripped) + 100);
});

test('audit: neither a page copy without the turn details nor one with other turn details differs from the local transcripts', () => {
  const root = tempDir('keel-td-proj-');
  const dir = tempDir('keel-td-usage-');
  const pageDir = tempDir('keel-td-page-');
  twoTurns(root);
  const nowMs = T0 + 3600 * SEC;
  const { docs } = store.buildDays({ projectsRoot: root, machine: MACHINE, usageDir: dir, sinceMs: 0, nowMs });
  const withTurns = (change) => docs.map((d) => ({ ...d.doc, sessions: d.doc.sessions.map((s) => ({ ...s, turns: s.turns.map(change) })) }));
  const changed = (t) => ('tok' in t ? { ...t, tok: { in: 1, cw5: 2, cw1h: 3, cr: 4, out: 5 }, tools: { Read: 99 }, usd_agents: 42, ctx_max: 7 } : t);
  assert.ok(withTurns(changed).some((d) => d.sessions[0].turns.some((t) => t.tok.cr === 4)), 'the copy really has other details');
  for (const [name, copy] of [['without', withTurns(without)], ['changed', withTurns(changed)]]) {
    const files = copy.map((d, i) => { const f = path.join(pageDir, `${name}${i}.json`); fs.writeFileSync(f, JSON.stringify(d)); return f; });
    const r = audit({ pageFiles: files, machine: MACHINE, usageDir: dir, projectsRoot: root, unwrap: (v) => [v], nowMs });
    assert.deepEqual([name, r.compared, r.diffs], [name, 1, []]);
  }
});
