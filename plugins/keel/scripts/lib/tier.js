'use strict';
// Turns a collected change into what step 1 of verification shows: modules, specialist groups and
// their topics, risk signals, file sizes, the proposed level with reasons, and the agent lineup of
// each level. Pure functions: no git, no file system.
const signals = require('../../data/change-signals.json');
const catalog = require('../../data/catalog.json');
const { matchesAny } = require('./patterns.js');

const TIERS = ['gates-only', 'basic', 'standard', 'maximum'];
// The word "quick" is understood as Basic.
const levelOf = (word) => (word === 'quick' ? 'basic' : word);
const GROUP_ORDER = ['security', 'data', 'env', 'docs'];
const GROUP_CAP = { standard: 4, maximum: 4 };
// Measured cost of one whole verification run at list prices (agents plus the main session's own
// work, Sonnet main session), on 8 test changes: gates only and Basic and Standard 3 runs each (gates
// $0.18-0.27, Basic $0.25-0.41, Standard $1.39-4.30), Maximum 1 run each ($2.72-7.60). The ledger
// report gives the real figure.
const ESTIMATE = { 'gates-only': '≈$0.2', basic: '≈$0.25-0.5', standard: '≈$1.4-4.3', maximum: '≈$2.7-7.6' };
// Thresholds added after schema 1: configs written before them use these.
const RULE_DEFAULTS = { core_fan_in: 5 };
const verifierCaps = (config) => ({ ...config.verification.verifier_caps });

const contentRe = Object.fromEntries(Object.entries(signals.content).map(([k, v]) => [k, v.patterns.map((p) => new RegExp(p, 'i'))]));
const commentFamily = new Map();
for (const fam of signals.comments.families) for (const ext of fam.extensions) commentFamily.set(ext, fam);
const migrationGlobs = catalog.database.migration_dirs.map((d) => `**/${d}/**`).concat(catalog.database.migration_dirs.map((d) => `${d}/**`));
const apiFiles = catalog.api;
// Manifests and lock files as globs (the catalog has *.csproj, *.gemspec, *.cabal and folder paths).
const manifestGlobs = catalog.ecosystems.flatMap((e) => [...(e.manifests || []), ...Object.keys(e.locks || {})]).map((f) => f.split('#')[0]).map((f) => (f.includes('/') ? `**/${f}` : f));
// Files whose line count says nothing about the size of the work: lock files, generated and vendored files.
const bulkGlobs = [...new Set(catalog.ecosystems.flatMap((e) => Object.keys(e.locks || {})))].concat(signals.bulk.generated, signals.bulk.vendored);

const ext = (p) => { const b = p.slice(p.lastIndexOf('/') + 1); return b.includes('.') ? b.slice(b.lastIndexOf('.') + 1).toLowerCase() : ''; };
const base = (p) => p.slice(p.lastIndexOf('/') + 1);
const isText = (p) => matchesAny(p, signals.text_files);
const isTest = (p) => matchesAny(p, signals.tests);
const isMigration = (p) => matchesAny(p, migrationGlobs);
const isBulk = (p) => matchesAny(p, bulkGlobs);

// A changed line changes behavior unless it is blank or a comment in a language we know.
function behaviorLine(file, line) {
  const t = line.trim();
  if (!t) return false;
  const fam = commentFamily.get(ext(file));
  if (!fam) return true;
  if (fam.not && fam.not.some((n) => t.startsWith(n))) return true;
  // The added space lets "* " match a lone "*" line of a block comment while "*p = 0;" stays code.
  return !fam.markers.some((m) => `${t} `.startsWith(m));
}

function changesBehavior(f) {
  if (f.secret || f.binary) return true;
  if (isText(f.path)) return false;
  if (f.status === 'added' || f.status === 'deleted' || f.status === 'renamed') return true;
  return [...f.added, ...f.removed].some((l) => behaviorLine(f.path, l));
}

// Module of a path: monorepo part + first folder below the usual source roots ('.' at the top level).
function moduleOf(p, partPaths) {
  const part = partPaths.filter((pp) => pp !== '.' && (p === pp || p.startsWith(`${pp}/`))).sort((a, b) => b.length - a.length)[0];
  const rest = (part ? p.slice(part.length + 1) : p).split('/').slice(0, -1);
  while (rest.length && signals.source_roots.includes(rest[0])) rest.shift();
  const mod = rest[0] || '.';
  return part ? `${part}:${mod}` : mod;
}

function addTopic(groups, group, topic, reason) {
  const g = groups[group] || (groups[group] = { topics: [], reasons: [] });
  if (topic && !g.topics.includes(topic)) g.topics.push(topic);
  if (reason && g.reasons.length < 5 && !g.reasons.includes(reason)) g.reasons.push(reason);
}

// change: { files } from collectChanges plus { sizes: { path: { now, before } } } and optionally
// { fan_in: { path: n } } (how many non-test project files import each changed file).
// profile: .keel/profile.json or null; config: .keel/config.json.
function analyze(change, profile, config) {
  const rules = { ...RULE_DEFAULTS, ...config.verification.tier_rules };
  const arch = config.architecture;
  const partPaths = profile ? profile.parts.map((p) => p.path) : ['.'];
  const triggers = profile ? profile.triggers : null;
  const files = change.files;

  let added = 0;
  let removed = 0;
  let bulkFiles = 0;
  let bulkLines = 0;
  const modules = new Set();
  const groups = {};
  const hits = { security: [], money: [], deletion: [], file_removal: [] };
  const securityPathFiles = new Set();
  const inSecurityPath = { security: [], money: [] };
  const migrations = [];
  const newFiles = [];
  const behavior = [];
  for (const f of files) {
    const p = f.path;
    const bulk = !f.secret && !f.binary && isBulk(p);
    if (bulk) { bulkFiles++; bulkLines += f.added.length + f.removed.length; } else { added += f.added.length; removed += f.removed.length; }
    if (changesBehavior(f)) behavior.push(p);
    if (!isText(p) && !f.secret && !bulk) modules.add(moduleOf(p, partPaths));
    if (f.status === 'added' && !f.secret && !bulk && !isText(p) && !isTest(p) && !isMigration(p)) newFiles.push(p);

    // Specialist groups by path (the project's own globs when configured).
    const inGroup = (g) => (triggers ? matchesAny(p, triggers[g]) : false);
    if (inGroup('security')) { securityPathFiles.add(p); addTopic(groups, 'security', null, `path ${p}`); }
    const migration = isMigration(p);
    const schema = !migration && (ext(p) === 'sql' || /(^|\/)(models?|entities|schema)\//.test(p) || base(p) === 'schema.prisma');
    const api = matchesAny(p, apiFiles) || /(^|\/)(routes?|controllers?|endpoints?|handlers?)\//.test(p);
    if (migration) { migrations.push(p); addTopic(groups, 'data', 'database', `migration ${p}`); }
    if (schema) addTopic(groups, 'data', 'database', `schema/model ${p}`);
    if (api) addTopic(groups, 'data', 'api', `API ${p}`);
    if (!migration && !schema && !api && inGroup('data')) addTopic(groups, 'data', 'database', `path ${p}`);
    if (isText(p) || p.startsWith('docs/') || inGroup('docs')) addTopic(groups, 'docs', 'docs', `doc ${p}`);
    if (matchesAny(p, manifestGlobs)) addTopic(groups, 'env', 'dependencies', `manifest ${p}`);
    else if (inGroup('env')) addTopic(groups, 'env', 'infrastructure', `config ${p}`);

    // Signals in added lines of code (not text or tests: a test naming an invoice handles no money).
    if (!f.secret && !bulk) {
      for (const [kind, res] of Object.entries(contentRe)) {
        if (isText(p) || isTest(p)) continue;
        const line = f.added.find((l) => res.some((re) => re.test(l)));
        if (line === undefined) continue;
        // Every security-path hit counts; only the examples listed are capped at three, so ordinary
        // files named first never hide a billing or auth file from the escalation.
        if (inSecurityPath[kind] && securityPathFiles.has(p)) inSecurityPath[kind].push(p);
        if (hits[kind].length < 3) hits[kind].push(`${p}: ${line.trim().slice(0, 80)}`);
      }
    }
  }
  if (hits.security.length) for (const h of hits.security) addTopic(groups, 'security', null, `code ${h}`);
  if (hits.file_removal.length) for (const h of hits.file_removal) addTopic(groups, 'security', null, `recursive file removal ${h}`);
  // A money word alone (price, amount) is ordinary code: listed in the signals; it calls the security
  // group and Maximum only in files the project's security globs match (below).
  if (groups.security) groups.security.topics = ['security', 'business-rules'];
  if (groups.data && (groups.data.topics.includes('database') || groups.data.topics.includes('api'))) addTopic(groups, 'data', 'performance');

  // File sizes against the architecture thresholds.
  const sizes = [];
  for (const [p, s] of Object.entries(change.sizes || {})) {
    if (s.now === null || s.now < arch.file_lines_warn) continue;
    sizes.push({ path: p, lines: s.now, before: s.before, level: s.now >= arch.file_lines_max ? 'over max' : 'over warn', grew: s.before === null ? s.now : s.now - s.before });
  }
  sizes.sort((a, b) => b.lines - a.lines);
  const archSignals = [...newFiles.slice(0, 5).map((p) => `new file ${p}`), ...sizes.map((s) => `${s.path} ${s.lines} lines (${s.level})`)];

  // Proposal; the user always chooses.
  const lines = added + removed;
  const reasons = [];
  let tier;
  if (!files.length) tier = 'none';
  else {
    const max = [];
    if (migrations.length) max.push(`database migration (${migrations[0]})`);
    if (hits.deletion.length) max.push(`data deletion (${hits.deletion[0]})`);
    // Deletion above escalates anywhere; money and security content signals only in files the project's
    // security globs also match.
    if (inSecurityPath.money.length) max.push(`money handling in business code (${inSecurityPath.money[0]})`);
    if (inSecurityPath.security.length) max.push(`authorization or access code (${inSecurityPath.security[0]})`);
    if (lines >= rules.very_large_change_lines) max.push(`very large change (${lines} lines, threshold ${rules.very_large_change_lines})`);
    // Core code: a behavior change in a file many others depend on (threshold core_fan_in).
    const core = Object.entries(change.fan_in || {}).filter(([p, n]) => n >= rules.core_fan_in && behavior.includes(p)).sort((a, b) => b[1] - a[1]);
    for (const [p, n] of core.slice(0, 3)) max.push(`core code: ${p}: ${n} files depend on it (threshold ${rules.core_fan_in})`);
    // Standard where measurement or risk asks for it: large, spread over modules, or security. On the
    // test set Basic's must or should list matched Standard's at about 1/7 of the price, so data, API
    // and dependency files alone do not raise the proposal; the reasons name them so the user can.
    const std = [];
    if (lines >= rules.large_change_lines) std.push(`large change (${lines} lines, threshold ${rules.large_change_lines})`);
    if (modules.size > rules.basic_max_modules) std.push(`${modules.size} modules (Basic covers ${rules.basic_max_modules})`);
    if (groups.security) std.push(`security group triggered${groups.security.reasons[0] ? ` (${groups.security.reasons[0]})` : ''}`);
    const specialists = ['data', 'env'].filter((g) => groups[g]).map((g) => `${g}${groups[g].reasons[0] ? ` (${groups[g].reasons[0]})` : ''}`);
    if (max.length) { tier = 'maximum'; reasons.push(...max); }
    else if (std.length) { tier = 'standard'; reasons.push(...std); }
    else if (files.length <= rules.gates_only_max_files && !behavior.length) { tier = 'gates-only'; reasons.push(`${files.length} file without behavior change (text, comments or docs); valid only if the gates are green`); }
    else {
      tier = 'basic';
      reasons.push(`ordinary change (${lines} lines) in ${modules.size || 1} module, no security trigger`);
      if (specialists.length) reasons.push(`touches ${specialists.join(', ')}: Standard would add specialist reviewers for it`);
    }
  }

  return {
    // added, removed and lines leave out lock, generated and vendored files (bulk_*): they do not size the work.
    totals: { files: files.length, added, removed, lines, bulk_files: bulkFiles, bulk_lines: bulkLines },
    modules: [...modules].sort(),
    behavior_files: behavior.length,
    groups,
    signals: hits,
    migrations,
    new_files: newFiles,
    sizes,
    architect_signal: archSignals,
    core: Object.fromEntries(Object.entries(change.fan_in || {}).filter(([, n]) => n > 0)),
    proposal: { tier, reasons },
  };
}

// Agents of a level. phase: '4' context map, '5a' parallel read-only,
// '5b' sequential code-running. Models are set here; the agent-model hook still applies allow_opus.
function lineup(tier, analysis) {
  tier = levelOf(tier);
  if (tier === 'none' || tier === 'gates-only') return { agents: [], judge: null, verifier_models: null, notes: [], estimate: ESTIMATE['gates-only'] };
  // Basic: one generalist reviewer, its must/should checked by Sonnet verifiers (cap verifier_caps.basic),
  // merged by the session. The reviewer runs on Haiku: on the 8 test changes (3 runs each) Basic found
  // 15.3 of 17 defects, 15.0 in its must/should list (as many as Standard), with no false alarm there.
  if (tier === 'basic') return { agents: [{ agent: 'reviewer', model: 'haiku', phase: '5a' }], judge: 'session', verifier_models: { default: 'sonnet' }, notes: [], estimate: ESTIMATE.basic };
  const notes = [];
  const agents = [];
  const add = (agent, model, phase, extra = {}) => agents.push({ agent, model, phase, ...extra });
  add('context', 'haiku', '4');
  // The generalist reviewer looks wider than the bug hunter. Maximum has two Opus bug hunters and found
  // 17 of 17 without it.
  if (tier !== 'maximum') add('reviewer', 'sonnet', '5a');
  add('bug-hunter', tier === 'maximum' ? 'opus' : 'sonnet', '5a', tier === 'maximum' ? { focus: 'the changed lines only' } : {});
  if (tier === 'maximum') add('bug-hunter', 'opus', '5a', { focus: 'the change in the context of the whole project' });
  if (tier === 'standard') add('architect', analysis.architect_signal.length ? 'opus' : 'sonnet', '5a');
  if (tier === 'maximum') add('architect', 'opus', '5a');

  // Standard and Maximum: the docs group also reviews the comments of changed code (topic comments).
  const groups = { ...analysis.groups };
  if (analysis.behavior_files) {
    groups.docs = { topics: [...new Set([...((groups.docs && groups.docs.topics) || []), 'comments'])] };
  }
  let names = GROUP_ORDER.filter((g) => groups[g]);
  if (tier === 'maximum' && !names.includes('security')) names = ['security', ...names];
  if (names.length > GROUP_CAP[tier]) {
    notes.push(`${names.length} specialist groups triggered; ${tier} runs ${GROUP_CAP[tier]}: ${names.slice(GROUP_CAP[tier]).join(', ')} left out`);
    names = names.slice(0, GROUP_CAP[tier]);
  }
  for (const g of names) {
    const topics = (groups[g] && groups[g].topics) || ['security', 'business-rules'];
    add(g, g === 'security' ? 'opus' : 'sonnet', '5a', { topics });
  }
  add('qa', tier === 'maximum' ? 'opus' : 'sonnet', '5b', tier === 'maximum' ? {} : { also: 'tries to break the change' });
  if (tier === 'maximum') add('qa-break', 'sonnet', '5b');
  add('test-reviewer', 'sonnet', '5b');

  const verifierModels = tier === 'standard' ? { default: 'sonnet', 'bug-hunter': 'opus', security: 'opus' } : { default: 'opus' };
  return {
    agents,
    judge: tier === 'standard' ? 'sonnet' : 'opus',
    verifier_models: verifierModels,
    notes,
    estimate: ESTIMATE[tier],
  };
}

module.exports = { analyze, lineup, levelOf, moduleOf, changesBehavior, isTest, isBulk, verifierCaps, TIERS, ESTIMATE };
