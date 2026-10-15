'use strict';
// Builds a synthetic Claude Code session on disk: a main transcript and two agents with meta files.
// Timeline (minutes from T0): prompt 1 at 0, prompt 2 at 12, prompt 3 at 18; agent A starts at 2 and still
// answers at 20 (after prompt 3); agent B starts at 13.5 and is resumed at 15; a 6.5 minute pause follows 5.5.
const fs = require('node:fs');
const path = require('node:path');

const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const at = (min) => new Date(T0 + Math.round(min * 60000)).toISOString();
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const LONG_TEXT = 'x'.repeat(2000);

// Prices per token kind for the test cost function: only models named *-opus-* and *-haiku-* are priced.
const PRICE = { 'test-opus-1': 1, 'test-haiku-1': 0.2 };
function price(model, tok) {
  if (!(model in PRICE)) return null;
  return PRICE[model] * (tok.in + tok.out * 5 + tok.cr * 0.1 + tok.cw5 * 1.25 + tok.cw1h * 2) / 1000;
}

const usageOf = ({ in: i, out, cr, cw5, cw1h }) => ({
  input_tokens: i, output_tokens: out, cache_read_input_tokens: cr,
  cache_creation_input_tokens: cw5 + cw1h,
  cache_creation: { ephemeral_5m_input_tokens: cw5, ephemeral_1h_input_tokens: cw1h },
});

// Expected request table: id -> who, minute, model, turn (1-3), tokens as the module must report them.
const REQ = {
  m1: { who: 'main', min: 1, model: 'test-opus-1', turn: 1, tok: { in: 10, out: 40, cr: 1000, cw5: 200, cw1h: 300 } },
  m2: { who: 'main', min: 4, model: 'test-opus-1', turn: 1, tok: { in: 20, out: 501, cr: 2000, cw5: 0, cw1h: 0 } },
  m3: { who: 'main', min: 13, model: 'test-opus-1', turn: 2, tok: { in: 5, out: 25, cr: 3000, cw5: 100, cw1h: 0 } },
  m4: { who: 'main', min: 19, model: 'test-opus-1', turn: 3, tok: { in: 6, out: 12, cr: 3500, cw5: 0, cw1h: 50 } },
  a1: { who: 'aaa1', min: 2.5, model: 'test-haiku-1', turn: 1, tok: { in: 100, out: 60, cr: 0, cw5: 4000, cw1h: 0 } },
  a2: { who: 'aaa1', min: 3.5, model: 'test-haiku-1', turn: 1, tok: { in: 120, out: 70, cr: 4000, cw5: 500, cw1h: 0 } },
  a3: { who: 'aaa1', min: 20, model: 'test-haiku-1', turn: 1, tok: { in: 130, out: 80, cr: 4500, cw5: 0, cw1h: 0 } },
  b1: { who: 'bbb2', min: 14, model: 'test-mystery-1', turn: 2, tok: { in: 50, out: 30, cr: 0, cw5: 900, cw1h: 0 } },
  b2: { who: 'bbb2', min: 16, model: 'test-mystery-1', turn: 2, tok: { in: 55, out: 35, cr: 900, cw5: 0, cw1h: 0 } },
};

function base(extra) {
  return { sessionId: SESSION_ID, cwd: 'O:\\work\\demo', gitBranch: 'feature-x', entrypoint: 'cli', ...extra };
}
const user = (min, content, extra = {}) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content }, ...extra });
const toolResult = (min, extra = {}) => user(min, [{ type: 'tool_result', tool_use_id: 'tu', content: 'ok' }], extra);

function asst(id, content, usageObj) {
  const r = REQ[id];
  return {
    type: 'assistant', timestamp: at(r.min),
    message: { role: 'assistant', id: `msg_${id}`, model: r.model, content, usage: usageObj || usageOf(r.tok) },
  };
}

function writeJsonl(file, rows, extraLines = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r));
  fs.writeFileSync(file, lines.concat(extraLines).join('\n') + '\n');
}

// Writes the session under <root>/<projDir>/. Returns paths and the session id.
function buildSession(root, { projDir = 'proj-demo', malformed = false } = {}) {
  const dir = path.join(root, projDir);
  const main = path.join(dir, `${SESSION_ID}.jsonl`);
  const sub = path.join(dir, SESSION_ID, 'subagents');
  const m = (r) => ({ ...base({ isSidechain: false }), ...r });
  const mainRows = [
    m(user(0, 'Build the thing. Key sk-test1234567890abcdef is private')),
    // m1 streamed over two rows with the same message id: the last usage counts, the time is the first row's.
    m(asst('m1', [{ type: 'thinking', thinking: 'hmm' }], usageOf({ ...REQ.m1.tok, out: 5 }))),
    m({ ...asst('m1', [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { prompt: 'go' } }]), timestamp: at(1.1) }),
    m(toolResult(2)),
    // m2: recorded output 1 token but 2000 visible characters, so the output is estimated.
    m(asst('m2', [{ type: 'text', text: LONG_TEXT }, { type: 'tool_use', id: 'tu2', name: 'Read', input: {} }],
      usageOf({ ...REQ.m2.tok, out: 1 }))),
    m(user(5, 'meta text', { isMeta: true })),
    m(user(5.5, '<command-name>/clear</command-name>')),
    m(user(5.5, '<local-command-stdout>done</local-command-stdout>')),
    m(user(12, [{ type: 'text', text: 'Second prompt' }])),
    m(asst('m3', [{ type: 'tool_use', id: 'tu3', name: 'Agent', input: {} }, { type: 'tool_use', id: 'tu4', name: 'Task', input: {} }])),
    m(user(18, 'Third prompt')),
    m(asst('m4', [{ type: 'text', text: 'ok' }])),
  ];
  writeJsonl(main, mainRows, malformed ? ['{not json', ''] : []);

  const a = (r) => ({ ...base({ isSidechain: true }), ...r });
  writeJsonl(path.join(sub, 'agent-aaa1.jsonl'), [
    a(user(2, 'agent task A')),
    a(asst('a1', [{ type: 'tool_use', id: 'tuA1', name: 'Read', input: {} }])),
    a(toolResult(3)),
    // a2 records only cache_creation_input_tokens (no per-TTL split): all of it counts as 5 minute.
    a(asst('a2', [{ type: 'text', text: 'done' }], {
      input_tokens: 120, output_tokens: 70, cache_read_input_tokens: 4000, cache_creation_input_tokens: 500,
    })),
    a(asst('a3', [{ type: 'text', text: 'late' }])),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-aaa1.meta.json'), JSON.stringify({ agentType: 'keel:implementer' }));
  writeJsonl(path.join(sub, 'agent-bbb2.jsonl'), [
    a(user(13.5, 'agent task B')),
    a(asst('b1', [{ type: 'text', text: 'first reply' }])),
    a(user(15, [{ type: 'text', text: 'follow-up for B' }])),
    a(asst('b2', [{ type: 'text', text: 'second reply' }])),
  ]);
  fs.writeFileSync(path.join(sub, 'agent-bbb2.meta.json'), JSON.stringify({ agentType: 'general-purpose' }));
  return { dir, main, sub, sessionId: SESSION_ID, agentFiles: { aaa1: path.join(sub, 'agent-aaa1.jsonl'), bbb2: path.join(sub, 'agent-bbb2.jsonl') } };
}

module.exports = { buildSession, price, REQ, T0, at, SESSION_ID, LONG_TEXT, usageOf, writeJsonl, user, asst };
