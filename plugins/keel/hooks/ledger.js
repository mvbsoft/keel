'use strict';
// SubagentStop hook: token ledger and agent replies. Runs only in projects that have a .keel/ folder.
// 1. Appends one line per finished agent to .keel/local/ledger.jsonl, summed from the agent's own
//    transcript: the last usage row per message id (a response is logged in several rows). When this hook
//    runs, the transcript may still miss the agent's last response, so the line keeps the transcript
//    path and scripts/ledger-report.js sums it again when it reports. Where a transcript records only
//    an early snapshot of a response's output and the visible output (text and tool input) is clearly
//    longer, output is an estimate (about 4 characters per token, hidden reasoning not included)
//    marked output_estimated: true. summarize() also returns the tokens of each request (perRequest)
//    for the report: a long-context price applies per request, never to a sum.
// 2. Saves the final reply of every keel agent to .keel/local/tmp/agents/<name>-<agent id>.md, where
//    the verification scripts read findings and verdicts; a context map also goes to
//    .keel/local/tmp/context-map.md for the other agents. A reply handed back through SubagentHandback
//    (auto mode) is saved by hooks/handback.js first and kept.
// Never blocks the agent, prints nothing, fails soft (the transcript format is undocumented).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tokensOf } = require('../scripts/lib/tokens.js');

const CHARS_PER_TOKEN = 4;

function summarize(transcriptPath) {
  const rows = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  const byId = new Map();
  for (const raw of rows) {
    if (!raw) continue;
    let row;
    try { row = JSON.parse(raw); } catch { continue; }
    const m = row.message;
    if (!m || m.role !== 'assistant' || !m.id) continue;
    const entry = byId.get(m.id) || { usage: null, model: null, chars: 0 };
    if (m.usage) entry.usage = m.usage;
    if (m.model) entry.model = m.model;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'text') entry.chars += (b.text || '').length;
      else if (b.type === 'thinking') entry.chars += (b.thinking || '').length;
      else if (b.type === 'tool_use') entry.chars += JSON.stringify(b.input || {}).length;
    }
    byId.set(m.id, entry);
  }
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0 };
  let model = null;
  let estimated = false;
  const perRequest = [];
  for (const e of byId.values()) {
    if (e.model && e.model !== '<synthetic>') model = e.model;
    const tok = tokensOf(e.usage);
    const visible = Math.ceil(e.chars / CHARS_PER_TOKEN);
    if (visible > tok.out * 1.5 + 50) { tok.out = visible; estimated = true; }
    usage.input_tokens += tok.in;
    usage.cache_read_input_tokens += tok.cr;
    usage.cache_creation_input_tokens += tok.cw5 + tok.cw1h;
    usage.cache_creation_1h_input_tokens += tok.cw1h;
    usage.output_tokens += tok.out;
    perRequest.push(tok);
  }
  return { usage, model, requests: byId.size, estimated, perRequest };
}

// Saves a keel agent's reply where the verification scripts read it. keep: leave a saved reply as it is.
function saveReply(project, type, agentId, text, { keep = false } = {}) {
  if (!type.startsWith('keel:') || !agentId) return;
  const { safeLocalWrite } = require('../scripts/lib/safe-path.js');
  const name = type.slice(5).replace(/[^a-z0-9-]/g, '');
  const file = path.join(project, '.keel', 'local', 'tmp', 'agents', `${name}-${agentId}.md`);
  if (keep && fs.existsSync(file)) return;
  try {
    safeLocalWrite(project, ['tmp', 'agents', `${name}-${agentId}.md`], text);
    if (name === 'context' && /^\s*# Context map/.test(text)) safeLocalWrite(project, ['tmp', 'context-map.md'], text);
  } catch { /* refused (a link on the way): nothing is saved */ }
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const type = String(input.agent_type || '');
  if (!type || !input.agent_id) return;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!project || !fs.existsSync(path.join(project, '.keel'))) return;
  // Every write refuses a link on the way or at the file (a junction below .keel/local would carry
  // agent replies out of the project).
  const { safeLocalWrite } = require('../scripts/lib/safe-path.js');
  const agentId = String(input.agent_id).replace(/[^A-Za-z0-9_-]/g, '');

  // A report already delivered through SubagentHandback (hooks/handback.js) is the agent's real reply;
  // last_assistant_message then holds only its closing words.
  if (typeof input.last_assistant_message === 'string') saveReply(project, type, agentId, input.last_assistant_message, { keep: true });

  let file = String(input.agent_transcript_path || '');
  if (file.startsWith('~')) file = path.join(os.homedir(), file.slice(1));
  let summary = { usage: null, model: null, requests: 0, estimated: false };
  try { summary = summarize(file); } catch { /* transcript unreadable: record what is known */ }
  const level = input.effort && typeof input.effort === 'object' ? input.effort.level : input.effort;
  const line = {
    ts: new Date().toISOString(),
    session_id: String(input.session_id || ''),
    agent_id: agentId,
    agent_type: type,
    model: summary.model,
    effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(level) ? level : null,
    usage: summary.usage || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    requests: summary.requests,
    output_estimated: summary.estimated,
    transcript: file,
  };
  safeLocalWrite(project, 'ledger.jsonl', JSON.stringify(line) + '\n', { append: true });
}

if (require.main === module) {
  try { main(); } catch { /* never disturb the session */ }
  process.exit(0);
}

module.exports = { summarize, saveReply };
