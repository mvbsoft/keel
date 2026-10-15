'use strict';
// Small transcript writer for the usage store and CLI tests: a main transcript with prompts and requests at chosen
// absolute times (the shared fixtures/transcripts.js session has fixed times).
const fs = require('node:fs');
const path = require('node:path');

const usageOf = ({ in: i = 0, out = 0, cr = 0, cw5 = 0, cw1h = 0 }) => ({
  input_tokens: i, output_tokens: out, cache_read_input_tokens: cr,
  cache_creation_input_tokens: cw5 + cw1h,
  cache_creation: { ephemeral_5m_input_tokens: cw5, ephemeral_1h_input_tokens: cw1h },
});

// rows: [{t: epoch ms, prompt: 'text'} | {t, model, tok: {in, out, cr, cw5, cw1h}}], in any order.
// Returns {file, id}.
function writeSession(root, { id, projDir = 'proj-test', cwd = 'O:\\work\\demo', rows, mtimeMs }) {
  const base = { sessionId: id, cwd, gitBranch: 'main', entrypoint: 'cli', isSidechain: false };
  const lines = [...rows].sort((a, b) => a.t - b.t).map((r, i) => JSON.stringify(
    'prompt' in r
      ? { ...base, type: 'user', timestamp: new Date(r.t).toISOString(), message: { role: 'user', content: r.prompt } }
      : {
        ...base, type: 'assistant', timestamp: new Date(r.t).toISOString(),
        message: { role: 'assistant', id: `msg_${id}_${i}`, model: r.model, content: [{ type: 'text', text: 'ok' }], usage: usageOf(r.tok) },
      },
  ));
  const file = path.join(root, projDir, `${id}.jsonl`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return { file, id };
}

// Appends one request row to an existing main transcript.
function appendRequest(file, id, { t, model, tok }) {
  const row = {
    sessionId: id, cwd: 'O:\\work\\demo', isSidechain: false, type: 'assistant', timestamp: new Date(t).toISOString(),
    message: { role: 'assistant', id: `msg_${id}_late${t}`, model, content: [{ type: 'text', text: 'ok' }], usage: usageOf(tok) },
  };
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

module.exports = { writeSession, appendRequest, usageOf };
