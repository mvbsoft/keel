'use strict';
// Lists project files without reading them. In a git repository git decides what is ignored
// (.gitignore, .git/info/exclude); elsewhere a walk skips well-known dependency and build folders.
// Ignored entries are listed separately (folders collapsed) only so secrets can be found by name.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MAX_FILES = 200000;

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function splitZ(out) {
  return out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'));
}

function walk(root, skipDirs) {
  const files = [];
  const stack = [''];
  while (stack.length && files.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!skipDirs.has(e.name)) stack.push(p); }
      else if (e.isFile()) files.push(p);
    }
  }
  return files;
}

// Returns { files, ignored, truncated, git }.
function listFiles(root, skipDirs) {
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inRepo && inRepo.trim() === 'true') {
    const tracked = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    const ignored = git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
    if (tracked !== null) {
      const files = [...new Set(splitZ(tracked))].filter((p) => !p.endsWith('/'));
      return { files: files.slice(0, MAX_FILES), ignored: ignored ? splitZ(ignored) : [], truncated: files.length > MAX_FILES, git: true };
    }
  }
  const files = walk(root, new Set(skipDirs));
  return { files, ignored: [], truncated: files.length >= MAX_FILES, git: false };
}

// git's three lists, folders collapsed for untracked and ignored ("dir/"): { tracked, untracked,
// ignored }, or null outside a git work tree.
function gitLists(root) {
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo || inRepo.trim() !== 'true') return null;
  const run = (args) => { const out = git(root, ['ls-files', '-z', ...args]); return out === null ? [] : splitZ(out); };
  return {
    tracked: run(['--cached']),
    untracked: run(['--others', '--exclude-standard', '--directory']),
    ignored: run(['--others', '--ignored', '--exclude-standard', '--directory']),
  };
}

// Bytes, files and the newest change time (ms) under a path (a file or a folder), without following
// links. Stops counting after `limit` folders and says so, so a huge data folder cannot stall the
// caller.
function sizeOf(full, limit = 20000) {
  let bytes = 0;
  let files = 0;
  let newest = 0;
  let seen = 0;
  const stack = [full];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (!st.isDirectory()) { bytes += st.size; files += 1; newest = Math.max(newest, st.mtimeMs); continue; }
    if (++seen > limit) return { bytes, files, newest, partial: true };
    let names;
    try { names = fs.readdirSync(p); } catch { continue; }
    for (const n of names) stack.push(path.join(p, n));
  }
  return { bytes, files, newest, partial: false };
}

// Whether a program can be found (with the Windows extensions in PATHEXT). Does not run it. A name with
// a slash is a path from `root` (./gradlew, .venv/bin/bandit); any other name is looked up on PATH.
function onPath(name, root = process.cwd()) {
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').toLowerCase().split(';')] : [''];
  const dirs = /[\\/]/.test(name) ? [root] : (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      try { if (fs.statSync(path.resolve(dir, name + ext)).isFile()) return true; } catch { /* not here */ }
    }
  }
  return false;
}

module.exports = { listFiles, gitLists, sizeOf, onPath, MAX_FILES };
