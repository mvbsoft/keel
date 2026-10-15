'use strict';
// Steps 6-7 of verification: which findings go to which verifier, and what the verdicts add up to.
// Agent replies are the files the SubagentStop hook saves in .keel/local/tmp/agents/.
// Usage: node votes.js <projectDir> plan --tier <basic|standard|maximum>
//          → .keel/local/tmp/verify-plan.json and one task file per verifier launch
//            (.keel/local/tmp/verify-tasks/<launch>.json)
//        node votes.js <projectDir> tally
//          → .keel/local/tmp/verify-result.json (what the judge reads); reads the session's re-runs of
//            QA's reproduce commands from .keel/local/tmp/reproduce.json ({ "<id>": "reproduced" |
//            "not reproduced" }): a proven finding that did not reproduce becomes unclear.
// Rules: QA findings with a reproduce command are proven; minor findings are not
// verified; a critical finding gets its own verifier, three (one per lens) on Maximum, kept only
// with at least 2 of 3; important findings go 2-3 per verifier from the same file or folder; the
// cap counts verifier launches, critical first; what does not fit is "not verified" with the reason.
const fs = require('node:fs');
const path = require('node:path');
const { validate, prune } = require('./lib/schema.js');
const { lineup, levelOf, verifierCaps } = require('./lib/tier.js');
const { loadProject, localDir, writeLocal, readJson, parseArgs } = require('./lib/project.js');
const { safeLocalPath } = require('./lib/safe-path.js');

const SCHEMAS = path.join(__dirname, '..', 'schemas');
const LENSES = ['reachability', 'impact', 'defenses'];
const PROVEN_BY_RUNNING = new Set(['qa', 'qa-break']);
// "Same place": same file, lines at most NEAR_LINES apart. A group shares one launch, at most MAX_GROUP
// findings (in test runs one issue was reported by up to four agents at lines a few apart).
const NEAR_LINES = 3;
const MAX_GROUP = 4;

// For a reply that is not valid JSON: a backslash pair, or a backslash that starts no escape kept as one.
// \u needs 4 hex digits; \b \f \r \t before a letter are taken as path parts (src\tests, src\routes),
// since a real tab shown as \t costs less than a broken path; \n always stays a newline.
const BAD_ESCAPE = /\\\\|\\(?!["\\/n]|[bfrt](?![A-Za-z])|u[0-9a-fA-F]{4})/g;

// The JSON object in an agent's reply: a ```json block, else the outermost braces.
function extractJson(text) {
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(text);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* next */ }
    // Agents quote code and Windows paths in their text: a backslash JSON does not know (`ESCAPE '\'`)
    // lost a whole reviewer report in the levels re-run. Keep such a backslash as a literal one.
    try { return JSON.parse(c.replace(BAD_ESCAPE, (m) => (m === '\\\\' ? m : '\\\\'))); } catch { /* next */ }
  }
  return null;
}

function readReplies(root) {
  const dir = localDir(root, 'tmp', 'agents');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch { /* none yet */ }
  return names.map((name) => ({ file: name, json: extractJson(fs.readFileSync(path.join(dir, name), 'utf8')) }));
}

// Replies are saved as <agent>-<agent id>.md; only search agents report findings.
const SEARCH_AGENTS = new Set(['qa', 'qa-break', 'reviewer', 'bug-hunter', 'test-reviewer', 'architect', 'security', 'data', 'docs', 'env']);
const agentOf = (file) => file.replace(/-[^-]+\.md$/, '');
const dirOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.');

// One faulty item must not drop a whole report (a stray `note` field or one location without
// a line threw away whole QA and verifier reports, with every finding or verdict in them). Properties
// the schema does not know are removed and listed as repaired; the report's frame is checked on its
// own; each item of `key` is checked alone, bad ones are listed as invalid and the rest are kept.
function salvage(r, schema, key) {
  const json = structuredClone(r.json);
  const dropped = prune(json, schema);
  const frame = { ...schema, properties: { ...schema.properties, [key]: { type: 'array' } } };
  const errors = validate(json, frame);
  if (errors.length) return { invalid: [{ file: r.file, errors: errors.slice(0, 3) }], repaired: [], json: null };
  const invalid = [];
  const kept = [];
  json[key].forEach((item, i) => {
    const bad = validate(item, schema.properties[key].items, schema, `$.${key}[${i}]`);
    if (bad.length) invalid.push({ file: r.file, item: (item && (item.id || item.finding_id)) || i, errors: bad.slice(0, 3) });
    else kept.push(item);
  });
  return { invalid, repaired: dropped.length ? [{ file: r.file, dropped }] : [], json: { ...json, [key]: kept } };
}

// A finding with no usable id would be left out as invalid and never verified: it gets one from its
// agent and its place in the report (a clash with another id is renamed below like any duplicate).
const FINDING_ID = /^[a-z][a-z0-9-]*-[0-9]+$/;
function withIds(r) {
  if (!r.json || !Array.isArray(r.json.findings)) return { r, ids: [] };
  const base = String(r.json.agent || agentOf(r.file)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+|-+$/g, '') || 'finding';
  const ids = [];
  const findings = r.json.findings.map((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f) || (typeof f.id === 'string' && FINDING_ID.test(f.id))) return f;
    ids.push(`${base}-${i + 1}`);
    return { ...f, id: `${base}-${i + 1}` };
  });
  return { r: ids.length ? { ...r, json: { ...r.json, findings } } : r, ids };
}

// reports: [{ file, json }] of search agents. Returns the plan object.
function makePlan(reports, tier, cap, verifierModels) {
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'findings.schema.json'), 'utf8'));
  const findings = {};
  const invalid = [];
  const incomplete = [];
  const repaired = [];
  const order = [];
  for (const r of reports) {
    if (!r.json || !Array.isArray(r.json.findings)) {
      // A search agent that answered without its JSON report would otherwise vanish from the plan.
      if (SEARCH_AGENTS.has(agentOf(r.file))) invalid.push({ file: r.file, errors: [r.json ? 'no findings array' : 'no JSON report (prose only)'] });
      continue;
    }
    const named = withIds(r);
    const s = salvage(named.r, schema, 'findings');
    invalid.push(...s.invalid);
    repaired.push(...s.repaired);
    if (named.ids.length) repaired.push({ file: r.file, ids: named.ids });
    if (!s.json) continue;
    if (s.json.status === 'incomplete') incomplete.push(s.json.agent);
    for (const f of s.json.findings) {
      let id = f.id;
      for (let k = 2; findings[id]; k++) id = f.id.replace(/-(\d+)$/, `-r${k}-$1`);
      findings[id] = { ...f, id, agent: s.json.agent };
      order.push(id);
    }
  }
  const proven = [];
  const minor = [];
  const critical = [];
  const important = [];
  for (const id of order) {
    const f = findings[id];
    if (PROVEN_BY_RUNNING.has(f.agent) && f.reproduce) proven.push(id);
    else if (f.severity === 'minor') minor.push(id);
    else if (f.severity === 'critical') critical.push(id);
    else important.push(id);
  }
  const modelFor = (id) => verifierModels[findings[id].agent] || verifierModels.default;
  const launches = [];
  const unverified = [];
  const oneVote = [];
  let left = cap;
  const launch = (model, lens, ids) => { launches.push({ id: `v${launches.length + 1}`, model, lens, findings: ids }); left--; };

  // Several agents often report one issue at one place. An important finding at the place of a
  // QA-proven one is already shown by running it; the others at one place share a verifier launch (each still gets
  // its own verdict), so the cap is spent on distinct issues.
  const near = (a, b) => a.locations.some((x) => b.locations.some((y) => x.file === y.file && Math.abs(x.line - y.line) <= NEAR_LINES));
  const pending = [];
  for (const id of [...critical, ...important]) {
    // Critical findings are always verified: a different issue may sit next to the proven one.
    const p = findings[id].severity !== 'critical' && proven.find((pid) => near(findings[pid], findings[id]));
    if (p) unverified.push({ id, reason: `same place as ${p}, which QA proved by running it` });
    else pending.push(id);
  }
  const groups = [];
  for (const id of pending) {
    const g = groups.find((x) => x.length < MAX_GROUP && modelFor(x[0]) === modelFor(id) && x.some((o) => near(findings[o], findings[id])));
    if (g) g.push(id);
    else groups.push([id]);
  }
  const critGroups = groups.filter((g) => findings[g[0]].severity === 'critical');
  const impGroups = groups.filter((g) => findings[g[0]].severity !== 'critical');

  // Critical: three lenses on Maximum while the cap allows every critical at least one vote.
  const triple = tier === 'maximum' ? Math.max(0, Math.min(critGroups.length, Math.floor((cap - critGroups.length) / 2))) : 0;
  critGroups.forEach((g, i) => {
    if (left <= 0) { for (const id of g) unverified.push({ id, reason: `verifier cap (${cap}) reached` }); return; }
    if (i < triple) for (const lens of LENSES) launch(modelFor(g[0]), lens, g);
    else {
      launch(modelFor(g[0]), 'general', g);
      if (tier === 'maximum') for (const id of g) if (findings[id].severity === 'critical') oneVote.push(id);
    }
  });

  // Important: up to 3 per launch (a same-place group stays whole), same verifier model, same file
  // first, then same folder.
  const buckets = new Map();
  for (const g of impGroups) {
    const key = `${modelFor(g[0])}\0${dirOf(findings[g[0]].locations[0].file)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  }
  for (const [key, list] of buckets) {
    list.sort((a, b) => findings[a[0]].locations[0].file.localeCompare(findings[b[0]].locations[0].file));
    const chunks = [];
    for (const g of list) {
      const last = chunks[chunks.length - 1];
      if (last && last.length + g.length <= 3) last.push(...g);
      else chunks.push([...g]);
    }
    for (const chunk of chunks) {
      if (left <= 0) { for (const id of chunk) unverified.push({ id, reason: `verifier cap (${cap}) reached` }); continue; }
      launch(key.split('\0')[0], 'general', chunk);
    }
  }
  return { tier, cap, used: cap - left, launches, proven, minor, unverified, one_vote: oneVote, invalid, repaired, incomplete, findings };
}

// Combines verdicts with the plan. Returns the result object the judge reads.
function tally(plan, reports, reruns = {}) {
  const schema = JSON.parse(fs.readFileSync(path.join(SCHEMAS, 'verdicts.schema.json'), 'utf8'));
  const byLaunch = new Map();
  const invalid = [];
  const repaired = [];
  for (const r of reports) {
    if (!r.json || !Array.isArray(r.json.verdicts)) continue;
    const s = salvage(r, schema, 'verdicts');
    invalid.push(...s.invalid);
    repaired.push(...s.repaired);
    if (s.json) byLaunch.set(s.json.verifier, s.json.verdicts);
  }
  const votes = new Map();
  const missing = new Set();
  for (const l of plan.launches) {
    const verdicts = byLaunch.get(l.id);
    for (const id of l.findings) {
      const v = verdicts && verdicts.find((x) => x.finding_id === id);
      if (!v) { missing.add(id); continue; }
      if (!votes.has(id)) votes.set(id, []);
      votes.get(id).push({ launch: l.id, lens: l.lens, verdict: v.verdict, evidence: v.evidence, reasoning: v.reasoning, restatement: v.restatement });
    }
  }
  const out = { confirmed: [], refuted: [], unclear: [], proven: [], minor: [], unverified: [...plan.unverified], invalid: [...plan.invalid, ...invalid], repaired: [...(plan.repaired || []), ...repaired], incomplete: plan.incomplete };
  const entry = (id, extra = {}) => ({ ...plan.findings[id], ...extra });
  const planned = new Set(plan.launches.flatMap((l) => l.findings));
  for (const id of planned) {
    const v = votes.get(id) || [];
    const expected = plan.launches.filter((l) => l.findings.includes(id)).length;
    if (!v.length) { out.unverified.push({ id, reason: 'the verifier returned no verdict for it' }); continue; }
    const count = (k) => v.filter((x) => x.verdict === k).length;
    let outcome;
    if (expected >= 3) outcome = count('CONFIRMED') >= 2 ? 'confirmed' : count('REFUTED') >= 2 ? 'refuted' : 'unclear';
    else outcome = { CONFIRMED: 'confirmed', REFUTED: 'refuted', UNCLEAR: 'unclear' }[v[0].verdict];
    const notes = [];
    if (plan.one_vote.includes(id)) notes.push('1 vote');
    if (expected >= 3 && v.length < expected) notes.push(`${v.length} of ${expected} votes returned`);
    out[outcome].push(entry(id, { votes: v, notes }));
  }
  for (const u of out.unverified) Object.assign(u, plan.findings[u.id] ? { finding: entry(u.id) } : {});
  // QA's claim stands only when the session's re-run of its reproduce command failed as described.
  for (const id of plan.proven) {
    if (reruns[id] === 'not reproduced') out.unclear.push(entry(id, { notes: ['QA\'s reproduce command did not show the problem when the session ran it again'] }));
    else out.proven.push(entry(id, { notes: [reruns[id] === 'reproduced' ? 'reproduced again by the session' : 'not run again'] }));
  }
  out.minor = plan.minor.map((id) => entry(id));
  return out;
}

const fixed = (r) => `${r.file} (${r.ids ? `ids given: ${r.ids.join(' ')}` : 'unknown fields dropped'})`;
const lost = (i) => `${i.file}${i.item !== undefined ? ` item ${i.item}` : ''}: ${i.errors.join('; ')}`;
const line = (f) => `${f.id} [${f.severity}, ${f.agent}] ${f.what}`.slice(0, 160);

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || '.');
  const cmd = pos[1];
  const { config } = loadProject(root);
  const replies = readReplies(root);
  if (cmd === 'plan') {
    const tier = levelOf(opts.tier);
    if (!['basic', 'standard', 'maximum'].includes(tier)) throw new Error('--tier must be basic, standard or maximum');
    const changes = readJson(localDir(root, 'tmp', 'changes.json'));
    const models = lineup(tier, changes || { groups: {}, sizes: [], architect_signal: [] }).verifier_models;
    const plan = makePlan(replies, tier, verifierCaps(config)[tier], models);
    fs.rmSync(safeLocalPath(root, 'tmp', 'verify-tasks'), { recursive: true, force: true });
    for (const l of plan.launches) {
      writeLocal(root, `tmp/verify-tasks/${l.id}.json`, JSON.stringify({ verifier: l.id, lens: l.lens, findings: l.findings.map((id) => plan.findings[id]) }, null, 2) + '\n');
    }
    writeLocal(root, 'tmp/verify-plan.json', JSON.stringify(plan, null, 2) + '\n');
    if (!Object.keys(plan.findings).length && !replies.some((r) => SEARCH_AGENTS.has(agentOf(r.file)))) {
      return 'plan: no search agent replies read in .keel/local/tmp/agents/: this is not a clean result. Check that the search agents ran and finished (keel\'s SubagentStop hook saves their replies), then run plan again';
    }
    const out = [`plan: ${Object.keys(plan.findings).length} findings; ${plan.launches.length} verifier launches of ${plan.cap} allowed`];
    for (const l of plan.launches) out.push(`${l.id}: ${l.model}, lens ${l.lens}, ${l.findings.join(', ')} (task: .keel/local/tmp/verify-tasks/${l.id}.json)`);
    if (plan.proven.length) out.push(`proven by QA (not verified): ${plan.proven.join(', ')}`);
    if (plan.minor.length) out.push(`minor (not verified): ${plan.minor.join(', ')}`);
    if (plan.unverified.length) out.push(`not verified: ${plan.unverified.map((u) => `${u.id} (${u.reason})`).join(', ')}`);
    if (plan.incomplete.length) out.push(`incomplete reports (turn cap): ${plan.incomplete.join(', ')}`);
    if (plan.invalid.length) out.push(`invalid (left out): ${plan.invalid.map(lost).join(' | ')}`);
    if (plan.repaired.length) out.push(`repaired (kept): ${plan.repaired.map(fixed).join(', ')}`);
    if (!Object.keys(plan.findings).length && !plan.invalid.length) out.push('no findings');
    return out.join('\n');
  }
  if (cmd === 'tally') {
    const plan = readJson(localDir(root, 'tmp', 'verify-plan.json'));
    if (!plan) throw new Error('no verify-plan.json: run "plan" first');
    const reruns = readJson(localDir(root, 'tmp', 'reproduce.json')) || {};
    const result = tally(plan, replies, reruns && typeof reruns === 'object' ? reruns : {});
    writeLocal(root, 'tmp/verify-result.json', JSON.stringify(result, null, 2) + '\n');
    const out = [`tally: ${result.confirmed.length} confirmed, ${result.refuted.length} refuted, ${result.unclear.length} unclear, ${result.proven.length} proven by QA, ${result.minor.length} minor, ${result.unverified.length} not verified`];
    for (const k of ['confirmed', 'unclear', 'proven']) for (const f of result[k]) out.push(`${k}: ${line(f)}${f.notes && f.notes.length ? ` (${f.notes.join(', ')})` : ''}`);
    for (const f of result.refuted) out.push(`refuted: ${line(f)}`);
    for (const u of result.unverified) out.push(`not verified: ${u.id} (${u.reason})`);
    if (result.invalid.length) out.push(`invalid (left out): ${result.invalid.map(lost).join(' | ')}`);
    if (result.repaired.length) out.push(`repaired (kept): ${result.repaired.map(fixed).join(', ')}`);
    out.push('details: .keel/local/tmp/verify-result.json');
    return out.join('\n');
  }
  throw new Error('usage: votes.js <projectDir> plan --tier <tier> | tally');
}

if (require.main === module) {
  let out;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `votes: error: ${e.message}`; }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { extractJson, makePlan, tally };
