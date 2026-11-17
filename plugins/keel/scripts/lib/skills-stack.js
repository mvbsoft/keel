'use strict';
// What a project uses, for configure sections 11 and 12 (scripts/skills.js) and the stack rule of
// /keel:configure check: languages, ecosystems, package names from the manifests, docker-compose
// images and the file list. Only reads manifests and compose files; never a secret file, never a
// version or a lock file. Names read here are matched against keel's own lists and never leave the
// machine: a search uses only words from data/skill-needs.json.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../data/catalog.json');
const { isSecretName: isSecret } = require('./secret-names.js');
const { listFiles } = require('./files.js');
const { matchesAny } = require('./patterns.js');
const { noBom } = require('./json.js');
const { unsafeRel } = require('./safe-path.js');

const MAX_READ = 1024 * 1024;

function readText(root, rel) {
  if (isSecret(rel)) return null;
  try {
    const full = path.join(root, rel);
    if (fs.statSync(full).size > MAX_READ) return null;
    return noBom(fs.readFileSync(full, 'utf8'));
  } catch { return null; }
}

// Package names declared in the manifests of every part: npm, Composer, Python, Ruby, and the
// Spring Boot plugin id in Maven and Gradle files. Names only, never versions or lock files.
// Returns a Map: name → the manifest that declares it first (project-relative).
function packageSources(root, parts) {
  const names = new Map();
  const add = (n, file) => { if (!names.has(n)) names.set(n, file); };
  const json = (rel) => { try { return JSON.parse(readText(root, rel) || 'null'); } catch { return null; } };
  for (const part of parts) {
    const at = (f) => (part === '.' ? f : `${part}/${f}`);
    const pkg = json(at('package.json'));
    if (pkg) for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) Object.keys(pkg[k] || {}).forEach((n) => add(n, at('package.json')));
    const composer = json(at('composer.json'));
    if (composer) for (const k of ['require', 'require-dev']) Object.keys(composer[k] || {}).forEach((n) => add(n, at('composer.json')));
    for (const f of ['requirements.txt', 'requirements-dev.txt', 'requirements/base.txt', 'pyproject.toml', 'Pipfile', 'Gemfile', 'pom.xml', 'build.gradle', 'build.gradle.kts']) {
      const text = readText(root, at(f));
      if (!text) continue;
      const file = at(f);
      if (f.endsWith('.txt')) for (const line of text.split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line); if (m && !line.trim().startsWith('#')) add(m[1].toLowerCase(), file); }
      if (f === 'pyproject.toml' || f === 'Pipfile') for (const m of text.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:[=<>~!]|$)/gm)) add(m[1].toLowerCase(), file);
      if (f === 'pyproject.toml') for (const m of text.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:[=<>~!;,"'])/g)) add(m[1].toLowerCase(), file);
      if (f === 'Gemfile') for (const m of text.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) add(m[1], file);
      if (/pom\.xml|build\.gradle/.test(f) && text.includes('org.springframework.boot')) add('org.springframework.boot', file);
    }
  }
  return names;
}

const packagesOf = (root, parts) => new Set(packageSources(root, parts).keys());

// Adds an image reference without registry and tag ("docker.io/library/postgres:16" → "library/postgres"
// and "postgres") to `images` (image → the file that names it).
function addImage(images, raw, rel) {
  const ref = raw.replace(/@.*$/, '').replace(/:[^/]*$/, '').toLowerCase();
  if (!ref || ref.includes('$')) return;
  const parts = ref.split('/');
  // A first part with a dot or a port is a registry.
  const name = parts.length > 1 && /[.:]/.test(parts[0]) ? parts.slice(1).join('/') : ref;
  for (const n of [name, name.replace(/^library\//, ''), name.split('/').pop()]) if (!images.has(n)) images.set(n, rel);
}

// The Dockerfiles that compose services build (`build: <context>`, or `build:` with `context:` and
// `dockerfile:` below it), project-relative; one outside the project or given by URL is left out.
function builtDockerfiles(root, composeRel, text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  const plain = (v) => v.replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)build:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let context = '.';
    let dockerfile = 'Dockerfile';
    const value = plain(m[2]);
    if (value && !value.startsWith('#')) context = value;
    else {
      for (let j = i + 1; j < lines.length && (!lines[j].trim() || /^\s*#/.test(lines[j]) || /^\s*/.exec(lines[j])[0].length > m[1].length); j++) {
        const k = /^\s*(context|dockerfile):\s*(.+)$/.exec(lines[j]);
        if (k && k[1] === 'context') context = plain(k[2]);
        if (k && k[1] === 'dockerfile') dockerfile = plain(k[2]);
      }
    }
    if (/^[{[]/.test(context) || /:\/\//.test(context) || /^git@/.test(context)) continue;
    // Resolved the way readText reads it (the platform's separators, so ..\x on Windows too), then
    // kept only inside the project with no link on the way.
    const full = path.resolve(root, path.dirname(composeRel), context, dockerfile);
    const r = path.relative(path.resolve(root), full);
    if (!r || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) continue;
    const rel = r.split(path.sep).join('/');
    if (unsafeRel(root, rel)) continue;
    out.push(rel);
  }
  return out;
}

// Images named in docker-compose files (`image:`) and the FROM images of the Dockerfiles their
// services build. Returns a Map: image → the compose file or Dockerfile that names it.
function imagesOf(root, files) {
  const images = new Map();
  for (const rel of files.filter((f) => matchesAny(f, catalog.infra.compose))) {
    const text = readText(root, rel);
    if (!text) continue;
    for (const m of text.matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gm)) addImage(images, m[1], rel);
    for (const file of builtDockerfiles(root, rel, text)) {
      const docker = readText(root, file);
      if (!docker) continue;
      const stages = new Set([...docker.matchAll(/^\s*FROM\s+.*?\s+AS\s+(\S+)/gim)].map((m) => m[1].toLowerCase()));
      for (const m of docker.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)) if (!stages.has(m[1].toLowerCase())) addImage(images, m[1], file);
    }
  }
  return images;
}

// Folders whose files are no signal of the project's own stack: what the scan skips, and test data.
const NOT_SIGNALS = new Set([...catalog.skip_dirs, 'fixtures', '__fixtures__', 'testdata'].map((d) => d.toLowerCase()));
const ownFile = (rel) => !rel.split('/').slice(0, -1).some((d) => NOT_SIGNALS.has(d.toLowerCase()));

// The profile lists an ecosystem with its package manager ("npm:pnpm"); the entries ask for the bare id.
// `files` (optional) is the project's file list; without it file and image rules never match.
function stackOf(root, profile, files = null) {
  const sources = packageSources(root, profile.parts.map((p) => p.path));
  const list = (files || []).filter(ownFile);
  return {
    languages: new Set(profile.languages.map((l) => l.name)),
    ecosystems: new Set(profile.parts.flatMap((p) => p.ecosystems.map((e) => e.split(':')[0]))),
    packages: new Set(sources.keys()),
    package_files: sources,
    images: imagesOf(root, list),
    files: list,
  };
}

// The project's files as Claude Code's own listing sees them (git decides what is ignored).
const projectFiles = (root) => listFiles(root, catalog.skip_dirs).files;

const hasPackage = (stack, p) => stack.packages.has(p) || stack.packages.has(p.toLowerCase());

// Why `when` matches the project, as a short line naming the signal (a keel list word and where it
// was found), or null. `always` matches with "always".
function whyMatch(when, stack) {
  if (!when) return null;
  if (when.always) return 'always';
  const lang = (when.languages || []).find((l) => stack.languages.has(l));
  if (lang) return `language ${lang}`;
  const pkg = (when.packages || []).find((p) => hasPackage(stack, p));
  if (pkg) {
    const file = stack.package_files && (stack.package_files.get(pkg) || stack.package_files.get(pkg.toLowerCase()));
    return file ? `${pkg} in ${file}` : `package ${pkg}`;
  }
  const image = (when.images || []).find((i) => stack.images && stack.images.has(i.toLowerCase()));
  if (image) return `image ${image} in ${stack.images.get(image.toLowerCase())}`;
  const file = (stack.files || []).find((f) => (when.files || []).length && matchesAny(f, when.files));
  if (file) return `file ${file}`;
  const eco = (when.ecosystems || []).find((e) => stack.ecosystems.has(e));
  if (eco) return `ecosystem ${eco}`;
  return null;
}

const matchesWhen = (when, stack) => whyMatch(when, stack) !== null;

module.exports = { packagesOf, packageSources, imagesOf, stackOf, projectFiles, matchesWhen, whyMatch, readText };
