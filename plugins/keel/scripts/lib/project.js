'use strict';
// Shared helpers for verification scripts: config and profile, secret check, the .keel/local folders.
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../../data/catalog.json');
const { checkConfig, loadSchema } = require('./config.js');
const { isSecretName } = require('./secret-names.js');
const { safeLocalWrite } = require('./safe-path.js');
const { readJsonFile } = require('./json.js');

function loadProject(root) {
  const { state, errors, config } = checkConfig(root);
  if (state !== 'ok') throw new Error(`keel is not configured here (config ${state}${errors.length ? `: ${errors[0]}` : ''}); run /keel:configure`);
  const { profile, isSecret } = secretCheck(root);
  return { config, profile, isSecret };
}

// The `default` values of a JSON schema node, as an object (undefined when it has none).
function defaultsOf(node) {
  if (node.default !== undefined) return node.default;
  if (node.type !== 'object' || !node.properties) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(node.properties)) {
    const d = defaultsOf(v);
    if (d !== undefined) out[k] = d;
  }
  return Object.keys(out).length ? out : undefined;
}

// loadProject for git steps and verification (git-flow.js, changes.js, fingerprint.js, votes.js).
// `otherRepo` (their --other-repo: the folder of a planned ticket of another repository): a repository
// without keel there gets the config schema's defaults, no gates, manual git and the main branch
// origin/HEAD names (null when it names none). Without it a missing config throws as in loadProject, also
// naming the flag: a keel project's checkout without its config must not run on guessed settings. A
// config keel cannot use, or a folder outside git, always throws.
function loadProjectOrDefaults(root, otherRepo = false) {
  const { git } = require('./repo-read.js');
  if (checkConfig(root).state !== 'missing' || git(root, ['rev-parse', '--git-dir']) === null) return loadProject(root);
  if (!otherRepo) {
    try { return loadProject(root); } catch (e) { throw new Error(`${e.message}; in the folder of another repository's ticket, add --other-repo`); }
  }
  const head = git(root, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD']);
  const main = head && head.includes('/') ? head.slice(head.indexOf('/') + 1) : null;
  const defaults = defaultsOf(loadSchema());
  const config = { ...defaults, gates: { checks: [], security_scanners: [] }, git: { ...defaults.git, mode: 'manual', main_branch: main } };
  const { profile, isSecret } = secretCheck(root);
  return { config, profile, isSecret };
}

// The secret test without requiring a config: catalog patterns plus the profile's secret_paths.
function secretCheck(root) {
  let profile = null;
  try { profile = readJsonFile(path.join(require('./project-dir.js').configHome(root), '.keel', 'profile.json')); } catch { /* optional */ }
  const extra = new Set(profile && Array.isArray(profile.secret_paths) ? profile.secret_paths : []);
  // A profile may list source files that are only named like a secret (src/secrets.py): those are code.
  const isSecret = (rel) => isSecretName(rel) || (extra.has(rel) && !isSecretName(rel, { strict: true }));
  return { profile, isSecret };
}

const localDir = (root, ...parts) => path.join(root, '.keel', 'local', ...parts);

// Refuses a link anywhere on the way (lib/safe-path.js).
const writeLocal = (root, rel, text) => safeLocalWrite(root, rel.split('/'), text);

function readJson(file) {
  try { return readJsonFile(file); } catch { return null; }
}

// "--name value" options and positional arguments.
function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

module.exports = { loadProject, loadProjectOrDefaults, secretCheck, localDir, writeLocal, readJson, parseArgs };
