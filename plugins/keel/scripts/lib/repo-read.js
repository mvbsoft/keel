'use strict';
// Small read-only helpers shared by notes.js and lib/tasks.js: git output, file text, the front
// matter of a note or task file.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { noBom } = require('./json.js');

// Trimmed stdout of `git -C root <args>`, or null when git fails. `input` goes to git's stdin.
function git(root, args, input) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch { return null; }
}

function read(file) {
  try { return noBom(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// "key: value" lines of a leading --- block.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || '');
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const count = (root, range) => Number(git(root, ['rev-list', '--count', range]));

// The freshest known version of a branch (remote first), or null.
function freshRef(root, branch) {
  const remotes = (git(root, ['remote']) || '').split('\n').filter(Boolean);
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  if (remote && git(root, ['rev-parse', '-q', '--verify', `refs/remotes/${remote}/${branch}`])) return `${remote}/${branch}`;
  return git(root, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`]) ? branch : null;
}

// One line for the terminal: control characters (ESC and the like, bidi overrides) out, at most `max`.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
function clean(value, max = 160) {
  const s = String(value).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = { git, read, noBom, frontmatter, count, freshRef, clean };
