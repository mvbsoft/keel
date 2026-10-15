'use strict';
// Step 1 of verification: what changed, which specialist groups it triggers, file sizes, and the
// proposed level with reasons and the agents of every level. Only reads the project (git and changed
// files; secret files by path only). Writes its full result to .keel/local/tmp/:
//   changes.json   everything below, for the session and later scripts
//   changes.diff   the unified diff agents read (secret files reduced to a note)
// Usage: node changes.js <projectDir> [--base <ref>] [--start] [--skip <path>]...
//   --base   verify a branch's whole work: diff against the merge base with <ref> (default: HEAD)
//   --start  begin a new verification run: clears the previous run's agent replies
//   --skip   an untracked file the user said is not part of the task (repeatable)
// Untracked files recorded at the task start (.keel/local/session-start.json, notes.js --begin) and
// unchanged since are left out and listed; without a record every untracked file counts.
const fs = require('node:fs');
const path = require('node:path');
const { collectChanges, baseLineCounts, splitLines, untrackedRecord } = require('./lib/diff.js');
const { analyze, lineup, isTest, isBulk, verifierCaps, TIERS } = require('./lib/tier.js');
const { fanIn } = require('./lib/fanin.js');
const { loadProject, writeLocal, parseArgs } = require('./lib/project.js');
const { safeLocalPath } = require('./lib/safe-path.js');
const { treeState, lastVerify } = require('./fingerprint.js');
const { onPath } = require('./lib/files.js');
const { programOf } = require('./lib/commands.js');

const MAX_READ = 1024 * 1024;

function currentLines(root, rel) {
  try {
    const full = path.join(root, rel);
    if (fs.statSync(full).size > MAX_READ) return null;
    const text = fs.readFileSync(full, 'utf8');
    return text.includes('\0') ? null : splitLines(text).length;
  } catch { return null; }
}

// Task files (.keel/tasks/) are keel's own progress notes and change with every handoff: not part of the code change.
const isTaskFile = (p) => p.startsWith('.keel/tasks/');

function startRun(root, base) {
  const dir = safeLocalPath(root, 'tmp', 'agents');
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) fs.rmSync(safeLocalPath(root, 'tmp', 'agents', f));
  for (const f of ['verify-plan.json', 'verify-result.json', 'context-map.md', 'reproduce.json']) fs.rmSync(safeLocalPath(root, 'tmp', f), { force: true });
  writeLocal(root, 'tmp/verify-run.json', JSON.stringify({ started: new Date().toISOString(), base: base || 'HEAD' }) + '\n');
}

// Configured security scanners whose program is not found (a path like ./gradlew is from the project folder).
function missingScanners(config, root) {
  return (config.gates.security_scanners || []).filter((s) => {
    const exe = programOf(s.command || s.name || '');
    return exe && !onPath(exe, root);
  }).map((s) => s.name || s.command);
}

function run(root, opts) {
  const { config, profile, isSecret } = loadProject(root);
  const base = typeof opts.base === 'string' ? opts.base : null;
  const change = collectChanges(root, { base, isSecret, before: untrackedRecord(root), skip: opts.skip || [], isBulk, ignore: isTaskFile });
  change.sizes = {};
  const sized = change.files.filter((f) => !(f.status === 'deleted' || f.secret || f.binary || isBulk(f.path)));
  const before = baseLineCounts(root, change.base.sha, sized.filter((f) => f.status !== 'added').map((f) => f.oldPath || f.path));
  for (const f of sized) {
    const now = f.status === 'added' && f.added.length ? f.added.length : currentLines(root, f.path);
    change.sizes[f.path] = { now, before: f.status === 'added' ? null : before[f.oldPath || f.path] };
  }
  // Fan-in of the files the change edits (new files have no dependents yet).
  const edited = change.files.filter((f) => (f.status === 'modified' || f.status === 'renamed') && !f.secret && !f.binary).map((f) => f.path);
  const fi = fanIn(root, edited, isTest);
  change.fan_in = fi.counts;
  const analysis = analyze(change, profile, config);
  const levels = Object.fromEntries(TIERS.map((t) => [t, lineup(t, analysis)]));
  const state = treeState(root, isSecret);
  const last = lastVerify(root, state);
  if (opts.start) startRun(root, base);

  const result = {
    base: change.base,
    files: change.files.map(({ path: p, oldPath, status, binary, secret, untracked, added, removed }) => ({ path: p, oldPath, status, binary, secret, ...(untracked ? { untracked } : {}), added: added.length, removed: removed.length })),
    ...analysis,
    untracked: change.untracked,
    levels,
    verifier_caps: verifierCaps(config),
    scanners_missing: missingScanners(config, root),
    fan_in_incomplete: fi.truncated ? fi.scanned : null,
    fingerprint: state.fingerprint,
    last_verify: last,
  };
  writeLocal(root, 'tmp/changes.json', JSON.stringify(result, null, 2) + '\n');
  writeLocal(root, 'tmp/changes.diff', change.diff);
  return summary(result);
}

const list = (paths) => `${paths.slice(0, 8).join('; ')}${paths.length > 8 ? `; +${paths.length - 8} more` : ''}`;

const overflowLine = (o) => `${o.count} untracked files not read (more than ${o.limit}); largest folders: ${o.folders.slice(0, 5).map((x) => `${x.dir} ${x.files}`).join('; ')} (ask the user which belong to the task; the rest belong in .gitignore)`;

function untrackedLines(r) {
  const u = r.untracked;
  const out = [];
  if (u.unchanged.length) out.push(`untracked before the task, not verified: ${list(u.unchanged)} (advise: commit them or add them to .gitignore)`);
  if (u.changed.length) out.push(`untracked before the task and changed since, verified whole: ${list(u.changed)}`);
  if (u.skipped.length) out.push(`untracked, left out on the user's word: ${list(u.skipped)}`);
  if (u.overflow) out.push(overflowLine(u.overflow));
  const counted = r.files.filter((f) => f.untracked).map((f) => f.path);
  if (!u.recorded && counted.length) out.push(`untracked with no task-start record, all counted as this change: ${list(counted)} (ask the user which belong to the task)`);
  return out;
}

function summary(r) {
  const out = [];
  const t = r.totals;
  out.push(`changes: ${t.files} files, +${t.added} -${t.removed} against ${r.base.label}`);
  if (!t.files) {
    if (r.untracked.overflow) out.push(overflowLine(r.untracked.overflow));
    out.push('proposal: none (nothing to verify)');
    return out.join('\n');
  }
  if (t.bulk_files) out.push(`${t.bulk_lines} lines in ${t.bulk_files} lock/generated/vendored file(s), not counted for the level`);
  const shown = r.files.slice(0, 12).map((f) => `${f.path}${f.status !== 'modified' ? ` (${f.status}${f.secret ? ', secret' : ''})` : f.secret ? ' (secret)' : ''} +${f.added} -${f.removed}`);
  out.push(`files: ${shown.join('; ')}${r.files.length > 12 ? `; +${r.files.length - 12} more` : ''}`);
  out.push(...untrackedLines(r));
  out.push(`modules: ${r.modules.join(', ') || '-'}`);
  const groups = Object.entries(r.groups).map(([g, v]) => `${g} [${v.topics.join(', ')}] because ${v.reasons.slice(0, 2).join('; ')}`);
  out.push(`groups: ${groups.join(' | ') || 'none'}`);
  if (r.sizes.length) out.push(`sizes: ${r.sizes.map((s) => `${s.path} ${s.lines} lines (${s.level}${s.before !== null ? `, ${s.grew >= 0 ? '+' : ''}${s.grew} in this change` : ', new'})`).join('; ')}`);
  const core = Object.entries(r.core || {}).sort((a, b) => b[1] - a[1]);
  if (core.length) out.push(`depended on by (non-test files importing it): ${core.slice(0, 5).map(([p, n]) => `${p} ${n}`).join('; ')}`);
  if (r.architect_signal.length) out.push(`architect signal: ${r.architect_signal.slice(0, 4).join('; ')}`);
  if (r.fan_in_incomplete !== null && r.fan_in_incomplete !== undefined) out.push(`fan-in incomplete (${r.fan_in_incomplete} files scanned): core code may be missed`);
  if (r.scanners_missing.length) out.push(`scanners: not installed: ${r.scanners_missing.join(', ')} (skip them; loud warning in the report)`);
  out.push(`proposal: ${r.proposal.tier} because ${r.proposal.reasons.join('; ')}`);
  for (const tier of TIERS) {
    const l = r.levels[tier];
    const agents = l.agents.map((a) => `${a.agent}${a.topics ? `[${a.topics.join(',')}]` : ''}:${a.model}`).join(' ');
    const caps = tier === 'gates-only' ? '' : `, verifiers up to ${r.verifier_caps[tier]}, judge ${l.judge}`;
    out.push(`${tier}: ${agents || 'no agents'}${caps} (estimate ${l.estimate})${l.notes.length ? `; note: ${l.notes.join('; ')}` : ''}`);
  }
  if (r.last_verify && r.last_verify.same) out.push(`last verify: ${r.last_verify.ts} (${r.last_verify.tier || 'unknown level'}) on this exact tree: nothing changed since`);
  out.push('details: .keel/local/tmp/changes.json; diff for agents: .keel/local/tmp/changes.diff');
  return out.join('\n');
}

if (require.main === module) {
  let out;
  try {
    const argv = process.argv.slice(2);
    const { opts, pos } = parseArgs(argv);
    opts.skip = argv.flatMap((a, i) => (a === '--skip' && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []));
    out = run(path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || '.'), opts);
  } catch (e) {
    out = `changes: unavailable (${e.message})`;
  }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { run, summary, missingScanners };
