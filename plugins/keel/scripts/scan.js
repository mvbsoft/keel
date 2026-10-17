'use strict';
// Layer 1 of the project scan: a read-only, deterministic look at the whole project.
// Usage: node scan.js [projectDir]  → prints JSON { profile, findings } to stdout.
// - never runs project commands (only `git ls-files` to respect .gitignore);
// - never opens a secret file: secrets are reported by path only;
// - reads only small text files it needs (manifests, CI, task runners, version pins).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const catalog = require('../data/catalog.json');
const { listFiles, onPath } = require('./lib/files.js');
const languages = require('./lib/languages.js');
const { matches, matchesAny } = require('./lib/patterns.js');
const { findCommands } = require('./lib/commands.js');
const { safeLocalWrite } = require('./lib/safe-path.js');
const instructions = require('./lib/instructions.js');

const MAX_READ = 1024 * 1024;

// Whether a program is on PATH, found by looking at the folders only: nothing is run.

const DOTNET_PROJECT = /\.(sln|slnx|csproj|fsproj|vbproj)$/i;
const DOTNET_SETTINGS = /(^|\/)(global\.json|Directory\.Build\.props|Directory\.Packages\.props)$/i;

const secretCache = new Map();
const isSecret = (rel) => {
  let hit = secretCache.get(rel);
  if (hit === undefined) { hit = matchesAny(rel, catalog.secrets.patterns) && !matchesAny(rel, catalog.secrets.allowed); secretCache.set(rel, hit); }
  return hit;
};
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.');
const under = (rel, part) => part === '.' || rel === part || rel.startsWith(`${part}/`);

function makeReader(root) {
  const reads = [];
  const readText = (rel) => {
    if (isSecret(rel)) throw new Error(`refusing to read a secret file: ${rel}`);
    try {
      const full = path.join(root, rel);
      if (fs.statSync(full).size > MAX_READ) return null;
      reads.push(rel);
      return fs.readFileSync(full, 'utf8');
    } catch { return null; }
  };
  const readFirstLine = (rel) => {
    if (isSecret(rel)) return null;
    let fd;
    try {
      fd = fs.openSync(path.join(root, rel), 'r');
      const buf = Buffer.alloc(128);
      const n = fs.readSync(fd, buf, 0, 128, 0);
      return buf.subarray(0, n).toString('utf8').split('\n')[0];
    } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  return { readText, readFirstLine, reads };
}

// Workspace member globs → part directories that exist.
function resolveMembers(globs, manifestDirs) {
  const dirs = new Set();
  for (const g of globs) {
    const clean = g.replace(/^\.\//, '').replace(/\/$/, '');
    if (clean.startsWith('!')) continue;
    for (const d of manifestDirs) if (d !== '.' && matches(d, clean.includes('/') ? clean : `${clean}`)) dirs.add(d);
  }
  return [...dirs];
}

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whether a catalog marker ("file#marker") holds in a root file. JSON, TOML sections and gradle's include
// are read as what they name: the word "workspaces" in a description or "include" in a comment is no marker.
function markerHolds(file, marker, text) {
  if (!marker) return true;
  if (file === 'package.json') {
    try { const v = JSON.parse(text)[marker]; return Array.isArray(v) || Boolean(v && typeof v === 'object'); } catch { return false; }
  }
  if (marker.startsWith('[')) return new RegExp(`^\\s*${escapeRe(marker)}\\s*(#.*)?$`, 'm').test(text);
  if (/^settings\.gradle/.test(file) && marker === 'include') return /^\s*include\s*[('"]/m.test(text);
  return text.includes(marker);
}

function workspaceGlobs(root, files, readText) {
  const globs = [];
  const pkg = files.has('package.json') ? readText('package.json') : null;
  if (pkg) {
    try {
      const ws = JSON.parse(pkg).workspaces;
      globs.push(...(Array.isArray(ws) ? ws : (ws && ws.packages) || []));
    } catch { /* gap */ }
  }
  const pnpm = files.has('pnpm-workspace.yaml') ? readText('pnpm-workspace.yaml') : null;
  if (pnpm) globs.push(...[...pnpm.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*$/gm)].map((m) => m[1]));
  const cargo = files.has('Cargo.toml') ? readText('Cargo.toml') : null;
  const members = cargo && /\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/.exec(cargo);
  if (members) globs.push(...[...members[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
  for (const f of ['settings.gradle', 'settings.gradle.kts']) {
    const text = files.has(f) ? readText(f) : null;
    if (text) for (const m of text.matchAll(/^\s*include\s*\(?([^\n)]*)/gm)) for (const q of m[1].matchAll(/['"]:?([^'"]+)['"]/g)) globs.push(q[1].replace(/:/g, '/'));
  }
  const gowork = files.has('go.work') ? readText('go.work') : null;
  if (gowork) globs.push(...[...gowork.matchAll(/^\s*(?:use\s+)?(\.\/[^\s)]+)/gm)].map((m) => m[1]));
  return globs;
}

function scan(root) {
  root = path.resolve(root);
  const { files: list, ignored, truncated, git } = listFiles(root, catalog.skip_dirs);
  const files = new Set(list);
  const { readText, readFirstLine, reads } = makeReader(root);
  const findings = { git, truncated, files: list.length, gaps: [] };

  // Secrets: by name only, including git-ignored ones.
  const secretPaths = [...new Set([...list, ...ignored.filter((p) => !p.endsWith('/'))].filter(isSecret))].sort();

  // Languages.
  const counts = new Map();
  for (const rel of list) {
    if (isSecret(rel) || languages.isVendored(rel) || languages.isDocumentation(rel)) continue;
    const lang = languages.detect(rel, readFirstLine);
    if (!languages.counted(lang)) continue;
    // .h files belong to C++ when the project has C++ sources; settled after the loop.
    const name = lang.name === 'C' && rel.endsWith('.h') ? '.h' : languages.display(lang);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  if (counts.has('.h')) {
    const target = counts.has('C++') ? 'C++' : 'C';
    counts.set(target, (counts.get(target) || 0) + counts.get('.h'));
    counts.delete('.h');
  }
  const langList = [...counts].map(([name, n]) => ({ name, files: n })).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  // Manifests → ecosystems per directory. Manifests in vendor-like or doc-like folders are held back: a
  // workspace that names the folder (packages/cache) makes them parts after all.
  const ecoByDir = new Map();
  const heldByDir = new Map();
  const manifestFiles = [];
  const dotnetDirs = new Set(list.filter((rel) => DOTNET_PROJECT.test(rel)).map(dirOf));
  for (const rel of list) {
    const held = languages.isVendored(rel) || languages.isDocumentation(rel);
    for (const eco of catalog.ecosystems) {
      if (matchesAny(rel, eco.manifests.map((m) => (m.includes('/') ? `**/${m}` : m)))) {
        const dir = eco.manifests.find((m) => m.includes('/') && rel.endsWith(m)) ? dirOf(dirOf(rel)) : dirOf(rel);
        // global.json and Directory.Build.props sit at a solution's root, which may be another folder: they
        // make a .NET part only where a solution or project file is.
        if (eco.id === 'dotnet' && DOTNET_SETTINGS.test(rel) && !dotnetDirs.has(dir)) { if (!held) manifestFiles.push(rel); continue; }
        if (held) {
          if (!heldByDir.has(dir)) heldByDir.set(dir, { ecos: new Set(), files: [] });
          heldByDir.get(dir).ecos.add(eco.id);
          heldByDir.get(dir).files.push(rel);
        } else {
          if (!ecoByDir.has(dir)) ecoByDir.set(dir, new Set());
          ecoByDir.get(dir).add(eco.id);
          manifestFiles.push(rel);
        }
      }
    }
  }
  const ecoById = Object.fromEntries(catalog.ecosystems.map((e) => [e.id, e]));

  // Monorepo.
  let monorepoTool = null;
  for (const m of catalog.monorepo) {
    const hit = m.files.some((f) => {
      const [file, marker] = f.split('#');
      if (!files.has(file)) return false;
      return !marker || markerHolds(file, marker, readText(file) || '');
    });
    if (hit) { monorepoTool = m.tool; break; }
  }
  const manifestDirs = [...ecoByDir.keys()];
  let partDirs;
  if (monorepoTool) {
    const members = resolveMembers(workspaceGlobs(root, files, readText), [...manifestDirs, ...heldByDir.keys()]);
    for (const d of members) {
      const h = heldByDir.get(d);
      if (!h) continue;
      if (!ecoByDir.has(d)) ecoByDir.set(d, new Set());
      for (const id of h.ecos) ecoByDir.get(d).add(id);
      manifestFiles.push(...h.files);
    }
    partDirs = ['.', ...members.sort()];
    if (!members.length) findings.gaps.push({ kind: 'monorepo', detail: `monorepo tool "${monorepoTool}" found, but its members could not be resolved from the files` });
    const unmapped = manifestDirs.filter((d) => d !== '.' && !members.includes(d)).sort();
    if (unmapped.length) findings.gaps.push({ kind: 'unmapped-manifest', detail: `manifests in ${unmapped.length} folder(s) that "${monorepoTool}" does not list as members, so they are not parts: ${unmapped.slice(0, 8).join(', ')}${unmapped.length > 8 ? `, +${unmapped.length - 8} more` : ''}` });
  } else {
    // Without a workspace marker: the root plus sub-projects of an ecosystem the root does not have.
    const rootEcos = ecoByDir.get('.') || new Set();
    partDirs = ['.'];
    for (const d of manifestDirs.sort()) {
      if (d === '.') continue;
      const covered = partDirs.some((p) => under(d, p) && [...ecoByDir.get(d)].every((e) => (p === '.' ? rootEcos : ecoByDir.get(p) || new Set()).has(e)));
      if (!covered) partDirs.push(d);
    }
  }


  // Parts: ecosystems, package managers, commands.
  const parts = partDirs.map((dir) => {
    const ecos = [...(ecoByDir.get(dir) || [])];
    const packageManagers = {};
    for (const id of ecos) {
      const locks = Object.entries(ecoById[id].locks || {}).filter(([lock]) => files.has(dir === '.' ? lock : `${dir}/${lock}`));
      const pms = [...new Set(locks.map(([, pm]) => pm))];
      if (pms.length > 1) findings.gaps.push({ kind: 'conflict', part: dir, detail: `several lock files for ${id}: ${pms.join(', ')}` });
      if (pms.length) packageManagers[id] = pms[0];
      if (id === 'npm' && !pms.length) {
        // Inherit the monorepo root's lock file, or read packageManager from package.json.
        const rootLock = Object.entries(ecoById.npm.locks).find(([lock]) => files.has(lock));
        const declared = /"packageManager"\s*:\s*"([a-z]+)@/.exec(readText(dir === '.' ? 'package.json' : `${dir}/package.json`) || '');
        packageManagers.npm = rootLock ? rootLock[1] : declared ? declared[1] : 'npm';
      }
    }
    const candidates = findCommands({ part: dir, files, readText, catalog, ecosystems: ecos.map((id) => ecoById[id]), packageManagers, isRoot: dir === '.' });
    const commands = {};
    for (const kind of ['test', 'lint', 'types']) {
      const best = candidates.filter((c) => c.kind === kind);
      if (best.length) commands[kind] = [best[0].command];
    }
    if (!ecos.length) {
      const code = langList.length ? langList.slice(0, 3).map((l) => l.name).join(', ') : 'no code';
      if (dir === '.' && langList.length) findings.gaps.push({ kind: 'no-manifest', part: dir, detail: `no package or build manifest; code found: ${code}` });
    }
    if (dir !== "." && !(ecoByDir.get(".") || new Set()).size && !monorepoTool) {
      findings.gaps.push({ kind: "unclear-part", part: dir, detail: "the root has no manifest: a separate part, or third-party code bundled into the project?" });
    }
    if (!commands.test && (ecos.length || langList.length)) findings.gaps.push({ kind: 'no-test-command', part: dir, detail: 'no test command found' });
    return { part: { path: dir, ecosystems: ecos.map((id) => (packageManagers[id] ? `${id}:${packageManagers[id]}` : id)), commands, run_command: null }, candidates, packageManagers };
  });

  // Other findings (names only).
  const pick = (patterns) => list.filter((rel) => !languages.isVendored(rel) && matchesAny(rel, patterns));
  const migrationDirs = catalog.database.migration_dirs.filter((d) => list.some((rel) => rel.startsWith(`${d}/`) || rel.includes(`/${d}/`)));
  for (const rel of list) {
    if (/(^|\/)\./.test(rel)) continue; // tool folders such as .claude/skills are not the project's schema
    const m = /(^|\/)((?:[^/]*[-_.])?(?:migrations?|migrate))\//i.exec(rel);
    if (m && !migrationDirs.some((d) => rel.includes(`${d}/`))) {
      const dir = rel.slice(0, rel.indexOf(m[2]) + m[2].length);
      if (!findings.gaps.some((g) => g.detail.includes(dir))) findings.gaps.push({ kind: 'database', detail: `possible migrations outside known layouts: ${dir}` });
    }
  }
  const apiFiles = pick(catalog.api);
  const hiddenDirs = new Set(list.filter((r) => r.startsWith('.') && r.includes('/')).map((r) => r.slice(0, r.indexOf('/'))));
  const otherSystems = [];
  for (const d of hiddenDirs) {
    if (catalog.other_systems.known_tool_dirs.includes(d)) continue;
    const inside = list.filter((r) => r.startsWith(`${d}/`));
    const hits = inside.filter((r) => catalog.other_systems.names.some((n) => r.toLowerCase().includes(n)));
    if (hits.length) otherSystems.push({ path: d, files: inside.length, examples: hits.slice(0, 5) });
  }
  const looseNotes = new Map();
  for (const rel of pick(catalog.other_systems.files)) looseNotes.set(dirOf(rel), [...(looseNotes.get(dirOf(rel)) || []), rel]);
  for (const [dir, notes] of looseNotes) if (!otherSystems.some((o) => o.path === dir)) otherSystems.push({ path: dir, files: notes.length, examples: notes.slice(0, 5) });
  for (const d of ['handoffs', 'handoff']) {
    const inside = list.filter((r) => r.startsWith(`${d}/`));
    const known = otherSystems.find((o) => o.path === d);
    if (known) known.files = inside.length;
    else if (inside.length) otherSystems.push({ path: d, files: inside.length, examples: inside.slice(0, 5) });
  }

  const envVersions = {};
  for (const rel of pick(catalog.env_versions.map((f) => (f.includes('/') ? f : `${f}`)))) {
    if (dirOf(rel) !== '.' && !rel.startsWith('.devcontainer/')) continue;
    const text = readText(rel);
    envVersions[rel] = text && text.length < 2000 ? text.trim().split(/\r?\n/).slice(0, 10).join(' | ') : '(present)';
  }

  const triggers = {
    security: ['**/auth/**', '**/*auth*', '**/*login*', '**/*password*', '**/*permission*', '**/*role*', '**/*acl*', '**/*token*', '**/*crypt*', '**/*payment*', '**/*billing*', '**/*invoice*', '**/*balance*', '**/*order*'],
    data: [...migrationDirs.map((d) => `**/${d}/**`), '**/*.sql', '**/models/**', '**/entities/**', '**/schema.prisma', '**/routes/**', '**/controllers/**', ...new Set(apiFiles.map((f) => `**/${f.slice(f.lastIndexOf('/') + 1)}`))],
    docs: ['**/*.md', 'docs/**'],
    env: [...new Set(manifestFiles.map((f) => `**/${f.slice(f.lastIndexOf('/') + 1)}`)), '**/Dockerfile*', '**/compose*.y*ml', '**/docker-compose*.y*ml', '.github/workflows/**', '**/*.tf', '**/Chart.yaml', '**/.env.example'],
  };

  // Fingerprint of manifests and monorepo/task files: a change suggests a re-scan.
  const hash = crypto.createHash('sha256');
  const fpFiles = [...new Set([...manifestFiles, ...pick([...catalog.monorepo.flatMap((m) => m.files.map((f) => f.split('#')[0])), ...Object.values(catalog.task_runners).flat()])])].filter((f) => !isSecret(f)).sort();
  for (const f of fpFiles) hash.update(`${f}\0${readText(f) || ''}\0`);

  const profile = {
    schema_version: 1,
    manifest_fingerprint: hash.digest('hex'),
    languages: langList,
    monorepo_tool: monorepoTool,
    parts: parts.map((p) => p.part),
    triggers,
    secret_paths: secretPaths,
    ai_rules: pick(catalog.ai_rules).sort(),
  };
  Object.assign(findings, {
    linguist: languages.version,
    command_candidates: Object.fromEntries(parts.map((p) => [p.part.path, p.candidates.map(({ kind, command, source }) => ({ kind, command, source }))])),
    env_versions: envVersions,
    infra: Object.fromEntries(Object.entries(catalog.infra).map(([k, pats]) => [k, pick(pats)]).filter(([, v]) => v.length)),
    ci: Object.fromEntries(Object.entries(catalog.ci).map(([k, pats]) => [k, pick(pats)]).filter(([, v]) => v.length)),
    database: { migration_dirs: migrationDirs, files: pick(catalog.database.files.filter((f) => f !== '*.sql')), sql_files: pick(['*.sql']).length },
    api: apiFiles,
    docs: docsShape(list, pick, readText),
    architecture_rules: pick(catalog.architecture_rules.map((f) => f.split('#')[0])),
    security: Object.fromEntries(Object.entries(catalog.security.configs).map(([k, pats]) => [k, pick(pats)]).filter(([, v]) => v.length)),
    scanners_installed: Object.fromEntries(['gitleaks', 'semgrep', 'pip-audit', 'cargo-audit', 'govulncheck', 'bundle-audit'].map((n) => [n, onPath(n)])),
    other_instructions: instructions.otherInstructions(root, profile.ai_rules),
    other_systems: otherSystems,
    android: pick(catalog.android.markers).length > 0,
    files_read: reads.length,
  });
  return { profile, findings };
}

// What the project's documentation looks like (configure section 8): doc files, ADR and spec folders,
// a Diátaxis-like docs/ (at least three of its four kinds), arc42 and C4 files, the files Claude Code
// loads into every session with their line counts, and the profile and pattern that fit what exists.
function docsShape(list, pick, readText) {
  const d = catalog.docs;
  const hasDir = (dir) => list.some((r) => r.startsWith(`${dir}/`));
  const adrDirs = d.adr_dirs.filter(hasDir);
  const specDirs = d.spec_dirs.filter(hasDir);
  const kinds = Object.entries(d.diataxis).filter(([, names]) => names.some((n) => hasDir(`docs/${n}`))).map(([kind]) => kind);
  const arc42 = pick(d.arc42).length > 0;
  const c4 = pick(d.c4).length > 0;
  const lineCount = (text) => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);
  const alwaysLoaded = pick(d.always_loaded).map((rel) => ({ path: rel, lines: lineCount(readText(rel)) }));
  const pattern = arc42 && c4 ? 'arc42-c4' : arc42 ? 'arc42' : kinds.length >= 3 ? 'diataxis' : 'none';
  return {
    files: pick(d.files.map((f) => f.split('#')[0])).filter((f) => !f.includes('/') || f.startsWith('docs/')),
    adr_dirs: adrDirs,
    spec_dirs: specDirs,
    diataxis_kinds: kinds,
    arc42,
    c4,
    always_loaded: alwaysLoaded,
    suggested_profile: specDirs.length ? 3 : adrDirs.length ? 2 : 1,
    suggested_pattern: pattern,
  };
}

// The fingerprint comes from the same full scan so the two can never disagree (about 1 s on a
// 38,000-file project).
const fingerprint = (root) => scan(root).profile.manifest_fingerprint;

module.exports = { scan, fingerprint, isSecret };

// Short plain-text summary for the conversation; the full result goes to the --out file.
function summary(result, outFile) {
  const { profile, findings } = result;
  const lines = [`scan: ${findings.files} files${findings.truncated ? ' (truncated)' : ''}; full result in ${outFile}`];
  lines.push(`languages: ${profile.languages.slice(0, 8).map((l) => `${l.name} ${l.files}`).join(', ') || 'none'}`);
  lines.push(`monorepo: ${profile.monorepo_tool || 'no'}`);
  for (const p of profile.parts) {
    const cmds = Object.entries(p.commands).map(([k, v]) => `${k}: ${v[0]}`).join('; ');
    lines.push(`part ${p.path}: ${p.ecosystems.join(', ') || 'no manifest'}${cmds ? ` | ${cmds}` : ''}`);
  }
  lines.push(`secret files (never opened): ${profile.secret_paths.join(', ') || 'none'}`);
  lines.push(`AI instruction files: ${profile.ai_rules.join(', ') || 'none'}`);
  lines.push(instructions.describe(findings.other_instructions));
  const d = findings.docs;
  lines.push(`docs: ${d.files.join(', ') || 'no README or docs site'}; ADR ${d.adr_dirs.join(', ') || 'none'}; specs ${d.spec_dirs.join(', ') || 'none'}; pattern ${d.suggested_pattern}; suggested profile ${d.suggested_profile}`);
  if (d.always_loaded.length) lines.push(`loaded every session: ${d.always_loaded.map((f) => `${f.path} ${f.lines} lines${f.lines > 200 ? ' (over 200)' : ''}`).join(', ')}`);
  lines.push(`gaps: ${findings.gaps.length ? findings.gaps.map((g) => `${g.kind}${g.part ? ` (${g.part})` : ''}: ${g.detail}`).join(' | ') : 'none'}`);
  lines.push(`scanners on PATH: ${Object.entries(findings.scanners_installed).map(([n, ok]) => `${n} ${ok ? 'yes' : 'no'}`).join(', ')}`);
  if (findings.other_systems.length) lines.push(`other notes or memory systems: ${findings.other_systems.map((o) => o.path).join(', ')}`);
  return lines.join('\n');
}

if (require.main === module) {
  // Arguments are read like every keel script (and like hooks/own-files.js): the project comes first.
  const { opts, pos } = require('./lib/project.js').parseArgs(process.argv.slice(2));
  const root = path.resolve(pos[0] || process.cwd());
  const result = scan(root);
  if (opts.out === undefined) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // The full result may only be written to the project's keel temp folder, through no link.
    const tmp = path.join(root, '.keel', 'local', 'tmp');
    const r = typeof opts.out === 'string' ? path.relative(tmp, path.resolve(opts.out)) : '';
    if (!r || r.startsWith('..') || path.isAbsolute(r)) {
      process.stdout.write(`scan: --out must be a file inside ${tmp}\n`);
    } else {
      try {
        const out = safeLocalWrite(root, ['tmp', ...r.split(path.sep)], JSON.stringify(result, null, 2) + '\n');
        process.stdout.write(summary(result, out) + '\n');
      } catch (e) { process.stdout.write(`scan: ${e.message}\n`); }
    }
  }
}
