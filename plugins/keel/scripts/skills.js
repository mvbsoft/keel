'use strict';
// configure sections 11 (plugins) and 12 (skills): what fits this project and what is installed.
// Installs no plugin (Claude Code refuses plugin installs that Claude runs; the user runs the printed
// commands) and changes nothing without a command for it. Only reads manifests, never secret files.
// Words for a web search come only from data/skill-needs.json, never from the project.
// Usage: node skills.js <project> inventory [--available <file>] [--installed <file>] [--home <dir>] [--picked <id,id>]
//        node skills.js <project> evidence --candidates <file> [--responses <file>] [--available <file>]
//        node skills.js <project> install <candidate n> [--scope project|user] [--license-ok] [--responses <file>]
//        node skills.js <project> disable <plugin id | user skill name> [--installed <file>] [--home <dir>]
//        node skills.js <project> remember <id> --ref <commit|version> --decision installed|declined
//        node skills.js <project> --lsp <command>   (is that language server on PATH now?)
//   --available  `claude plugin list --json --available` saved to a file; by default the script runs it
//   --installed  `claude plugin list --json` saved to a file; by default the installed list of --available
//   --home       the folder that holds .claude/ instead of the user's home (tests)
//   --responses  recorded GitHub answers (URL → { status, body }); no network then (tests)
//   --today      YYYY-MM-DD instead of today, for the 12-month rule (tests)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scan } = require('./scan.js');
const { onPath } = require('./lib/files.js');
const { parseArgs, writeLocal, readJson, localDir } = require('./lib/project.js');
const { readJsonFile } = require('./lib/json.js');
const { stackOf, projectFiles, whyMatch, matchesWhen } = require('./lib/skills-stack.js');
const local = require('./lib/skills-local.js');
const { printable } = require('./lib/skills-front.js');
const { parseCandidate } = require('./lib/skills-github.js');
const { configHome, settingsHome } = require('./lib/project-dir.js');
const { linkOnWay } = require('./lib/safe-path.js');
const data = require('../data/stack-skills.json');
const needsData = require('../data/skill-needs.json');
const ownersData = require('../data/skill-owners.json');

const SEARCH_LIMIT = 5;
const MAX_NEEDS = 6;
const DESCRIPTION_SHOWN = 200;
const ANTHROPIC_MARKETS = { 'claude-plugins-official': 'official', 'claude-community': 'community' };
const MARKET_REPOS = { official: 'anthropics/claude-plugins-official', community: 'anthropics/claude-plugins-community' };
const PLUGIN_ID = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Run in the project folder: from elsewhere claude reports the project's plugins as off and its
// marketplaces as not added.
const claudeJson = (args, root) => require('node:child_process').execFileSync('claude', ['plugin', 'list', '--json', ...args], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
const firstLine = (e) => String(e.message || e).split('\n')[0];

function listAvailable(opts, root) {
  try {
    const j = JSON.parse(typeof opts.available === 'string' ? fs.readFileSync(opts.available, 'utf8') : claudeJson(['--available'], root));
    return { available: j.available || [], installed: j.installed || [], error: null };
  } catch (e) {
    return { available: [], installed: null, error: `could not list the marketplaces (${firstLine(e)})` };
  }
}

// `claude plugin list --json` is an array; --available wraps it as `installed`.
function listInstalled(opts, list, root) {
  try {
    if (typeof opts.installed === 'string') { const j = readJsonFile(opts.installed); return Array.isArray(j) ? j : j.installed || []; }
    if (list.installed) return list.installed;
    const j = JSON.parse(claudeJson([], root));
    return Array.isArray(j) ? j : j.installed || [];
  } catch { return []; }
}

// owner/repo/path of each plugin in Anthropic's two marketplaces, for the "Anthropic official" fact.
function marketRepos(available, error) {
  if (error) return null;
  const out = { official: [], community: [] };
  for (const a of available) {
    const kind = ANTHROPIC_MARKETS[a.marketplaceName];
    if (!kind) continue;
    const s = a.source;
    let id = null;
    if (typeof s === 'string') id = `${MARKET_REPOS[kind]}/${s.replace(/^\.\//, '')}`;
    else if (s && typeof s === 'object') {
      const m = typeof s.url === 'string' ? /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(s.url) : null;
      const repo = typeof s.repo === 'string' ? s.repo : m && m[1];
      if (repo) id = s.path ? `${repo}/${String(s.path).replace(/^\.?\//, '')}` : repo;
    }
    if (id) out[kind].push(id.toLowerCase().replace(/\/+$/, ''));
  }
  return out;
}

// Decisions not to offer again: the project's (config `skills`) and this machine's (.keel/local).
function readChoices(root) {
  const out = {};
  const cfg = readJson(path.join(configHome(root), '.keel', 'config.json'));
  if (cfg && cfg.skills && typeof cfg.skills === 'object') Object.assign(out, cfg.skills);
  const mine = readJson(localDir(root, 'skills-choices.json'));
  if (mine && mine.choices && typeof mine.choices === 'object') Object.assign(out, mine.choices);
  return out;
}

const marketOf = (id) => id.slice(id.indexOf('@') + 1);
// Why keel never proposes a change to a plugin, or null: keel's own, Anthropic's, managed, synced.
const untouchableWhy = (p) => (p.id.startsWith('keel@') ? "keel's own plugin" : ANTHROPIC_MARKETS[marketOf(p.id)] ? "from Anthropic's marketplace"
  : p.scope === 'managed' ? 'managed' : p.scope === 'synced' ? 'synced from claude.ai' : null);
const suggestions = () => data.marketplaces.flatMap((m) => m.suggest.map((s) => ({ ...s, plugin: `${s.plugin}@${m.name}` })));

// The action for an installed plugin by the rules of the skills design (keep, replace, disable here,
// remove, not evaluated); keel's own, Anthropic's and managed plugins never get one.
function pluginAction(p, stack) {
  const entry = data.plugins.find((x) => x.plugin === p.id) || suggestions().find((x) => x.plugin === p.id);
  const needs = needsData.needs.filter((n) => (n.known || []).includes(p.id));
  const signal = (entry && whyMatch(entry.when, stack)) || needs.map((n) => whyMatch(n.when, stack)).find(Boolean) || null;
  const untouchable = untouchableWhy(p);
  if (untouchable) return signal ? { action: 'keep', reason: `signal: ${signal}` } : { action: 'no action', reason: untouchable };
  if (!entry && !needs.length) return { action: 'not evaluated', reason: "not in keel's lists" };
  if (signal && entry && entry.replaced_by) return { action: `replace with ${entry.replaced_by}`, reason: "keel's checked list names a replacement" };
  if (signal) return { action: 'keep', reason: `signal: ${signal}` };
  if (!p.enabled_here) return { action: 'no action', reason: 'off in this project already' };
  if (p.scope === 'project') return { action: 'remove', reason: 'no signal in this project' };
  return { action: 'disable here', reason: 'no signal in this project' };
}

// owner/repo/path of a skill's source.json, or null.
const sourceId = (src) => (src && typeof src.repo === 'string' ? `${src.repo.replace(/^https:\/\/github\.com\//, '')}${src.path ? `/${src.path}` : ''}` : null);

// The needs a standalone skill serves: listed in `known` by name or source id, or the need it was
// installed for (source.json).
function skillNeeds(s) {
  const id = sourceId(s.source);
  return needsData.needs.filter((n) => (n.known || []).includes(s.name) || (id && (n.known || []).includes(id)) || (s.source && s.source.need === n.id));
}

function skillAction(s, place, stack, settings) {
  if (place === 'project' && !s.fm.ok) return { action: 'remove', reason: `front matter broken (${s.fm.problem})` };
  const needs = skillNeeds(s);
  if (!needs.length) return { action: 'not evaluated', reason: "not in keel's lists" };
  const signal = needs.map((n) => whyMatch(n.when, stack)).find(Boolean);
  if (signal) return { action: 'keep', reason: `signal: ${signal}` };
  if (place === 'project') return { action: 'remove', reason: 'no signal in this project' };
  if (settings.skillOverrides[s.name] === 'off') return { action: 'no action', reason: 'off in this project already' };
  return { action: 'disable here', reason: 'no signal in this project' };
}

const sourceLine = (s) => (s.source ? `${sourceId(s.source)} @ ${String(s.source.commit || '').slice(0, 7) || 'unknown commit'}` : 'source unknown');

// The old stack plugins report: keel's checked list, marketplaces to add, name matches in the user's
// marketplaces (not the excluded ones) and frameworks with nothing reliable.
function pluginCandidates(stack, list, installedIds, choices) {
  const frameworks = data.frameworks.filter((f) => f.packages.some((p) => stack.packages.has(p) || stack.packages.has(p.toLowerCase()))).map((f) => f.name);
  const excluded = new Set(data.excluded_marketplaces);
  const allowed = list.available.filter((p) => !excluded.has(p.marketplaceName));
  const marketplaces = new Set(list.available.map((p) => p.marketplaceName));
  const versionOf = (id) => { const a = list.available.find((x) => x.pluginId === id); return a ? a.version || (a.source && (a.source.sha || a.source.ref)) || null : null; };
  const declined = (id) => { const c = choices[id]; return !!(c && c.decision === 'declined' && c.ref && c.ref === versionOf(id)); };
  const version = (id) => printable(versionOf(id), 80) || null;
  const checked = data.plugins.filter((p) => matchesWhen(p.when, stack)).map((p) => ({
    ...p,
    installed: installedIds.has(p.plugin),
    in_marketplace: !list.error ? allowed.some((a) => a.pluginId === p.plugin) : null,
    needs_on_path: p.needs && p.needs.command ? onPath(p.needs.command) : null,
    declined: declined(p.plugin),
    version: version(p.plugin),
  }));
  const toAdd = data.marketplaces.filter((m) => !marketplaces.has(m.name)).map((m) => ({ ...m, suggest: m.suggest.filter((s) => matchesWhen(s.when, stack)) })).filter((m) => m.suggest.length);
  const added = data.marketplaces.filter((m) => marketplaces.has(m.name)).flatMap((m) => m.suggest.filter((s) => matchesWhen(s.when, stack)).map((s) => ({ plugin: `${s.plugin}@${m.name}`, what: s.what, author: m.author, installed: installedIds.has(`${s.plugin}@${m.name}`), declined: declined(`${s.plugin}@${m.name}`), version: version(`${s.plugin}@${m.name}`) })));
  const known = new Set([...checked.map((c) => c.plugin), ...added.map((a) => a.plugin)]);
  const found = {};
  for (const term of [...frameworks, ...stack.languages]) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
    // by name only: descriptions mention frameworks in passing ("React UI", "PHP hosting")
    const hits = allowed.filter((p) => !known.has(p.pluginId) && !declined(p.pluginId) && re.test(p.name))
      .sort((a, b) => (b.installCount || 0) - (a.installCount || 0)).slice(0, SEARCH_LIMIT);
    if (hits.length) found[term] = hits.map((p) => ({ plugin: p.pluginId, marketplace: p.marketplaceName, description: p.description || '', installed: installedIds.has(p.pluginId), version: version(p.pluginId) }));
  }
  const coveredFrameworks = new Set([...checked.flatMap((c) => data.frameworks.filter((f) => (c.when.packages || []).some((p) => f.packages.includes(p))).map((f) => f.name)), ...Object.keys(found)]);
  return { frameworks, checked, marketplaces_to_add: toAdd, from_added_marketplaces: added, found, nothing_reliable: frameworks.filter((f) => !coveredFrameworks.has(f)) };
}

function inventory(root, opts) {
  const { profile } = scan(root);
  const stack = stackOf(root, profile, projectFiles(root));
  const home = typeof opts.home === 'string' ? path.resolve(opts.home) : os.homedir();
  const list = listAvailable(opts, root);
  const settings = local.settingsHere(root, home);
  const choices = readChoices(root);
  const picked = typeof opts.picked === 'string' ? opts.picked.split(',').map((x) => x.trim()).filter(Boolean) : [];

  const plugins = local.pluginsHere(listInstalled(opts, list, root), root).map((e) => {
    const p = { id: e.id, scope: e.scope, version: printable(e.version, 80) || null, installPath: e.installPath, enabled_here: e.enabled !== false && settings.enabledPlugins[e.id] !== false };
    return { ...p, risks: local.pluginRisks(e).flags, ...pluginAction(p, stack) };
  });
  const project = local.skillsIn(path.join(root, '.claude', 'skills'));
  const user = local.skillsIn(path.join(home, '.claude', 'skills'));
  const synced = local.syncedSkills(home);
  const skills = [...project.map((s) => ({ s, place: 'project' })), ...user.map((s) => ({ s, place: 'user' }))].map(({ s, place }) => ({
    name: s.name, place, front_matter: s.fm.ok ? 'ok' : `broken (${s.fm.problem})`, description: s.description,
    source: s.source, source_line: sourceLine(s), risks: s.risks.flags, ...skillAction(s, place, stack, settings),
  }));

  const enabled = new Set(plugins.filter((p) => p.enabled_here).map((p) => p.id));
  const skillIds = new Set(skills.flatMap((s) => [s.name, sourceId(s.source)]).filter(Boolean));
  const needs = needsData.needs.map((n) => ({ n, why: whyMatch(n.when, stack) })).filter((x) => x.why)
    .sort((a, b) => a.n.priority - b.n.priority || a.n.id.localeCompare(b.n.id))
    .map(({ n, why }) => {
      const by = n.covered_by ? `keel:${n.covered_by}`
        : (n.known || []).find((k) => enabled.has(k) || picked.includes(k) || skillIds.has(k)) || null;
      // A need served only by a skill keel installed (its source is known) is still searched: evidence
      // checks that skill on GitHub and keeps it as the cover unless it is archived or stale.
      // A source keel cannot read (not a GitHub repository) keeps covering the need, unchecked.
      const own = by ? null : skills.find((s) => s.source && s.source.need === n.id);
      const checkable = !!own && !parseCandidate({ repo: own.source.repo, path: own.source.path || '' }).error;
      return { id: n.id, kind: n.kind, search: n.search, signal: why, covered_by: by || (own ? own.name : null), replacement_check: checkable };
    });
  const searched = (n) => !n.covered_by || n.replacement_check;
  const toSearch = needs.filter(searched).slice(0, MAX_NEEDS);
  const listed = local.listing({ plugins, settings, project, user, synced });
  const candidates = pluginCandidates(stack, list, new Set(plugins.map((p) => p.id)), choices);
  return {
    stack: {
      languages: [...stack.languages],
      frameworks: candidates.frameworks,
      databases: needs.filter((n) => n.kind === 'database' && n.id !== 'migrations').map((n) => n.search),
      parts: profile.parts.map((p) => p.path),
    },
    listing: listed,
    marketplaces_error: list.error,
    marketplace_repos: marketRepos(list.available, list.error),
    installed_plugins: plugins.map(({ installPath, ...p }) => p),
    installed_skills: skills,
    synced_skills: synced.length,
    ...candidates,
    needs,
    search: toSearch.map((n) => ({ need: n.id, words: n.search, replacement_check: n.replacement_check })),
    more_needs: needs.filter(searched).length - toSearch.length,
  };
}

const ver = (v) => `version ${v || 'unknown'}`;

function inventoryReport(r) {
  const s = r.stack;
  const out = [`stack: languages ${s.languages.join(', ') || 'none'}; frameworks ${s.frameworks.join(', ') || 'none detected'}; databases ${s.databases.join(', ') || 'none detected'}${s.parts.length > 1 ? `; parts ${s.parts.join(', ')}` : ''}`];
  out.push(`listing: ${r.listing.skills} skills, ${r.listing.characters} characters of descriptions; budget about ${r.listing.budget} characters (1% of the context window)`);
  if (r.marketplaces_error) out.push(`marketplaces: ${r.marketplaces_error}; only keel's checked list below`);
  out.push(r.installed_plugins.length ? 'installed plugins:' : 'installed plugins: none');
  for (const p of r.installed_plugins) out.push(`- ${printable(p.id, 120)} [${printable(p.scope, 20)}, ${p.enabled_here ? 'enabled' : 'off here'}] ${p.action}: ${p.reason} | ${ver(p.version)} | risks: ${p.risks.join(', ') || 'none'}`);
  out.push('plugin candidates:');
  const install = (id) => `claude plugin install ${id} --scope project`;
  const state = (c) => (c.installed ? 'installed already' : c.declined ? 'declined before at this version' : c.in_marketplace === false ? 'its marketplace is not added' : `install: ${install(c.plugin)}`);
  out.push('checked by keel:');
  for (const c of r.checked) {
    const needs = c.needs && c.needs.command ? ` | needs ${c.needs.command}: ${c.needs_on_path ? 'on PATH' : `not installed (${c.needs.install})`}` : '';
    out.push(`- ${c.plugin} [${c.kind}, ${c.author}] ${c.what} | ${state(c)} | ${ver(c.version)}${needs}${c.needs && c.needs.note ? ` | note: ${c.needs.note}` : ''}`);
  }
  for (const a of r.from_added_marketplaces) out.push(`- ${a.plugin} [${a.author}] ${a.what} | ${state(a)} | ${ver(a.version)}`);
  for (const m of r.marketplaces_to_add) out.push(`marketplace not added: ${m.name} [${m.author}] ${m.what} add: ${m.add}; then: ${m.suggest.map((x) => `${x.plugin} (${x.what})`).join('; ')}`);
  const terms = Object.keys(r.found);
  if (terms.length) {
    out.push('found in your marketplaces (not checked by keel):');
    for (const t of terms) for (const f of r.found[t]) out.push(`- ${t}: ${printable(f.plugin, 120)}: ${printable(f.description, 140)}${f.installed ? ' | installed already' : ''} | ${ver(f.version)}`);
  }
  if (r.nothing_reliable.length) out.push(`nothing reliable found for: ${r.nothing_reliable.join(', ')}`);
  out.push(r.installed_skills.length || r.synced_skills ? 'installed skills:' : 'installed skills: none');
  for (const k of r.installed_skills) out.push(`- ${printable(k.name, 80)} [${k.place}] ${k.action}: ${printable(k.reason, 300)} | ${printable(k.source_line, 200)} | front matter ${printable(k.front_matter, 200)} | risks: ${k.risks.join(', ') || 'none'} | what: ${printable(k.description, DESCRIPTION_SHOWN) || 'no description'}`);
  if (r.synced_skills) out.push(`- synced from claude.ai: ${r.synced_skills} skills [user] no action: managed in your claude.ai account`);
  out.push(r.needs.length ? 'needs:' : 'needs: none');
  for (const n of r.needs.filter((x) => x.covered_by || r.search.some((q) => q.need === x.id))) out.push(`- ${n.id}: ${n.search} | ${n.replacement_check ? `covered by ${printable(n.covered_by, 80)}, source known: checked for a replacement` : n.covered_by ? `covered by ${printable(n.covered_by, 120)}` : 'to search'} | signal: ${n.signal}`);
  if (r.more_needs > 0) out.push(`- ${r.more_needs} more not searched (at most ${MAX_NEEDS} at a time)`);
  if (!r.search.length) out.push('search: nothing');
  // The note never names the installed skill: only keel's own words go to a search.
  for (const q of r.search) out.push(`search: ${q.need}: ${q.words}${q.replacement_check ? ' (replacement check)' : ''}`);
  return out.join('\n');
}

// Reads the scout's candidates (evidence cuts them to 3 per need and 30 in all).
function readCandidates(file) {
  const j = readJsonFile(file);
  const list = Array.isArray(j) ? j : j && Array.isArray(j.candidates) ? j.candidates : null;
  if (!list) throw new Error(`${file} holds no "candidates" list`);
  return list;
}

async function runEvidence(root, opts) {
  if (typeof opts.candidates !== 'string') throw new Error('evidence needs --candidates <file>');
  const { makeFetcher } = require('./lib/skills-github.js');
  const { evidence, evidenceReport } = require('./lib/skills-evidence.js');
  const inv = readJson(localDir(root, 'tmp', 'skills-inventory.json')) || {};
  const markets = typeof opts.available === 'string' ? (() => { const l = listAvailable(opts, root); return marketRepos(l.available, l.error); })() : inv.marketplace_repos || null;
  const covered = Object.fromEntries((inv.needs || []).filter((n) => n.covered_by && !n.replacement_check).map((n) => [n.id, n.covered_by]));
  const ctx = {
    owners: new Set(ownersData.owners.map((o) => o.owner.toLowerCase())),
    markets, covered, choices: readChoices(root),
    today: typeof opts.today === 'string' ? Date.parse(opts.today) : Date.now(),
  };
  const f = makeFetcher(typeof opts.responses === 'string' ? readJsonFile(opts.responses) : null);
  const r = await evidence(f, readCandidates(opts.candidates), (inv.installed_skills || []).filter((s) => s.source), ctx);
  const file = writeLocal(root, 'tmp/skills-evidence.json', `${JSON.stringify(r, null, 2)}\n`);
  return `${evidenceReport(r)}\nfull result: ${file}\n`;
}

async function runInstall(root, n, opts) {
  const { makeFetcher } = require('./lib/skills-github.js');
  const { install } = require('./lib/skills-evidence.js');
  const ev = readJson(localDir(root, 'tmp', 'skills-evidence.json'));
  if (!ev || !Array.isArray(ev.candidates)) throw new Error('no evidence yet: run evidence first');
  const e = ev.candidates.find((c) => String(c.n) === String(n));
  if (!e) throw new Error(`no candidate ${n} in the evidence`);
  const scope = opts.scope === undefined ? 'project' : opts.scope;
  if (scope !== 'project' && scope !== 'user') throw new Error('--scope is project or user');
  const home = typeof opts.home === 'string' ? path.resolve(opts.home) : os.homedir();
  const linkRoot = scope === 'user' ? home : root;
  const f = makeFetcher(typeof opts.responses === 'string' ? readJsonFile(opts.responses) : null);
  const r = await install(f, e, path.join(linkRoot, '.claude', 'skills'), { licenseOk: opts['license-ok'] === true, linkRoot });
  const out = [`installed: ${r.target}`, ...r.written.map((w) => `written: ${w}`)];
  if (r.code.length) out.push(`has code: ${r.code.join(', ')}`);
  return `${out.join('\n')}\n`;
}

// Turns a plugin (id with @) or a user skill (name) off in this project only, in its personal
// .claude/settings.local.json; every other key is kept.
// Refuses keel's own, Anthropic's, managed and synced plugins, a plugin not installed for this project,
// a skill that is not in ~/.claude/skills, and a setting that is there but not an object.
function disable(root, id, opts = {}) {
  const plugin = PLUGIN_ID.test(id || '');
  if (!plugin && !SKILL_NAME.test(id || '')) throw new Error('disable takes a plugin id (<plugin>@<marketplace>) or a skill name');
  if (plugin) {
    const entry = local.pluginsHere(listInstalled(opts, { installed: null }, root), root).find((e) => e.id === id);
    const never = untouchableWhy({ id, scope: entry ? entry.scope : null });
    if (never) throw new Error(`${id} is ${never}: keel does not turn it off`);
    if (!entry) throw new Error(`${id} is not installed for this project`);
  } else {
    const home = typeof opts.home === 'string' ? path.resolve(opts.home) : os.homedir();
    const base = path.join(home, '.claude', 'skills');
    if (!fs.existsSync(path.join(base, id, 'SKILL.md'))) throw new Error(`no skill ${id} in ${base}`);
  }
  const dir = settingsHome(root);
  const file = path.join(dir, '.claude', 'settings.local.json');
  const why = linkOnWay(dir, file);
  if (why) throw new Error(`${why}: keel does not write through it`);
  let s = {};
  if (fs.existsSync(file)) {
    try { s = readJsonFile(file); } catch (e) { throw new Error(`${file} is not valid JSON (${firstLine(e)}); fix it first`); }
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`${file} is not a JSON object`);
  }
  const key = plugin ? 'enabledPlugins' : 'skillOverrides';
  if (s[key] !== undefined && (!s[key] || typeof s[key] !== 'object' || Array.isArray(s[key]))) throw new Error(`${key} in ${file} is not an object; fix it first`);
  s[key] = { ...(s[key] || {}), [id]: plugin ? false : 'off' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
  return `disabled here: ${id} (${key})\nfile: ${file}\n`;
}

function remember(root, id, opts) {
  if (typeof id !== 'string' || !id || id.length > 300 || /[\0-\x1f]/.test(id)) throw new Error('remember needs an id');
  // An unknown version would hide the item for good: it is offered again instead.
  if (typeof opts.ref !== 'string' || !opts.ref.trim() || opts.ref.trim().toLowerCase() === 'unknown') throw new Error('no version to remember: it will be offered again next time');
  if (!['installed', 'declined'].includes(opts.decision)) throw new Error('--decision is installed or declined');
  const file = localDir(root, 'skills-choices.json');
  const cur = readJson(file);
  const choices = cur && cur.choices && typeof cur.choices === 'object' ? cur.choices : {};
  choices[id] = { ref: opts.ref, decision: opts.decision, at: new Date().toISOString() };
  const written = writeLocal(root, 'skills-choices.json', `${JSON.stringify({ choices }, null, 2)}\n`);
  return `remembered: ${id} ${opts.decision} at ${opts.ref}\nfile: ${written}\n`;
}

async function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const root = require('./lib/project-dir.js').scriptProject(pos[0]);
  if (typeof opts.lsp === 'string') return `${opts.lsp}: ${onPath(opts.lsp) ? 'on PATH' : 'not on PATH'}\n`;
  const [, command, arg] = pos;
  if (command === 'inventory') {
    const r = inventory(root, opts);
    const file = writeLocal(root, 'tmp/skills-inventory.json', `${JSON.stringify(r, null, 2)}\n`);
    return `${inventoryReport(r)}\nfull result: ${file}\n`;
  }
  if (command === 'evidence') return runEvidence(root, opts);
  if (command === 'install') return runInstall(root, arg, opts);
  if (command === 'disable') return disable(root, arg, opts);
  if (command === 'remember') return remember(root, arg, opts);
  throw new Error(`unknown command ${command === undefined ? '(none)' : JSON.stringify(command)}: inventory, evidence, install, disable, remember or --lsp`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((text) => process.stdout.write(text), (e) => {
    process.stdout.write(`skills: error: ${firstLine(e)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { inventory, inventoryReport, pluginAction, skillAction, marketRepos, disable, remember, main };
