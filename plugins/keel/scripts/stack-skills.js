'use strict';
// configure section 7: stack plugins for this project. Matches the project (languages, ecosystems,
// framework packages in the manifests) against keel's checked list (data/stack-skills.json) and
// searches the marketplaces the user has added, except the excluded ones, for the detected
// frameworks and languages. Installs nothing: claude refuses plugin installs that Claude runs, so the
// user runs the printed commands in their own terminal. Only reads (manifests; never secret files).
// Usage: node stack-skills.js <projectDir> [--available <file>]
//        node stack-skills.js <projectDir> --lsp <command>   (is that language server on PATH now?)
//   --available  the output of `claude plugin list --json --available` saved to a file (tests); by
//                default the script runs that command itself
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { scan, isSecret } = require('./scan.js');
const { onPath } = require('./lib/files.js');
const { parseArgs, writeLocal } = require('./lib/project.js');
const data = require('../data/stack-skills.json');

const MAX_READ = 1024 * 1024;
const SEARCH_LIMIT = 5;

function readText(root, rel) {
  if (isSecret(rel)) return null;
  try {
    const full = path.join(root, rel);
    if (fs.statSync(full).size > MAX_READ) return null;
    return fs.readFileSync(full, 'utf8');
  } catch { return null; }
}

// Package names declared in the manifests of every part: npm, Composer, Python, Ruby, and the
// Spring Boot plugin id in Maven and Gradle files. Names only, never versions or lock files.
function packagesOf(root, parts) {
  const names = new Set();
  const json = (rel) => { try { return JSON.parse(readText(root, rel) || 'null'); } catch { return null; } };
  for (const part of parts) {
    const at = (f) => (part === '.' ? f : `${part}/${f}`);
    const pkg = json(at('package.json'));
    if (pkg) for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) Object.keys(pkg[k] || {}).forEach((n) => names.add(n));
    const composer = json(at('composer.json'));
    if (composer) for (const k of ['require', 'require-dev']) Object.keys(composer[k] || {}).forEach((n) => names.add(n));
    for (const f of ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt', 'pyproject.toml', 'Pipfile', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts']) {
      const text = readText(root, at(f));
      if (!text) continue;
      if (f.endsWith('.txt')) for (const line of text.split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line); if (m && !line.trim().startsWith('#')) names.add(m[1].toLowerCase()); }
      if (f === 'pyproject.toml' || f === 'Pipfile') for (const m of text.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:[=<>~!]|$)/gm)) names.add(m[1].toLowerCase());
      if (f === 'pyproject.toml') for (const m of text.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!;,"'])/g)) names.add(m[1].toLowerCase());
      if (f === 'Gemfile') for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) names.add(m[1]);
      if (/pom\.xml|build\.gradle/.test(f) && text.includes('org.springframework.boot')) names.add('org.springframework.boot');
    }
  }
  return names;
}

function listAvailable(opts) {
  try {
    const text = typeof opts.available === 'string'
      ? fs.readFileSync(opts.available, 'utf8')
      : execFileSync('claude', ['plugin', 'list', '--json', '--available'], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(text);
    return { available: j.available || [], installed: j.installed || [], error: null };
  } catch (e) {
    return { available: [], installed: [], error: `could not list the marketplaces (${String(e.message || e).split('\n')[0]})` };
  }
}

function matchesWhen(when, stack) {
  if (!when) return false;
  if (when.always) return true;
  return (when.languages || []).some((l) => stack.languages.has(l))
    || (when.ecosystems || []).some((e) => stack.ecosystems.has(e))
    || (when.packages || []).some((p) => stack.packages.has(p) || stack.packages.has(p.toLowerCase()));
}

function run(root, opts) {
  const { profile } = scan(root);
  const stack = {
    languages: new Set(profile.languages.map((l) => l.name)),
    ecosystems: new Set(profile.parts.flatMap((p) => p.ecosystems)),
    packages: packagesOf(root, profile.parts.map((p) => p.path)),
  };
  const frameworks = data.frameworks.filter((f) => f.packages.some((p) => stack.packages.has(p) || stack.packages.has(p.toLowerCase()))).map((f) => f.name);
  const list = listAvailable(opts);
  const excluded = new Set(data.excluded_marketplaces);
  const allowed = list.available.filter((p) => !excluded.has(p.marketplaceName));
  const marketplaces = new Set(list.available.map((p) => p.marketplaceName));
  const installedIds = new Set(list.installed
    .filter((i) => i.scope !== 'project' || !i.projectPath || path.resolve(i.projectPath) === path.resolve(root))
    .map((i) => i.id));

  const checked = data.plugins.filter((p) => matchesWhen(p.when, stack)).map((p) => ({
    ...p,
    installed: installedIds.has(p.plugin),
    in_marketplace: !list.error ? allowed.some((a) => a.pluginId === p.plugin) : null,
    needs_on_path: p.needs && p.needs.command ? onPath(p.needs.command) : null,
  }));
  const toAdd = data.marketplaces.filter((m) => !marketplaces.has(m.name)).map((m) => ({ ...m, suggest: m.suggest.filter((s) => matchesWhen(s.when, stack)) })).filter((m) => m.suggest.length);
  const added = data.marketplaces.filter((m) => marketplaces.has(m.name)).flatMap((m) => m.suggest.filter((s) => matchesWhen(s.when, stack)).map((s) => ({ plugin: `${s.plugin}@${m.name}`, what: s.what, author: m.author, installed: installedIds.has(`${s.plugin}@${m.name}`) })));

  // Search the allowed marketplaces by framework and language name; keel's own entries are listed above.
  const known = new Set([...checked.map((c) => c.plugin), ...added.map((a) => a.plugin)]);
  const found = {};
  for (const term of [...frameworks, ...stack.languages]) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`, 'i');
    // by name only: descriptions mention frameworks in passing ("React UI", "PHP hosting")
    const hits = allowed.filter((p) => !known.has(p.pluginId) && re.test(p.name))
      .sort((a, b) => (b.installCount || 0) - (a.installCount || 0)).slice(0, SEARCH_LIMIT);
    if (hits.length) found[term] = hits.map((p) => ({ plugin: p.pluginId, marketplace: p.marketplaceName, description: p.description || '', installed: installedIds.has(p.pluginId) }));
  }
  const coveredFrameworks = new Set([...checked.flatMap((c) => data.frameworks.filter((f) => (c.when.packages || []).some((p) => f.packages.includes(p))).map((f) => f.name)), ...Object.keys(found)]);
  const nothing = frameworks.filter((f) => !coveredFrameworks.has(f));
  return { stack: { languages: [...stack.languages], frameworks }, marketplaces_error: list.error, checked, marketplaces_to_add: toAdd, from_added_marketplaces: added, found, nothing_reliable: nothing };
}

function report(r) {
  const out = [`stack: languages ${r.stack.languages.join(', ') || 'none'}; frameworks ${r.stack.frameworks.join(', ') || 'none detected'}`];
  if (r.marketplaces_error) out.push(`marketplaces: ${r.marketplaces_error}; only keel's checked list below`);
  const install = (id) => `claude plugin install ${id} --scope project`;
  out.push('checked by keel:');
  for (const c of r.checked) {
    const state = c.installed ? 'installed already' : c.in_marketplace === false ? 'its marketplace is not added' : `install: ${install(c.plugin)}`;
    const needs = c.needs && c.needs.command ? ` | needs ${c.needs.command}: ${c.needs_on_path ? 'on PATH' : `not installed (${c.needs.install})`}` : '';
    out.push(`- ${c.plugin} [${c.kind}, ${c.author}] ${c.what} | ${state}${needs}${c.needs && c.needs.note ? ` | note: ${c.needs.note}` : ''}`);
  }
  for (const a of r.from_added_marketplaces) out.push(`- ${a.plugin} [${a.author}] ${a.what} | ${a.installed ? 'installed already' : `install: ${install(a.plugin)}`}`);
  for (const m of r.marketplaces_to_add) out.push(`marketplace not added: ${m.name} [${m.author}] ${m.what} add: ${m.add}; then: ${m.suggest.map((s) => `${s.plugin} (${s.what})`).join('; ')}`);
  const terms = Object.keys(r.found);
  if (terms.length) {
    out.push('found in your marketplaces (not checked by keel):');
    for (const t of terms) for (const f of r.found[t]) out.push(`- ${t}: ${f.plugin}: ${f.description.slice(0, 140)}${f.installed ? ' | installed already' : ''}`);
  }
  if (r.nothing_reliable.length) out.push(`nothing reliable found for: ${r.nothing_reliable.join(', ')}`);
  return out.join('\n');
}

if (require.main === module) {
  const { opts, pos } = parseArgs(process.argv.slice(2));
  const root = path.resolve(pos[0] || '.');
  if (typeof opts.lsp === 'string') {
    process.stdout.write(`${opts.lsp}: ${onPath(opts.lsp) ? 'on PATH' : 'not on PATH'}\n`);
  } else {
    const r = run(root, opts);
    const file = writeLocal(root, 'tmp/stack-skills.json', `${JSON.stringify(r, null, 2)}\n`);
    process.stdout.write(`${report(r)}\nfull result: ${file}\n`);
  }
}

module.exports = { run, report, packagesOf, matchesWhen };
