'use strict';
// What changed in a project since configure last wrote its settings, and which configure sections that
// calls for. Configure step 12 records, per section it ran, what that section was based on
// (.keel/local/configure-snapshot.json); `/keel:configure check` compares the project with it.
// - A section that has no record yet compares with nothing: it was never set up on this machine.
// - Something counts as new only when neither the record nor the committed profile has it: the profile
//   holds what the user confirmed (a part added by hand) and what a teammate's later configure saw.
// - No record at all (a fresh clone): it is rebuilt from the commit of keel's settings files; without
//   that commit the profile is the only baseline and the checks that need a record are skipped.
// Each reason carries the fact and why it matters, so the model only has to put them in plain words.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { git } = require('./diff.js');
const { readJson, localDir, writeLocal } = require('./project.js');

const SNAPSHOT = 'configure-snapshot.json';
// The configure sections by number (configure-flow.md); a reason names one of them.
const SECTIONS = ['languages', 'scan', 'gates', 'git', 'verification', 'code', 'plugins', 'docs', 'migration', 'settings', 'usage', 'prices'];
// The sections whose basis is recorded; the others are checked live (git) or not at all.
const RECORDED = ['scan', 'gates', 'code', 'plugins', 'docs', 'migration', 'settings', 'usage'];
// Fewer files than this (a build script, one config) do not make a new language of the project.
const MIN_LANGUAGE_FILES = 5;
// The growth guard of configure section 8: a file Claude Code loads into every session.
const ALWAYS_LOADED_MAX = 200;
const TMP_PREFIX = 'keel-configure-';

const sorted = (list) => [...new Set(list)].sort();
const added = (before, now) => now.filter((x) => !before.includes(x));
const keelVersion = () => (readJson(path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json')) || {}).version || null;
const settingKeys = () => {
  const { KEYS } = require('../claude-settings.js');
  return sorted([...Object.keys(KEYS.user), ...Object.keys(KEYS.project)]);
};

// What the scan-based sections rest on, from a scan result. Only reads manifests.
function scanBasis(root, { profile, findings }) {
  const stackSkills = require('../stack-skills.js');
  const data = require('../../data/stack-skills.json');
  const stack = {
    languages: new Set(profile.languages.map((l) => l.name)),
    ecosystems: new Set(profile.parts.flatMap((p) => p.ecosystems)),
    packages: stackSkills.packagesOf(root, profile.parts.map((p) => p.path)),
  };
  return {
    scan: {
      monorepo: profile.monorepo_tool || null,
      parts: profile.parts.map((p) => ({ path: p.path, ecosystems: sorted(p.ecosystems) })),
      languages: sorted(profile.languages.filter((l) => l.files >= MIN_LANGUAGE_FILES).map((l) => l.name)),
      triggers: sorted(Object.values(profile.triggers).flat()),
      ai_rules: sorted(profile.ai_rules),
    },
    gates: { commands: Object.fromEntries(Object.entries(findings.command_candidates).map(([part, list]) => [part, sorted(list.map((c) => c.command))])) },
    plugins: {
      frameworks: sorted(data.frameworks.filter((f) => f.packages.some((p) => stack.packages.has(p) || stack.packages.has(p.toLowerCase()))).map((f) => f.name)),
      plugins: sorted(data.plugins.filter((p) => p.when && !p.when.always && stackSkills.matchesWhen(p.when, stack)).map((p) => p.plugin)),
    },
    docs: {
      always_loaded: findings.docs.always_loaded.map((f) => ({ path: f.path, lines: f.lines })),
      doc_dirs: sorted([...findings.docs.adr_dirs, ...findings.docs.spec_dirs]),
    },
    migration: { other_systems: sorted(findings.other_systems.map((o) => o.path)) },
  };
}

// The scan-based basis plus what git history and this machine say (code, settings, usage).
function fullBasis(root, scanResult, { machine = true } = {}) {
  const { ticketPrefixesSeen } = require('../comments.js');
  const basis = { ...scanBasis(root, scanResult), code: { ticket_prefixes: ticketPrefixesSeen(root).map((t) => t.prefix) } };
  if (machine) {
    basis.settings = { keys: settingKeys() };
    basis.usage = { configured: require('./usage-config.js').loadMachineConfig().configured };
  }
  return basis;
}

const validSections = (s) => s && typeof s === 'object' && Object.entries(s).every(([k, v]) => RECORDED.includes(k) && v && typeof v === 'object')
  && (!s.scan || (Array.isArray(s.scan.parts) && Array.isArray(s.scan.ai_rules) && Array.isArray(s.scan.languages) && Array.isArray(s.scan.triggers)))
  && (!s.gates || (s.gates.commands && typeof s.gates.commands === 'object'));

const readSnapshot = (root) => {
  const s = readJson(localDir(root, SNAPSHOT));
  return s && s.schema === 2 && validSections(s.sections) ? s : null;
};

// The section names a configure run passes (`--sections gates,git` or numbers), as recorded sections.
function sectionList(arg) {
  if (arg === undefined || arg === true) return RECORDED;
  return sorted(String(arg).split(/[\s,]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? SECTIONS[Number(x) - 1] : x)).filter((x) => RECORDED.includes(x)));
}

// Configure step 12: record the basis of the sections that ran, on top of the earlier record (or the
// one rebuilt from the last configure commit), so a section that did not run keeps its old basis.
function saveSnapshot(root, { scanResult, sections = RECORDED }) {
  const prev = ensureSnapshot(root);
  const now = fullBasis(root, scanResult);
  const merged = { ...(prev ? prev.sections : {}) };
  for (const s of sections) merged[s] = now[s];
  const snapshot = {
    schema: 2,
    saved_at: new Date().toISOString(),
    commit: (git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']) || '').trim() || null,
    keel_version: keelVersion(),
    sections: merged,
  };
  return writeLocal(root, SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
}

// Leftovers of a rebuild that was killed: their temp folders and git's worktree entries.
function clearLeftovers(root, gitRun) {
  const hourAgo = Date.now() - 3600 * 1000;
  for (const name of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX))) {
    const dir = path.join(os.tmpdir(), name);
    try { if (fs.statSync(dir).mtimeMs < hourAgo) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* in use or gone */ }
  }
  try { gitRun(['worktree', 'prune']); } catch { /* nothing to prune */ }
}

// No record on this machine: scan the project as it was at the commit of keel's settings files, in a
// temporary worktree (git hooks and LFS downloads off), and keep that as the record. It is what that
// configure saw, so the full comparison runs. A few seconds once on a large project; null when git
// cannot do it. This machine's settings and usage are not in it: another machine may have made it.
function rebuildSnapshot(root, commit) {
  const { execFileSync } = require('node:child_process');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  const tree = path.join(base, 'tree');
  const hooks = path.join(base, 'no-hooks');
  fs.mkdirSync(hooks);
  const run = (args) => execFileSync('git', ['-C', root, '-c', `core.hooksPath=${hooks}`, ...args], {
    stdio: 'ignore', timeout: 120000, env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
  });
  try {
    clearLeftovers(root, run);
    run(['worktree', 'add', '--quiet', '--detach', tree, commit]);
    const { scan } = require('../scan.js');
    const at = Number((git(root, ['log', '-1', '--format=%ct', commit]) || '').trim());
    const snapshot = {
      schema: 2,
      saved_at: new Date(at > 0 ? at * 1000 : Date.now()).toISOString(),
      commit,
      rebuilt: true,
      keel_version: null,
      sections: fullBasis(tree, scan(tree), { machine: false }),
    };
    writeLocal(root, SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
    return snapshot;
  } catch {
    return null;
  } finally {
    try { run(['worktree', 'remove', '--force', tree]); } catch { /* removed below */ }
    fs.rmSync(base, { recursive: true, force: true });
    try { run(['worktree', 'prune']); } catch { /* nothing to prune */ }
  }
}

// The last commit of keel's settings files: a configure, or a hand edit of them.
function settingsCommit(root) {
  const line = (git(root, ['log', '-1', '--format=%H %cs', '--', '.keel/config.json', '.keel/profile.json']) || '').trim();
  return line ? { commit: line.split(' ')[0], date: line.split(' ')[1] } : { commit: null, date: null };
}

// The record to compare with: the saved one, else one rebuilt from the settings files' commit.
function ensureSnapshot(root) {
  const saved = readSnapshot(root);
  if (saved) return saved;
  const { commit } = settingsCommit(root);
  return commit ? rebuildSnapshot(root, commit) : null;
}

// Commits since then that change the project itself (keel's own files do not count).
function commitsSince(root, commit) {
  if (!commit) return null;
  const n = Number((git(root, ['rev-list', '--count', `${commit}..HEAD`, '--', '.', ':(exclude).keel']) || '').trim());
  return Number.isFinite(n) ? n : null;
}

const fromProfile = (profile) => ({
  monorepo: profile.monorepo_tool || null,
  parts: (profile.parts || []).map((p) => ({ path: p.path, ecosystems: sorted(p.ecosystems || []) })),
  languages: sorted((profile.languages || []).map((l) => l.name)),
  triggers: sorted(Object.values(profile.triggers || {}).flat()),
  ai_rules: sorted(profile.ai_rules || []),
});

// The scan and gates reasons: they need no git and decide whether the profile is stale.
// ctx: { config, profile, snapshot, existedThen(rel), changedIn(dir), skipped[] }
function structureReasons(root, now, ctx) {
  const out = [];
  const add = (section, level, fact, why) => out.push({ section, level, fact, why });
  const { config, snapshot } = ctx;
  const rec = snapshot ? snapshot.sections : null;
  const prof = fromProfile(ctx.profile || {});
  const sb = rec && rec.scan;
  const existedThen = ctx.existedThen || (() => true);
  const changedIn = ctx.changedIn || (() => false);

  // 2 scan: new only when neither the record nor the profile has it.
  const knownParts = new Set([...prof.parts.map((p) => p.path), ...(sb ? sb.parts.map((p) => p.path) : [])]);
  const nowParts = new Map(now.scan.parts.map((p) => [p.path, p]));
  const newParts = new Set(now.scan.parts.filter((p) => !knownParts.has(p.path) && (sb || !existedThen(p.path))).map((p) => p.path));
  for (const p of now.scan.parts) {
    if (newParts.has(p.path)) { add('scan', 'needed', `new part ${p.path} (${p.ecosystems.join(', ') || 'no manifest'})`, 'keel does not know it yet: no gates and no review paths for it'); continue; }
    const before = (sb && sb.parts.find((x) => x.path === p.path)) || (!sb && (changedIn(p.path) || changedIn('.')) && prof.parts.find((x) => x.path === p.path));
    const inProfile = prof.parts.find((x) => x.path === p.path);
    if (before && before.ecosystems.join() !== p.ecosystems.join() && (!inProfile || inProfile.ecosystems.join() !== p.ecosystems.join())) {
      add('scan', 'needed', `part ${p.path}: ${before.ecosystems.join(', ') || 'no manifest'} -> ${p.ecosystems.join(', ') || 'no manifest'}`, 'its package manager or build tool changed, so its commands may have too');
    }
  }
  for (const p of prof.parts) {
    const gone = !nowParts.has(p.path) && (sb ? sb.parts.some((x) => x.path === p.path) : !fs.existsSync(path.join(root, p.path)));
    if (gone) add('scan', 'needed', `part ${p.path} is gone`, 'keel still expects it and runs its gates');
  }
  if (now.scan.monorepo !== prof.monorepo && (sb ? now.scan.monorepo !== sb.monorepo : changedIn('.'))) add('scan', 'needed', `monorepo tool: ${prof.monorepo || 'none'} -> ${now.scan.monorepo || 'none'}`, 'keel finds the parts of the project through it');
  const rules = now.scan.ai_rules.filter((r) => !prof.ai_rules.includes(r) && (sb ? !sb.ai_rules.includes(r) : !existedThen(r)));
  if (rules.length) add('scan', 'needed', `new AI instruction files: ${rules.join(', ')}`, 'keel reads the project rules from them; its profile lists the old set');
  const langs = now.scan.languages.filter((l) => !prof.languages.includes(l) && (!sb || !sb.languages.includes(l)));
  if (langs.length) add('scan', 'worth', `new language: ${langs.join(', ')}`, 'the review and the stack plugins were chosen without it');
  if (sb) {
    const paths = now.scan.triggers.filter((t) => !sb.triggers.includes(t) && !prof.triggers.includes(t));
    if (paths.length) add('scan', 'needed', `new paths that call for a specialist review: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? `, +${paths.length - 4} more` : ''}`, 'changes there would not get the data, API or environment review');
  } else ctx.skipped.push('review paths');

  // 3 gates
  const checks = (config.gates && config.gates.checks) || [];
  const gated = new Set(checks.map((c) => `${c.part}\0${c.command}`));
  const gb = rec ? (rec.gates || { commands: null }) : null;
  for (const [part, cmds] of Object.entries(now.gates.commands)) {
    if (newParts.has(part)) {
      if (cmds.length && !checks.some((c) => c.part === part)) add('gates', 'needed', `new part ${part} has no gates; found: ${cmds.slice(0, 3).join(', ')}`, 'its tests and checks would not run before a task is finished');
      continue;
    }
    if (!gb) continue;
    const where = part === '.' ? 'the project' : part;
    for (const c of cmds) {
      if (gated.has(`${part}\0${c}`)) continue;
      if (!gb.commands) add('gates', 'worth', `${where} has ${c}, which is not a gate`, 'it does not run before a task is finished (the gates were not chosen on this machine, so it may be left out on purpose)');
      else if (!(gb.commands[part] || []).includes(c)) add('gates', 'needed', `new command in ${where}: ${c}`, 'keel does not run it before a task is finished');
    }
  }
  if (gb && gb.commands) {
    for (const g of checks) {
      if ((gb.commands[g.part] || []).includes(g.command) && !(now.gates.commands[g.part] || []).includes(g.command)) add('gates', 'needed', `gate "${g.command}"${g.part === '.' ? '' : ` (${g.part})`}: the script or task behind it is gone`, 'the gate may fail or run nothing');
    }
  }
  if (!gb) ctx.skipped.push('new test, lint and type commands');
  return out;
}

// Whether the profile still fits: no needed scan or gates reason against the record. Used by the
// setup check of every keel command, so it never throws and never builds a record.
function profileFits(root, scanResult, { config, profile }) {
  try {
    const snapshot = readSnapshot(root);
    if (!snapshot) return false;
    return !structureReasons(root, scanBasis(root, scanResult), { config, profile, snapshot, skipped: [] }).some((r) => r.level === 'needed');
  } catch { return false; }
}

function liveReasons(root, now, ctx) {
  const out = [];
  const add = (section, level, fact, why) => out.push({ section, level, fact, why });
  const { config, snapshot } = ctx;
  const rec = snapshot ? snapshot.sections : null;

  // 4 git
  const main = config.git && config.git.main_branch;
  if (main && git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])) {
    const local = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${main}`]);
    const remote = (git(root, ['for-each-ref', '--format=%(refname)', 'refs/remotes/']) || '').split('\n').some((r) => r.split('/').slice(3).join('/') === main);
    if (!local && !remote) {
      const head = (git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']) || '').trim().replace(/^origin\//, '');
      add('git', 'needed', `main branch "${main}" is not in the repository${head ? `; the remote's default branch is "${head}"` : ''}`, 'keel starts each task from it and merges the work back into it');
    }
  }
  if (!rec) { ctx.skipped.push('ticket ids, new stack plugins, files loaded every session, new decision or spec folders, other notes systems'); return out; }

  // 6 code: ticket ids keel could keep out of comments
  const have = new Set((config.comments && config.comments.ticket_prefixes) || []);
  const seen = new Set(rec.code ? rec.code.ticket_prefixes : []);
  const tickets = now.code.ticket_prefixes.filter((t) => !have.has(t.prefix) && !seen.has(t.prefix));
  if (tickets.length) add('code', 'worth', `ticket ids in the git history: ${tickets.map((t) => `${t.prefix} (${t.ids} ids)`).join(', ')}`, 'keel can point out comments that refer to tickets, which may be renamed or deleted');

  // 7 plugins
  const pb = rec.plugins || { frameworks: [], plugins: [] };
  const chosen = new Set(config.stack_skills || []);
  const plugins = added(pb.plugins, now.plugins.plugins).filter((p) => !chosen.has(p));
  const frameworks = added(pb.frameworks, now.plugins.frameworks);
  if (plugins.length) add('plugins', 'worth', `${frameworks.length ? `new in the project: ${frameworks.join(', ')}; ` : ''}keel's checked list has plugins for what the project uses now: ${plugins.join(', ')}`, 'they give Claude the stack\'s own rules and checks');

  // 8 docs
  const db = rec.docs || { always_loaded: [], doc_dirs: [] };
  for (const f of now.docs.always_loaded) {
    if (f.lines <= ALWAYS_LOADED_MAX) continue;
    const b = db.always_loaded.find((x) => x.path === f.path);
    if (b && b.lines > ALWAYS_LOADED_MAX) continue;
    add('docs', 'worth', `${f.path} has ${f.lines} lines${b ? ` (${b.lines} at the last configure)` : ''}`, 'Claude Code loads it into every session, so every request pays for it');
  }
  const dirs = added(db.doc_dirs, now.docs.doc_dirs);
  if (dirs.length && ((config.docs && config.docs.profile) || 1) < 2) add('docs', 'worth', `new decision or spec folder: ${dirs.join(', ')}`, 'the documentation profile was chosen before it existed');

  // 9 migration
  const systems = added((rec.migration || { other_systems: [] }).other_systems, now.migration.other_systems);
  if (systems.length) add('migration', 'worth', `another notes or memory system: ${systems.join(', ')}`, 'configure can move it into keel, so notes live in one place');

  // 10 settings: never reviewed on this machine, or keys a newer keel recommends
  if (!rec.settings) {
    if (snapshot.rebuilt) ctx.skipped.push('Claude Code settings');
    else add('settings', 'worth', 'the Claude Code settings keel recommends were not reviewed on this machine', 'configure explains each one and changes nothing without your yes');
  } else {
    const keys = added(rec.settings.keys, now.settings.keys);
    if (keys.length) add('settings', 'worth', `keel ${keelVersion()} recommends settings your last configure did not have: ${keys.join(', ')}`, 'configure explains each one and changes nothing without your yes');
  }

  // 11 usage (this machine): never asked here, or gone since; a declined setup stays declined
  if (!now.usage.configured && (!rec.usage || rec.usage.configured)) add('usage', 'worth', rec.usage ? 'this machine\'s usage settings are gone' : 'this machine has no usage settings', 'the cost report at the end of a task and the usage page are off here');
  return out;
}

// The whole check for a configured project, as lines for the conversation.
function check(root, { scanResult, config, profile, snapshot }) {
  const { ticketPrefixesSeen } = require('../comments.js');
  const now = { ...scanBasis(root, scanResult), code: { ticket_prefixes: ticketPrefixesSeen(root) }, settings: { keys: settingKeys() }, usage: { configured: require('./usage-config.js').loadMachineConfig().configured } };
  const skipped = [];
  const ctx = { config, profile, snapshot, skipped };
  const sc = settingsCommit(root);
  if (!snapshot && sc.commit) {
    // Fallback: only what git shows as new since the settings commit counts.
    const gitLines = (args) => (git(root, ['-c', 'core.quotepath=false', ...args]) || '').split('\n').filter(Boolean);
    const changed = [...gitLines(['diff', '--name-only', '--relative', sc.commit]), ...gitLines(['ls-files', '--others', '--exclude-standard'])];
    ctx.existedThen = (rel) => gitLines(['ls-tree', '--name-only', sc.commit, '--', rel]).length > 0;
    ctx.changedIn = (dir) => changed.some((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.') === dir);
  } else if (!snapshot) {
    ctx.existedThen = () => true;
  }
  const order = (r) => SECTIONS.indexOf(r.section) * 2 + (r.level === 'needed' ? 0 : 1);
  const list = [...structureReasons(root, now, ctx), ...liveReasons(root, now, ctx)].sort((a, b) => order(a) - order(b));

  const commit = snapshot ? snapshot.commit : sc.commit;
  const date = snapshot ? snapshot.saved_at.slice(0, 10) : sc.date;
  const n = commitsSince(root, commit);
  const when = date ? ` on ${date}${n !== null ? `, ${n} commit${n === 1 ? '' : 's'} since` : ''}` : '';
  const ver = snapshot && snapshot.keel_version && snapshot.keel_version !== keelVersion() ? ` (configured with keel ${snapshot.keel_version}; now ${keelVersion()})` : '';
  const lines = [snapshot
    ? `config-check: compared with the last configure${when}${ver}${snapshot.rebuilt ? ' (rebuilt from its commit: no configure record on this machine)' : ''}`
    : `config-check: compared with .keel/profile.json${when} (no configure record on this machine)`];
  const sections = (level) => sorted(list.filter((r) => r.level === level).map((r) => r.section)).sort((a, b) => SECTIONS.indexOf(a) - SECTIONS.indexOf(b));
  const needed = sections('needed');
  const worth = sections('worth').filter((x) => !needed.includes(x));
  if (!list.length) lines.push('result: nothing to reconfigure');
  else lines.push(`result: needed ${needed.join(', ') || 'none'}; worth a look ${worth.join(', ') || 'none'}`);
  for (const r of list) lines.push(`- ${r.section} [${r.level}]: ${r.fact} | ${r.why}`);
  if (needed.length) lines.push(`run: /keel:configure ${needed.join(',')}`);
  if (worth.length) lines.push(`${needed.length ? 'also' : 'run'}: /keel:configure ${[...needed, ...worth].sort((a, b) => SECTIONS.indexOf(a) - SECTIONS.indexOf(b)).join(',')}`);
  if (skipped.length) lines.push(`not checked without a configure record on this machine: ${skipped.join(', ')}`);
  return lines;
}

module.exports = { SECTIONS, RECORDED, SNAPSHOT, scanBasis, readSnapshot, ensureSnapshot, saveSnapshot, sectionList, profileFits, check };
