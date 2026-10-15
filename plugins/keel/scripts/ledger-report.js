'use strict';
// Token report for step 12: every agent that finished since a moment, from .keel/local/ledger.jsonl.
// Usage: node ledger-report.js <projectDir> [--since <ISO time>] [--agent <name>] [--session <id>]
//   default --since: the start of the current verification run (.keel/local/tmp/verify-run.json)
//   --agent: only that keel agent (e.g. implementer)
//   --session: only agents of that Claude Code session (other sessions in the same project are left out)
// A resumed agent (repair by message) adds a ledger line per run over the same transcript; only its
// last line counts.
// Cost is an estimate at list price (data/prices.json plus the machine override ~/.claude/keel/prices.json, through
// lib/prices.js); on a subscription it counts against limits.
// Each agent's transcript is summed again here: when the ledger hook ran, the transcript could still
// miss the agent's last response.
const fs = require('node:fs');
const path = require('node:path');
const { loadPrices, priceFor: lookup, costOf } = require('./lib/prices.js');
const { summarize } = require('../hooks/ledger.js');
const { tokensOf } = require('./lib/tokens.js');
const { localDir, readJson, parseArgs } = require('./lib/project.js');

const priceFor = (model, table = loadPrices()) => lookup(model, table);

// A long-context price is per request: each request is priced on its own when the transcript gave them
// (or the agent made one request); a sum over requests is priced without it, being no request's size.
function cost(entry, table = loadPrices()) {
  const requests = entry.perRequest || (entry.requests === 1 ? [tokensOf(entry.usage)] : null);
  if (!requests) return costOf(entry.model, tokensOf(entry.usage), { models: table.models.map(({ long_context: _, ...p }) => p) });
  if (!lookup(entry.model, table)) return null;
  return requests.reduce((sum, tok) => sum + costOf(entry.model, tok, table), 0);
}

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (n) => (n === null ? 'n/a' : `$${n.toFixed(2)}`);
const family = (model) => (model ? (/opus|sonnet|haiku/.exec(model) || [model])[0] : 'unknown');

// The fuller of the hook's numbers and a fresh sum of the finished transcript.
function refresh(entry) {
  if (!entry.transcript) return entry;
  try {
    const s = summarize(entry.transcript);
    if (s.requests < entry.requests) return entry;
    return { ...entry, model: s.model || entry.model, usage: s.usage, requests: s.requests, output_estimated: s.estimated, perRequest: s.perRequest };
  } catch {
    return entry;
  }
}

function report(entries, table = loadPrices()) {
  if (!entries.length) return 'ledger: no agents finished in this period';
  const out = ['ledger (tokens exact; cost an estimate at list price, within about 20 % of Claude Code\'s own figure; on a subscription these tokens count against plan limits):'];
  const totals = new Map();
  let all = 0;
  let unknown = false;
  for (const e of entries) {
    const c = cost(e, table);
    const u = e.usage;
    const read = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
    out.push(`- ${e.agent_type.replace(/^keel:/, '')} (${family(e.model)}${e.effort ? `, ${e.effort}` : ''}): ${e.requests} requests, input ${k(read)} (cache read ${k(u.cache_read_input_tokens)}), output ${e.output_estimated ? '~' : ''}${k(u.output_tokens)}, ${usd(c)}`);
    const f = family(e.model);
    const t = totals.get(f) || { n: 0, cost: 0 };
    t.n++;
    if (c === null) unknown = true; else { t.cost += c; all += c; }
    totals.set(f, t);
  }
  out.push(`total: ${entries.length} agents, ${usd(all)}${unknown ? ' (plus agents on models without a known price)' : ''}; by model: ${[...totals].map(([f, t]) => `${f} ${t.n} ${usd(t.cost)}`).join(', ')}`);
  if (entries.some((e) => e.output_estimated)) out.push('~ output estimated from visible text: transcripts under-record output, hidden reasoning is not counted');
  return out.join('\n');
}

// One entry per agent: a resumed agent's later line covers its whole transcript.
function lastPerAgent(entries) {
  const byAgent = new Map();
  for (const e of entries) byAgent.set(`${e.agent_id}|${e.transcript}`, e);
  return [...byAgent.values()];
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || '.');
  let since = typeof opts.since === 'string' ? opts.since : null;
  if (!since) { const run = readJson(localDir(root, 'tmp', 'verify-run.json')); since = run ? run.started : null; }
  let lines = [];
  try { lines = fs.readFileSync(localDir(root, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { /* empty */ }
  const agent = typeof opts.agent === 'string' ? `keel:${opts.agent.replace(/^keel:/, '')}` : null;
  const session = typeof opts.session === 'string' ? opts.session : null;
  const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.usage && (!since || e.ts >= since) && (!agent || e.agent_type === agent) && (!session || e.session_id === session));
  return report(lastPerAgent(entries).map(refresh));
}

if (require.main === module) {
  let out;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `ledger: error: ${e.message}`; }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { cost, report, refresh, priceFor, lastPerAgent, main };
