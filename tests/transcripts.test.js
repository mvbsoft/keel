'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');

const T = require('../plugins/keel/scripts/lib/transcripts.js');
const { summarize } = require('../plugins/keel/hooks/ledger.js');
const { buildSession, price, REQ, T0, at, SESSION_ID, writeJsonl, user, asst } = require('./fixtures/transcripts.js');

function tempRoot() {
  return tempDir('keel-transcripts-');
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const expectedUsd = (pred) => sum(Object.values(REQ).filter(pred).map((r) => price(r.model, r.tok) || 0));

function session(opts) {
  const root = tempRoot();
  const s = buildSession(root, opts);
  return { root, ...s, out: T.summarizeSession(s.main, { cost: price }) };
}

test('participants: main plus two agents with types from the meta files', () => {
  const { out } = session();
  assert.equal(out.id, SESSION_ID);
  assert.equal(out.cwd, 'O:\\work\\demo');
  assert.equal(out.project, 'demo');
  assert.equal(out.gitBranch, 'feature-x');
  assert.equal(out.entrypoint, 'cli');
  assert.deepEqual(out.participants.map((p) => [p.kind, p.type, p.agent_id]),
    [['main', 'main', undefined], ['agent', 'keel:implementer', 'aaa1'], ['agent', 'general-purpose', 'bbb2']]);
  assert.deepEqual(out.participants.map((p) => p.model), ['test-opus-1', 'test-haiku-1', 'test-mystery-1']);
});

test('participant tokens equal ledger.js summarize() on the same file', () => {
  const s = session();
  const files = [s.main, s.agentFiles.aaa1, s.agentFiles.bbb2];
  s.out.participants.forEach((p, i) => {
    const led = summarize(files[i]);
    assert.equal(p.tok.in, led.usage.input_tokens);
    assert.equal(p.tok.cr, led.usage.cache_read_input_tokens);
    assert.equal(p.tok.out, led.usage.output_tokens);
    assert.equal(p.tok.cw1h, led.usage.cache_creation_1h_input_tokens);
    assert.equal(p.tok.cw5, led.usage.cache_creation_input_tokens - led.usage.cache_creation_1h_input_tokens);
    assert.equal(p.requests, led.requests);
    assert.equal(p.output_estimated, led.estimated);
  });
});

test('requests: one per distinct message id, streamed parts merged, per-request tokens', () => {
  const { out } = session();
  assert.deepEqual(out.participants.map((p) => p.requests), [4, 3, 2]);
  assert.equal(out.requests.length, 9);
  assert.deepEqual(out.requests.map((r) => r.t), [...out.requests.map((r) => r.t)].sort((a, b) => a - b));
  const byTime = new Map(out.requests.map((r) => [r.t, r]));
  for (const r of Object.values(REQ)) {
    const row = byTime.get(T0 + Math.round(r.min * 60000));
    assert.ok(row, `request at minute ${r.min}`);
    assert.equal(row.model, r.model);
    assert.deepEqual(row.tok, r.tok);
    assert.equal(row.usd, price(r.model, r.tok));
  }
  // The streamed message keeps the time of its first row (minute 1), not the second (1.1).
  assert.ok(byTime.has(T0 + 60000));
  assert.ok(!byTime.has(T0 + 66000));
});

test('output estimate: a recorded output far below the visible text is replaced and flagged', () => {
  const { out } = session();
  const [main, a, b] = out.participants;
  assert.equal(main.output_estimated, true);
  assert.equal(a.output_estimated, false);
  assert.equal(b.output_estimated, false);
  assert.equal(out.requests.find((r) => r.t === T0 + 4 * 60000).tok.out, 501);
});

test('cache creation without a TTL split counts as 5 minute; split values are kept', () => {
  const { out } = session();
  assert.deepEqual(out.participants[0].tok.cw1h, 350);
  const a2 = out.requests.find((r) => r.t === T0 + Math.round(3.5 * 60000));
  assert.equal(a2.tok.cw5, 500);
  assert.equal(a2.tok.cw1h, 0);
});

test('usd, unpriced models and by_model', () => {
  const { out } = session();
  near(out.usd, expectedUsd(() => true));
  assert.deepEqual(out.unpriced, ['test-mystery-1']);
  const [main, a, b] = out.participants;
  near(main.usd, expectedUsd((r) => r.who === 'main'));
  near(a.usd, expectedUsd((r) => r.who === 'aaa1'));
  assert.equal(b.usd, 0);
  assert.deepEqual(Object.keys(b.by_model), ['test-mystery-1']);
  assert.equal(b.by_model['test-mystery-1'].requests, 2);
  assert.equal(b.by_model['test-mystery-1'].tok.in, 105);
  assert.equal(out.requests.filter((r) => r.usd === null).length, 2);
});

test('default cost function prices nothing: usd 0 and every model unpriced', () => {
  const s = session();
  const out = T.summarizeSession(s.main);
  assert.equal(out.usd, 0);
  assert.deepEqual(out.unpriced.sort(), ['test-haiku-1', 'test-mystery-1', 'test-opus-1']);
});

test('turns: only real prompts; tool results, meta rows and an unanswered command are not turns', () => {
  const { out } = session();
  assert.deepEqual(out.turns.map((t) => t.text), ['Build the thing. Key [secret] is private', 'Second prompt', 'Third prompt']);
  assert.deepEqual(out.turns.map((t) => t.t), [0, 12, 18].map((m) => T0 + m * 60000));
});

test('turn cost and agents: background agent requests after the next turn stay with the launching turn', () => {
  const { out } = session();
  assert.deepEqual(out.turns.map((t) => t.requests), [2 + 3, 1 + 2, 1]);
  assert.deepEqual(out.turns.map((t) => t.agents), [1, 1, 0]);
  [1, 2, 3].forEach((n, i) => near(out.turns[i].usd, expectedUsd((r) => r.turn === n)));
  near(sum(out.turns.map((t) => t.usd)), out.usd);
});

test('a slash command the model answers is a turn, read as typed; one it never answers is not', () => {
  const root = tempRoot();
  const main = path.join(root, 'p', 's1.jsonl');
  const row = (r) => ({ sessionId: 's1', cwd: 'C:\\x\\proj', isSidechain: false, ...r });
  const reply = asst('m2', [{ type: 'text', text: 'Which level?' }]);
  reply.timestamp = at(11);
  writeJsonl(main, [
    row(user(1, 'first prompt')),
    row(asst('m1', [{ type: 'text', text: 'ok' }])),
    row(user(5, '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>')),
    row(user(10, '<command-message>keel:end-task</command-message>\n<command-name>/keel:end-task</command-name>\n<command-args>finish, quick</command-args>')),
    row(reply),
  ]);
  const out = T.summarizeSession(main, { cost: price });
  assert.deepEqual(out.turns.map((t) => t.text), ['first prompt', '/keel:end-task finish, quick']);
  assert.equal(out.turns[1].requests, 1);
  assert.ok(!('command' in out.turns[1]));
});

test('keel_commands: the planning commands count, a longer name does not', () => {
  const root = tempRoot();
  const main = path.join(root, 'p', 's1.jsonl');
  const row = (r) => ({ sessionId: 's1', cwd: 'C:\\x\\proj', isSidechain: false, ...r });
  const cmd = (t, name, args = '') => row(user(t, `<command-message>keel:${name}</command-message>\n<command-name>/keel:${name}</command-name>\n<command-args>${args}</command-args>`));
  writeJsonl(main, [
    cmd(1, 'start-planning', 'some idea'),
    row(asst('m1', [{ type: 'text', text: 'ok' }])),
    cmd(10, 'end-planning'),
  ]);
  assert.deepEqual(T.summarizeSession(main, { cost: price }).keel_commands, ['start-planning', 'end-planning']);
  const other = path.join(root, 'p', 's2.jsonl');
  writeJsonl(other, [cmd(1, 'start-planningx'), row(asst('m1', [{ type: 'text', text: 'ok' }]))]);
  assert.deepEqual(T.summarizeSession(other, { cost: price }).keel_commands, []);
});

test('requests before the first prompt go to a turn with null text', () => {
  const root = tempRoot();
  const main = path.join(root, 'p', 's1.jsonl');
  const row = (r) => ({ sessionId: 's1', cwd: 'C:\\x\\proj', isSidechain: false, ...r });
  const late = asst('m2', [{ type: 'text', text: 'reply' }]);
  late.timestamp = at(31);
  late.message.id = 'late';
  writeJsonl(main, [
    row(asst('m1', [{ type: 'text', text: 'resumed work' }])),
    row(user(30, 'late prompt')),
    row(late),
  ]);
  const out = T.summarizeSession(main, { cost: price });
  assert.equal(out.turns.length, 2);
  assert.equal(out.turns[0].text, null);
  assert.equal(out.turns[0].requests, 1);
  assert.equal(out.turns[1].text, 'late prompt');
  assert.equal(out.turns[1].requests, 1);
});

test('time: start, end, duration, and active time excluding the long pause', () => {
  const { out } = session();
  assert.equal(out.start, at(0));
  assert.equal(out.end, at(20));
  assert.equal(out.duration_min, 20);
  assert.equal(out.active_min, 13.5);
  const [main, a, b] = out.participants;
  assert.equal(main.active_min, 12.5);
  assert.equal(main.start, at(0));
  assert.equal(main.end, at(19));
  assert.equal(a.start, at(2));
  assert.equal(a.end, at(20));
  assert.equal(b.start, at(13.5));
  assert.equal(b.active_min, 2.5);
});

test('tools and agents_launched count tool_use blocks', () => {
  const { out } = session();
  const [main, a, b] = out.participants;
  assert.deepEqual(main.tools, { Agent: 2, Read: 1, Task: 1 });
  assert.equal(main.agents_launched, 3);
  assert.deepEqual(a.tools, { Read: 1 });
  assert.equal(a.agents_launched, 0);
  assert.deepEqual(b.tools, {});
});

test('resumed: prompts an agent received after its first reply', () => {
  const { out } = session();
  assert.deepEqual(out.participants.map((p) => p.resumed), [0, 0, 1]);
});

test('prompts:false omits turn text; previewChars cuts and marks it', () => {
  const s = session();
  const off = T.summarizeSession(s.main, { cost: price, prompts: false });
  assert.ok(off.turns.every((t) => !('text' in t)));
  assert.equal(off.turns.length, 3);
  assert.doesNotMatch(JSON.stringify(off), /Second prompt/);
  const short = T.summarizeSession(s.main, { cost: price, previewChars: 6 });
  assert.equal(short.turns[1].text, 'Second…');
});

test('malformed lines and a missing subagents dir do not throw', () => {
  const s = session({ malformed: true });
  assert.equal(s.out.requests.length, 9);
  fs.rmSync(path.join(s.dir, SESSION_ID), { recursive: true });
  const out = T.summarizeSession(s.main, { cost: price });
  assert.equal(out.participants.length, 1);
  assert.equal(out.turns.length, 3);
  const empty = path.join(s.dir, 'empty.jsonl');
  fs.writeFileSync(empty, '\n{bad\n');
  const e = T.summarizeSession(empty);
  assert.equal(e.participants[0].requests, 0);
  assert.equal(e.start, null);
  assert.deepEqual(T.summarizeSession(path.join(s.dir, 'missing.jsonl')).turns, []);
});

test('synthetic-model rows are not requests', () => {
  const root = tempRoot();
  const main = path.join(root, 'p', 's2.jsonl');
  const synth = { ...asst('m1', [{ type: 'text', text: 'API error' }]) };
  synth.message = { ...synth.message, id: 'msg_syn', model: '<synthetic>' };
  writeJsonl(main, [synth]);
  assert.equal(T.summarizeSession(main).participants[0].requests, 0);
});

test('redact: each secret pattern, and normal text is left alone', () => {
  const secrets = [
    'sk-ant-api03-abcdefghijklmnop',
    'ghp_abcdefghijklmnopqrstuvwx',
    'gho_abcdefghijklmnopqrstuvwx',
    'github_pat_11ABCDEFG0abcdefghijkl_mnop',
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    'xoxp-1234567890-abcdefghij',
    'eyJhbGciOiJIUzI1NiJ9' + '.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r',
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'aGVsbG8gd29ybGQhIFRoaXMgaXMgYSB0ZXN0IFNlY3JldDEyMw==',
  ];
  for (const s of secrets) assert.equal(T.redact(`before ${s} after`), 'before [secret] after', s);
  const normal = 'Please fix src/lib/parser.js and run npm test; version 1.2.3, sk-learn is fine, a-very-long-kebab-case-word-without-digits-at-all.';
  assert.equal(T.redact(normal), normal);
  assert.equal(T.redact(null), '');
});

test('preview: redacts, collapses whitespace, cuts with an ellipsis', () => {
  assert.equal(T.preview('  hello\n\n  world\t!  '), 'hello world !');
  assert.equal(T.preview('abcdefghij', 5), 'abcde…');
  assert.equal(T.preview('abcde', 5), 'abcde');
  assert.equal(T.preview('key ghp_abcdefghijklmnopqrstuvwx'), 'key [secret]');
  assert.equal(T.preview('x'.repeat(120)).length, 101);
  assert.equal(T.preview('red \u001b[31mtext\u0007 end'), 'red [31mtext end', 'control characters never reach the terminal');
});

test('activeMinutes: gaps up to the limit count, longer ones do not; order does not matter', () => {
  const m = (x) => T0 + x * 60000;
  assert.equal(T.activeMinutes([]), 0);
  assert.equal(T.activeMinutes([m(0)]), 0);
  assert.equal(T.activeMinutes([m(10), m(0), m(2), m(7), m(20)]), 10);
  assert.equal(T.activeMinutes([m(0), m(5.01)]), 0);
  assert.equal(T.activeMinutes([m(0), m(8)], 10), 8);
  assert.equal(T.activeMinutes([m(0), m(0.04), m(0.08)]), 0.1);
});

test('redact: URL credentials, bearer tokens, labelled secrets and more token prefixes', () => {
  const cases = [
    ['clone https://bob:hunter2@git.example.com/x.git now', 'clone https://[secret]@git.example.com/x.git now'],
    ['postgres://admin:s3cr3t@db:5432/app', 'postgres://[secret]@db:5432/app'],
    [`curl -H "Authorization: ${'Bear' + 'er'} abc123def456ghi789"`, 'curl -H "Authorization: Bearer [secret]"'],
    ['the password is hunter2 ok', 'the password is [secret] ok'],
    ['API_KEY=abc123 and token: xyz789', 'API_KEY=[secret] and token: [secret]'],
    ['pwd = foo and secret:bar and passwd is baz', 'pwd = [secret] and secret:[secret] and passwd is [secret]'],
    [`${'glp' + 'at-'}abcdefghij0123456789`, '[secret]'],
    ['ghs_abcdefghijklmnopqrstuvwx', '[secret]'],
    ['ghu_abcdefghijklmnopqrstuvwx', '[secret]'],
    [`npm_${'a1B2'.repeat(9)}`, '[secret]'],
    [`${'sk_' + 'live_'}abcdefghijklmnop`, '[secret]'],
    [`${'rk_' + 'live_'}abcdefghijklmnop`, '[secret]'],
    ['xoxb-1234567890-abcdefghij xoxp-1234567890-abcdefghij', '[secret] [secret]'],
    ['ya29.a0AfH6SMBabcdefghij', '[secret]'],
  ];
  for (const [input, want] of cases) assert.equal(T.redact(input), want, input);
  // plain words and URLs without credentials stay
  const normal = 'see https://example.com/a:b/c, the token issue is open, tokenization is fine, secrets in docs';
  assert.equal(T.redact(normal), normal);
});

test('skip: messages another session owns and the copied prefix before them are left out', () => {
  const dir = tempRoot();
  const DAY = 86400000;
  const row = (type, t, extra) => JSON.stringify({ type, timestamp: new Date(T0 + t).toISOString(), cwd: 'O:\work\demo', ...extra });
  const prompt = (t, text) => row('user', t, { message: { role: 'user', content: text } });
  const reply = (t, id) => row('assistant', t, { message: { role: 'assistant', id, model: 'test-opus-1', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } } });
  const file = path.join(dir, 'child.jsonl');
  fs.writeFileSync(file, [
    prompt(0, 'old prompt'), reply(60000, 'm1'), prompt(120000, 'old two'), reply(180000, 'm2'),
    prompt(DAY, 'new prompt'), reply(DAY + 60000, 'm3'),
  ].join('\n') + '\n');
  const cost = () => 1;
  const all = T.summarizeSession(file, { cost });
  assert.deepEqual([all.requests.length, all.usd, all.start, all.first], [3, 3, new Date(T0).toISOString(), 'm1']);
  const own = T.summarizeSession(file, { cost, skip: new Set(['m1', 'm2']) });
  assert.deepEqual(own.requests.map((r) => r.id), ['m3']);
  assert.equal(own.usd, 1);
  assert.equal(own.start, new Date(T0 + DAY).toISOString());
  assert.equal(own.participants[0].requests, 1);
  assert.deepEqual(own.turns.map((t) => t.text), ['new prompt']);
  assert.equal(own.first, 'm1', 'the family marker is kept');
  // a message nobody else owns inside the copied prefix still counts
  const part = T.summarizeSession(file, { cost, skip: new Set(['m2']) });
  assert.deepEqual(part.requests.map((r) => r.id), ['m1', 'm3']);
  assert.deepEqual(part.turns.map((t) => t.text), [null, 'new prompt'], 'the kept message sits in a text-less leading turn');
});
