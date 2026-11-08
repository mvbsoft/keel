'use strict';
// The project folder keel works on. Claude Code gives hooks and commands CLAUDE_PROJECT_DIR (and with it
// <project>) as the folder the session started in. In a worktree session of the desktop app, and after
// Claude enters a worktree during a session, that is still the main checkout, while the session works
// in a linked worktree of it. keel then takes the worktree for this session's state and git, so parallel
// sessions keep their notes, state and commits apart; what this machine shares between conversations
// (planning drafts and settings, briefs, local tasks, the trash, keel's options) stays in the main checkout
// (mainOf), because a worktree belongs to one conversation and is deleted with it. Only files are read,
// no git process: hooks run this on every tool call.
const fs = require('node:fs');
const path = require('node:path');
const { samePath } = require('./safe-path.js');

const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const exists = (p) => { try { fs.statSync(p); return true; } catch { return false; } };
const slashes = (p) => p.replace(/\\/g, '/');

// The nearest folder at or above `dir` that holds a .git (folder or file), or null.
function repoTop(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (exists(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

// The main checkout of the linked worktree whose top is `dir`, or null. A linked worktree's .git is a
// file "gitdir: <main>/.git/worktrees/<name>"; that folder's commondir leads back to <main>/.git and its
// gitdir file names this .git, so a .git file copied elsewhere does not count. A submodule's gitdir has
// no commondir.
// shortcut: a main checkout whose .git is a file (git init --separate-git-dir) or a bare repository is
// not recognised, so keel stays on the folder it was given; redo when such a project needs worktrees.
function linkedMain(dir) {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(read(path.join(dir, '.git')) || '');
  if (!m) return null;
  const gitDir = path.resolve(dir, m[1]);
  const common = read(path.join(gitDir, 'commondir'));
  const back = read(path.join(gitDir, 'gitdir'));
  if (!common || !back || !samePath(real(path.resolve(gitDir, back.trim())), real(path.join(dir, '.git')))) return null;
  const commonDir = real(path.resolve(gitDir, common.trim()));
  return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : null;
}

// The folder of the linked worktree of `root`'s repository that `cwd` lies in and that stands for `root`
// (the worktree's top, or the same sub-folder when `root` is a sub-folder of its repository), or null:
// cwd in root's own checkout, in another repository or in a worktree of another one. A nested
// repository or a submodule on the way up is passed by.
function worktreeOf(root, cwd) {
  if (typeof root !== 'string' || !root || typeof cwd !== 'string' || !cwd) return null;
  const top = repoTop(root);
  if (!top) return null;
  const ownGit = real(path.join(top, '.git'));
  const mainTop = real(top);
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (exists(path.join(dir, '.git'))) {
      if (samePath(real(path.join(dir, '.git')), ownGit)) return null;
      const main = linkedMain(dir);
      if (main && samePath(main, mainTop)) {
        const mapped = path.join(dir, path.relative(top, path.resolve(root)));
        return exists(mapped) ? mapped : null;
      }
    }
    if (path.dirname(dir) === dir) return null;
  }
}

// The folder in the main checkout that `dir` stands for when it lies in a linked worktree, else `dir`.
function mainOf(dir) {
  const top = repoTop(dir);
  const main = top && linkedMain(top);
  return main ? path.join(main, path.relative(top, path.resolve(dir))) : dir;
}

const inside = (dir, file) => { const r = path.relative(path.resolve(dir), path.resolve(file)); return !r.startsWith('..') && !path.isAbsolute(r); };

// A path the caller built from `given` (the main checkout), at the same place in `project` (the
// worktree of it keel works on); a path already in `project`, or elsewhere, stays as it is.
function sameIn(given, project, file) {
  if (typeof file !== 'string' || inside(project, file) || !inside(given, file)) return file;
  return path.join(project, path.relative(path.resolve(given), path.resolve(file)));
}

// A hook's project:CLAUDE_PROJECT_DIR (else the hook's cwd), or the worktree of it the cwd is in.
function hookProject(input) {
  const cwd = input && typeof input.cwd === 'string' ? input.cwd : undefined;
  const given = process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
  return worktreeOf(given, cwd) || given;
}

// A script's project: its first argument (else CLAUDE_PROJECT_DIR, else the shell's folder), or the
// worktree of it the shell works in. The worktree is named on stderr, so the model uses it from then on.
function scriptProject(given) {
  const root = path.resolve(given || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const wt = worktreeOf(root, process.cwd());
  if (!wt) return root;
  process.stderr.write(`project: ${slashes(wt)} (a worktree of ${slashes(root)}; keel works here: use it as <project>)\n`);
  return wt;
}

module.exports = { worktreeOf, mainOf, sameIn, hookProject, scriptProject };
