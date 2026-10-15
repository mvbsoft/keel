'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-ledger-prices-'));
process.env.KEEL_USAGE_DIR = dir;
const { cost, report, priceFor } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'ledger-report.js'));

const entry = (model, extra = {}) => ({ agent_type: 'keel:qa', model, requests: 1, usage: { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...extra } });

test('ledger report prices through lib/prices.js: the machine override in ~/.claude/keel/prices.json applies', () => {
  const e = entry('claude-sonnet-5-5');
  assert.equal(cost(e), 2 + 10, 'bundled table without an override');
  fs.writeFileSync(path.join(dir, 'prices.json'), JSON.stringify({ models: [{ match: 'claude-sonnet-5-5', input: 20, cache_write_5m: 25, cache_write_1h: 40, cache_read: 2, output: 100 }] }));
  assert.equal(cost(e), 20 + 100);
  assert.equal(priceFor('claude-sonnet-5-5-20260101').input, 20);
  assert.match(report([e]), /\$120\.00/);
  // a model only the bundled table knows is still priced
  assert.equal(cost(entry('claude-opus-5')), 5 + 25);
});

test('ledger report: the longest model prefix wins and long prompts carry the surcharge', () => {
  fs.rmSync(path.join(dir, 'prices.json'), { force: true });
  assert.equal(cost(entry('claude-opus-5-5')), 4 + 20, 'opus-5-5 beats the shorter opus-5 prefix');
  // haiku-5-5: a prompt above 100,000 tokens costs 5x
  assert.ok(Math.abs(cost(entry('claude-haiku-5-5', { input_tokens: 200000, output_tokens: 0 })) - 5 * 0.1 * 0.2) < 1e-12);
});

test('ledger report: the long-context surcharge is per request, never on an agent\'s summed usage', () => {
  // ten Haiku 5.5 requests of 20,000 tokens: each below the 100,000 threshold
  const ten = { ...entry('claude-haiku-5-5', { input_tokens: 200000, output_tokens: 0 }), requests: 10 };
  assert.ok(Math.abs(cost(ten) - 0.1 * 0.2) < 1e-12, 'a sum without per-request data is priced normally');
  const perRequest = Array.from({ length: 10 }, () => ({ in: 20000, cw5: 0, cw1h: 0, cr: 0, out: 0 }));
  assert.ok(Math.abs(cost({ ...ten, perRequest }) - 0.1 * 0.2) < 1e-12);
  perRequest[0] = { in: 110000, cw5: 0, cw1h: 0, cr: 0, out: 0 };
  assert.ok(Math.abs(cost({ ...ten, perRequest }) - (5 * 0.1 * 0.11 + 0.1 * 0.18)) < 1e-12, 'only the long request costs 5x');
  assert.equal(cost({ ...ten, model: 'mystery', perRequest }), null);
});

test('ledger report re-reads each request from the transcript and keeps only the given session', () => {
  const { main } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'ledger-report.js'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-ledger-session-'));
  fs.mkdirSync(path.join(project, '.keel', 'local'), { recursive: true });
  const transcript = path.join(project, 't.jsonl');
  const row = (id) => JSON.stringify({ message: { id, role: 'assistant', model: 'claude-haiku-5-5', usage: { input_tokens: 20000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [] } });
  fs.writeFileSync(transcript, Array.from({ length: 10 }, (_, i) => row(`m${i}`)).join('\n'));
  const line = (sid, id) => JSON.stringify({ ts: '2026-10-14T10:00:00.000Z', session_id: sid, agent_id: id, agent_type: 'keel:reviewer', model: 'claude-haiku-5-5', effort: null, usage: { input_tokens: 200000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, requests: 10, transcript });
  fs.writeFileSync(path.join(project, '.keel', 'local', 'ledger.jsonl'), `${line('s1', 'a1')}\n${line('s2', 'a2')}\n`);
  assert.match(main([project, '--since', '2026-01-01']), /^total: 2 agents, \$0\.04;/m);
  assert.match(main([project, '--since', '2026-01-01', '--session', 's1']), /^total: 1 agents, \$0\.02;/m);
});

test('tokensOf: the 5-minute cache writes come from the transcript when given, else what the 1-hour writes leave', () => {
  const { tokensOf } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'tokens.js'));
  assert.deepEqual(tokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 10, cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 6 } }), { in: 1, cw5: 4, cw1h: 6, cr: 3, out: 2 });
  assert.deepEqual(tokensOf({ cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 6 } }), { in: 0, cw5: 4, cw1h: 6, cr: 0, out: 0 });
  assert.deepEqual(tokensOf({ cache_creation_input_tokens: 10, cache_creation_1h_input_tokens: 7 }), { in: 0, cw5: 3, cw1h: 7, cr: 0, out: 0 }, 'a ledger line');
  assert.deepEqual(tokensOf(null), { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 });
});
