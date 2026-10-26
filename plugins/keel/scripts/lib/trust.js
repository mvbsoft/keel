'use strict';
// Projects whose autonomous git mode the user confirmed on this machine. The mode itself sits in the
// committed .keel/config.json, so a cloned repository could switch it on for itself; the hook lets
// git steps run without a prompt only for projects listed here (~/.claude/keel/trusted-git.json).
// Each entry keeps a hash of the `git` section the user confirmed: a branch that edits it
// (ask_before_merge, main_branch) gets no silent step until the user confirms again.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { usageDir } = require('./usage-config.js');
const { readJsonFile } = require('./json.js');

const file = (env = process.env) => path.join(usageDir(env), 'trusted-git.json');
const key = (root) => {
  const p = path.resolve(root).replace(/\\/g, '/').replace(/\/+$/, '');
  // Windows folds only A-Z here: toLowerCase would also turn the Kelvin sign into k, another folder.
  return process.platform === 'win32' ? p.replace(/[A-Z]/g, (c) => c.toLowerCase()) : p;
};

// Key order does not change the hash.
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v));
const gitHash = (git) => crypto.createHash('sha256').update(canonical(git ?? null)).digest('hex');

function gitSection(root) {
  try { return readJsonFile(path.join(root, '.keel', 'config.json')).git ?? null; } catch { return null; }
}

// [{ path, git }]; anything else in the file is not a confirmation.
function entries(env = process.env) {
  try {
    const list = JSON.parse(fs.readFileSync(file(env), 'utf8')).projects;
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && typeof e.path === 'string') : [];
  } catch { return []; }
}

// 'confirmed' | 'changed' (the git settings differ from the confirmed ones) | 'none'.
function trustState(root, env = process.env) {
  const entry = entries(env).find((e) => e.path === key(root));
  if (!entry) return 'none';
  return entry.git === gitHash(gitSection(root)) ? 'confirmed' : 'changed';
}

const isTrusted = (root, env = process.env) => trustState(root, env) === 'confirmed';

function trust(root, env = process.env) {
  if (isTrusted(root, env)) return false;
  const rest = entries(env).filter((e) => e.path !== key(root));
  fs.mkdirSync(path.dirname(file(env)), { recursive: true });
  fs.writeFileSync(file(env), `${JSON.stringify({ projects: [...rest, { path: key(root), git: gitHash(gitSection(root)) }] }, null, 2)}\n`);
  return true;
}

module.exports = { isTrusted, trustState, trust };
