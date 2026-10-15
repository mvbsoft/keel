'use strict';
// Summarizes Claude Code session transcripts (main + subagents) into sessions, participants, user turns and
// per-request rows for the cost report and the spending dashboard. Read-only, never throws on bad rows.
// Token rules follow hooks/ledger.js: one request = one distinct assistant message id, the last usage row of
// that id counts, and a recorded output far below the visible output (about 4 characters per token over text,
// thinking and tool input) is replaced by the visible estimate and flagged.
// A user turn is a real prompt in the main transcript. A turn owns the main requests made before the next
// turn plus every request of the agents started in that window (background agents keep billing later).
const fs = require('node:fs');
const path = require('node:path');
const { tokensOf } = require('./tokens.js');

const CHARS_PER_TOKEN = 4;
const SESSION_FILE = /\.jsonl$/;
const NOT_A_PROMPT = ['<local-command-stdout>', '<local-command-caveat>',
  '<task-notification>', '<system-reminder>', '[Request interrupted by user'];

function redact(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[secret]');
  s = s.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[secret]');
  s = s.replace(/\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{8,}/g, '[secret]');
  s = s.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, '[secret]');
  s = s.replace(/\bglpat-[A-Za-z0-9_-]{8,}/g, '[secret]');
  s = s.replace(/\bnpm_[A-Za-z0-9]{36}\b/g, '[secret]');
  s = s.replace(/\b(?:sk|rk)_live_[A-Za-z0-9]{8,}/g, '[secret]');
  s = s.replace(/\bya29\.[A-Za-z0-9_-]{8,}/g, '[secret]');
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[secret]');
  s = s.replace(/\bxox[bpas]-[A-Za-z0-9-]{8,}/g, '[secret]');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [secret]');
  // scheme://user:pass@host keeps scheme and host; "password is X", "token=X", "api_key: X" keep the label.
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[secret]@');
  s = s.replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)(\s*(?:[=:]|\bis\b)\s*)\S+/gi, '$1$2[secret]');
  // Long hex or base64 runs. Base64 must mix cases and digits so words and lowercase paths survive.
  return s.replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, (run) => {
    const hex = /^[0-9a-fA-F]+$/.test(run) && /\d/.test(run);
    const b64 = /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run);
    return hex || b64 ? '[secret]' : run;
  });
}

// Control characters (ESC and the like) would reach the terminal and the report table.
function preview(text, n = 100) {
  const s = redact(text).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function activeMinutes(timestampsMs, gapMin = 5) {
  const ts = (timestampsMs || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < ts.length; i++) {
    const gap = (ts[i] - ts[i - 1]) / 60000;
    if (gap <= gapMin) total += gap;
  }
  return round1(total);
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
}

// A real user prompt: not a tool result, meta row, compact summary, command output or notification
// wrapper. A slash command is one, returned as { text, command: true }.
function promptOf(row, requireMain) {
  if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return null;
  if (requireMain && row.isSidechain) return null;
  const c = row.message && row.message.content;
  if (Array.isArray(c) && c.length && c.every((b) => b && b.type === 'tool_result')) return null;
  const text = promptText(c);
  const head = text.trimStart();
  if (NOT_A_PROMPT.some((p) => head.startsWith(p))) return null;
  // A slash command arrives wrapped: its turn reads as the user typed it, "/name args".
  if (head.startsWith('<command-')) {
    const name = /<command-name>([^<]*)<\/command-name>/.exec(head);
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(head);
    return name ? { text: `${name[1].trim()} ${args ? args[1].trim() : ''}`.trim(), command: true } : null;
  }
  return text;
}

function* rowsOf(text) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row === 'object') yield row;
  }
}

// Reads one transcript once. Returns timestamps, per-message data, prompts and first-seen metadata.
// A resumed or forked session starts with a copy of its parent's rows (same message ids and times). `skip` holds
// the ids another session owns: those messages and every other row up to the last of them (the copied prefix)
// are left out, so the session's own start is its first row after the copy. `first` is the file's first
// assistant message id: a session and its copies share it.
function scanFile(file, requireMain, skip) {
  const r = { ts: [], msgs: new Map(), prompts: [], afterReply: 0, cwd: '', gitBranch: '', entrypoint: '', first: '' };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return r; }
  const seenTools = new Set();
  let replied = false;
  const isAsst = (m) => !!(m && m.role === 'assistant' && m.id);
  let cut = -1;
  if (skip && skip.size) {
    let n = 0;
    for (const row of rowsOf(text)) { if (isAsst(row.message) && skip.has(row.message.id)) cut = n; n++; }
  }
  let n = -1;
  for (const row of rowsOf(text)) {
    n++;
    if (!r.first && isAsst(row.message)) r.first = String(row.message.id);
    // inside the copied prefix only a message nobody else owns still counts
    if (n <= cut && (!isAsst(row.message) || skip.has(row.message.id))) continue;
    const t = Date.parse(row.timestamp);
    if (Number.isFinite(t)) r.ts.push(t);
    if (!r.cwd && row.cwd) r.cwd = String(row.cwd);
    if (!r.gitBranch && row.gitBranch) r.gitBranch = String(row.gitBranch);
    if (!r.entrypoint && row.entrypoint) r.entrypoint = String(row.entrypoint);
    const m = row.message;
    if (m && m.role === 'assistant' && m.id) {
      replied = true;
      let e = r.msgs.get(m.id);
      if (!e) { e = { t: Number.isFinite(t) ? t : null, usage: null, model: null, chars: 0, tools: {}, launched: 0 }; r.msgs.set(m.id, e); }
      if (e.t == null && Number.isFinite(t)) e.t = t;
      if (m.usage) e.usage = m.usage;
      if (m.model) e.model = m.model;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (!b) continue;
        if (b.type === 'text') e.chars += (b.text || '').length;
        else if (b.type === 'thinking') e.chars += (b.thinking || '').length;
        else if (b.type === 'tool_use') {
          e.chars += JSON.stringify(b.input || {}).length;
          if (b.id) { if (seenTools.has(b.id)) continue; seenTools.add(b.id); }
          const name = String(b.name || 'unknown');
          e.tools[name] = (e.tools[name] || 0) + 1;
          if (name === 'Agent' || name === 'Task') e.launched++;
        }
      }
    } else if (row.type === 'user') {
      const p = promptOf(row, requireMain);
      if (p !== null) {
        const cmd = typeof p === 'object';
        r.prompts.push({ t: Number.isFinite(t) ? t : null, text: cmd ? p.text : p, command: cmd });
        if (replied) r.afterReply++;
      }
    }
  }
  return r;
}

function tokOf(e) {
  const tok = tokensOf(e.usage);
  const visible = Math.ceil(e.chars / CHARS_PER_TOKEN);
  const estimated = visible > tok.out * 1.5 + 50;
  if (estimated) tok.out = visible;
  return { tok, estimated };
}

function addTok(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k];
}

const zeroTok = () => ({ in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 });

function readMeta(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}

// Builds a participant and its request rows from a scanned file.
function participant(scan, base, cost, unpriced) {
  const p = {
    kind: base.kind, ...(base.kind === 'agent' ? { agent_id: base.agent_id } : {}), type: base.type,
    model: null, by_model: {}, start: null, end: null, active_min: activeMinutes(scan.ts), requests: 0,
    tools: {}, agents_launched: 0, tok: zeroTok(), usd: 0, output_estimated: false,
    resumed: base.kind === 'agent' ? scan.afterReply : 0,
  };
  if (scan.ts.length) {
    p.start = new Date(scan.ts.reduce((a, b) => Math.min(a, b))).toISOString();
    p.end = new Date(scan.ts.reduce((a, b) => Math.max(a, b))).toISOString();
  }
  const rows = [];
  for (const [id, e] of scan.msgs) {
    if (e.model === '<synthetic>') continue;
    const { tok, estimated } = tokOf(e);
    const model = e.model || 'unknown';
    const usd = cost(model, tok);
    const known = typeof usd === 'number' && Number.isFinite(usd);
    if (!known) unpriced.add(model);
    const bm = p.by_model[model] || (p.by_model[model] = { requests: 0, tok: zeroTok(), usd: 0 });
    bm.requests++;
    addTok(bm.tok, tok);
    if (known) { bm.usd += usd; p.usd += usd; }
    addTok(p.tok, tok);
    p.requests++;
    if (estimated) p.output_estimated = true;
    for (const [name, n] of Object.entries(e.tools)) p.tools[name] = (p.tools[name] || 0) + n;
    p.agents_launched += e.launched;
    rows.push({ id, t: e.t, model, tok, usd: known ? usd : null });
  }
  let best = 0;
  for (const [model, bm] of Object.entries(p.by_model)) if (bm.requests > best) { best = bm.requests; p.model = model; }
  return { p, rows };
}

function summarizeSession(mainFile, opts = {}) {
  const cost = opts.cost || (() => null);
  const withText = opts.prompts !== false;
  const previewChars = opts.previewChars || 100;
  const id = path.basename(mainFile).replace(/\.jsonl$/, '');
  const unpriced = new Set();

  const skip = opts.skip && opts.skip.size ? opts.skip : null;
  const main = scanFile(mainFile, true, skip);
  const parts = [];
  const mainPart = participant(main, { kind: 'main', type: 'main' }, cost, unpriced);
  parts.push(mainPart);

  const agentsDir = path.join(path.dirname(mainFile), id, 'subagents');
  let names = [];
  try { names = fs.readdirSync(agentsDir); } catch { /* no agents */ }
  const agents = [];
  for (const name of names) {
    const m = /^agent-(.+)\.jsonl$/.exec(name);
    if (!m) continue;
    const scan = scanFile(path.join(agentsDir, name), false, skip);
    const meta = readMeta(path.join(agentsDir, `agent-${m[1]}.meta.json`));
    agents.push({ scan, startMs: scan.ts.length ? scan.ts.reduce((a, b) => Math.min(a, b)) : Infinity,
      base: { kind: 'agent', agent_id: m[1], type: meta.agentType || 'unknown' } });
  }
  agents.sort((a, b) => a.startMs - b.startMs || (a.base.agent_id < b.base.agent_id ? -1 : 1));
  for (const a of agents) a.built = participant(a.scan, a.base, cost, unpriced);
  for (const a of agents) parts.push(a.built);

  const allTs = main.ts.concat(...agents.map((a) => a.scan.ts));
  const startMs = allTs.length ? allTs.reduce((a, b) => Math.min(a, b)) : null;
  const endMs = allTs.length ? allTs.reduce((a, b) => Math.max(a, b)) : null;

  // Requests, flat and sorted by time.
  const requests = [];
  parts.forEach((x, i) => { for (const r of x.rows) requests.push({ t: r.t, p: i, id: r.id, model: r.model, tok: r.tok, usd: r.usd }); });
  requests.sort((a, b) => (a.t == null) - (b.t == null) || a.t - b.t);

  // Turns: real prompts of the main transcript, plus a leading text-less turn for earlier activity.
  const prompts = main.prompts.filter((x) => x.t != null).sort((a, b) => a.t - b.t);
  const turns = prompts.map((x) => {
    const turn = { t: x.t };
    if (withText) turn.text = preview(x.text, previewChars);
    return Object.assign(turn, { usd: 0, requests: 0, agents: 0, command: x.command });
  });
  const turnAt = (t) => {
    let lo = 0, hi = turns.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (turns[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  };
  const lead = { t: null, text: null, usd: 0, requests: 0, agents: 0 };
  const turnFor = (t) => {
    const i = t == null ? -1 : turnAt(t);
    if (i >= 0) return turns[i];
    if (t != null && (lead.t == null || t < lead.t)) lead.t = t;
    return lead;
  };
  // Main requests by their own time, agent requests by the agent's start.
  parts.forEach((x, i) => {
    if (i === 0) {
      for (const r of x.rows) {
        const turn = turnFor(r.t);
        turn.requests++;
        if (r.usd != null) turn.usd += r.usd;
      }
      return;
    }
    const startT = agents[i - 1].startMs;
    const turn = turnFor(Number.isFinite(startT) ? startT : null);
    turn.agents++;
    for (const r of x.rows) {
      turn.requests++;
      if (r.usd != null) turn.usd += r.usd;
    }
  });
  // A command the model never answered (/clear, /usage) is not a turn.
  const outTurns = (lead.requests || lead.agents ? [lead] : []).concat(turns.filter((x) => !x.command || x.requests || x.agents))
    .map(({ command, ...x }) => x);

  const usd = parts.reduce((s, x) => s + x.p.usd, 0);
  const cwd = main.cwd;
  return {
    id,
    cwd,
    project: cwd.split(/[\\/]/).filter(Boolean).pop() || '',
    gitBranch: main.gitBranch,
    entrypoint: main.entrypoint,
    first: main.first,
    start: startMs == null ? null : new Date(startMs).toISOString(),
    end: endMs == null ? null : new Date(endMs).toISOString(),
    duration_min: startMs == null ? 0 : round1((endMs - startMs) / 60000),
    active_min: activeMinutes(allTs),
    usd,
    unpriced: [...unpriced],
    participants: parts.map((x) => x.p),
    turns: outTurns,
    requests,
  };
}

module.exports = { redact, preview, activeMinutes, summarizeSession };
