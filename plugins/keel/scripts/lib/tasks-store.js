'use strict';
// Where task files are, the tasks of the working tree and of every branch, and the record of closed tasks (lib/tasks.js).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkConfig } = require('./config.js');
const { git, read, noBom, frontmatter, clean } = require('./repo-read.js');
const { localLink, safeLocalReplace, withLocalLock } = require('./safe-path.js');
const { validId } = require('./ids.js');
const { mainOf } = require('./project-dir.js');

const TASK_FILE = 'task.md';
const PLAN_FILE = 'plan.md';

// Ids compare without case: on Windows and macOS Foo and foo are one folder.
const key = (id) => String(id).toLowerCase();
const sameId = (a, b) => key(a) === key(b);
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const pad = (n) => String(n).padStart(2, '0');
const dateOf = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const refuse = (what, why) => [`notes: ${what} refused (${why})`];

function settings(root) {
  const { state, config } = checkConfig(root);
  return { main: state === 'ok' ? config.git.main_branch : null, mode: state === 'ok' ? config.git.mode : null, inGit: !(config && config.tasks && config.tasks.in_git === false) };
}

const sharedRoot = (root) => path.join(root, '.keel', 'tasks');
// Local tasks and the closed record are this machine's: for a linked worktree, the main checkout's
// (lib/project-dir.js), so another worktree session sees them and they outlive the worktree.
const localRoot = (root) => path.join(mainOf(root), '.keel', 'local', 'tasks');

// Working-tree folders, the configured one first; the other is still read, so switching
// `tasks.in_git` does not hide a task that is in flight.
function treeDirs(root) {
  return settings(root).inGit ? [sharedRoot(root), localRoot(root)] : [localRoot(root), sharedRoot(root)];
}

const currentBranch = (root) => git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);

// The tasks in one tasks folder: <id>/task.md. Links are skipped: a task folder is always a real
// folder keel made.
function tasksIn(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
  const found = [];
  for (const e of entries) {
    if (e.isDirectory()) found.push({ id: e.name, folder: path.join(dir, e.name), file: path.join(dir, e.name, TASK_FILE) });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function treeTasks(root) {
  const seen = new Set();
  const out = [];
  const branch = currentBranch(root);
  for (const dir of treeDirs(root)) {
    const local = dir === localRoot(root);
    for (const f of tasksIn(dir)) {
      const text = validId(f.id) && !seen.has(key(f.id)) ? read(f.file) : null;
      if (text === null) continue;
      seen.add(key(f.id));
      out.push({ ...f, text, fm: frontmatter(text), planText: f.folder ? read(path.join(f.folder, PLAN_FILE)) : null, local, ref: null, where: local ? 'this machine only' : branch ? `${branch} (working tree)` : 'working tree' });
    }
  }
  return out;
}

// The task files of one committed .keel/tasks tree: id -> { task, plan } (blob shas).
// --full-tree: from a sub-folder of the repository, ls-tree would list only the paths under that folder.
function treeFiles(root, tree) {
  const found = new Map();
  for (const line of (git(root, ['ls-tree', '-r', '--full-tree', tree]) || '').split('\n')) {
    // Git modes of regular files (100644, 100755); a committed link (120000) is never read as a task.
    const m = /^100(?:644|755) blob ([0-9a-f]+)\t([^/]+)\/(task|plan)\.md$/.exec(line);
    if (!m || !validId(m[2])) continue;
    const f = found.get(m[2]) || {};
    f[m[3]] = m[1];
    found.set(m[2], f);
  }
  return found;
}

// The text of each blob, read by one `git cat-file --batch` (one process per blob took 30 s with 400
// branches). Its output is "<sha> blob <bytes>\n<content>\n" per blob, so it is cut by bytes.
function readBlobs(root, shas) {
  const out = new Map();
  if (!shas.length) return out;
  let buf;
  try {
    buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: shas.map((s) => `${s}\n`).join(''), stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return out; }
  let at = 0;
  for (const sha of shas) {
    // 0x0a: the newline byte ("\n") that ends each blob's header line.
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const head = /^([0-9a-f]+) (\S+) (\d+)$/.exec(buf.toString('utf8', at, nl));
    if (!head) { at = nl + 1; continue; }
    const size = Number(head[3]);
    if (head[2] === 'blob') out.set(sha, noBom(buf.toString('utf8', nl + 1, nl + 1 + size)));
    at = nl + 1 + size + 1;
  }
  return out;
}

// Tasks committed on any local or remote-tracking branch. Branches mostly share commits or the same
// .keel/tasks tree, so one `cat-file --batch-check` finds every tree, then one `ls-tree` per distinct
// tree and one `cat-file --batch` for every distinct blob. `./` makes the path relative to the project
// folder, which may be a sub-folder of the repository.
function refTasks(root) {
  if (!settings(root).inGit || git(root, ['rev-parse', '--git-dir']) === null) return [];
  const refs = (git(root, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n')
    .map((l) => /^([0-9a-f]+) (\S+)$/.exec(l)).filter((m) => m && !/^refs\/remotes\/[^/]+\/HEAD$/.test(m[2]));
  if (!refs.length) return [];
  const commits = [...new Set(refs.map((m) => m[1]))];
  const answers = (git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], commits.map((c) => `${c}:./.keel/tasks\n`).join('')) || '').split('\n');
  const treeOf = new Map(commits.map((c, i) => [c, (/^([0-9a-f]+) tree$/.exec(answers[i] || '') || [])[1] || null]));
  const trees = new Map();
  for (const tree of treeOf.values()) if (tree && !trees.has(tree)) trees.set(tree, treeFiles(root, tree));
  const wanted = new Set();
  for (const files of trees.values()) for (const f of files.values()) { if (f.task) wanted.add(f.task); if (f.plan) wanted.add(f.plan); }
  const blobs = readBlobs(root, [...wanted]);
  const blob = (sha) => blobs.get(sha) ?? null;
  const out = [];
  for (const [, commit, ref] of refs) {
    const tree = treeOf.get(commit);
    if (!tree) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    for (const [id, f] of trees.get(tree)) {
      const text = f.task ? blob(f.task) : null;
      if (!text) continue;
      out.push({ id, folder: null, file: null, blob: f.task, text, fm: frontmatter(text), planText: f.plan ? blob(f.plan) : null, local: false, ref: name, where: name });
    }
  }
  return out;
}

const closedFile = (root) => path.join(mainOf(root), '.keel', 'local', 'closed-tasks.json');
// id -> { updated, blobs }: the closed task's `updated` and the blobs of its task file that branches
// held when it closed. A map without a prototype: an id may be "constructor".
function readClosed(root) {
  const out = Object.create(null);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(closedFile(root), 'utf8')); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!validId(id)) continue;
    out[id] = typeof v === 'string' ? { updated: v, blobs: [] } : { updated: String((v && v.updated) || ''), blobs: Array.isArray(v && v.blobs) ? v.blobs : [] };
  }
  return out;
}
// .keel or .keel/local made a link would carry markers, closed-tasks.json and trash batches out of
// the project: every command that writes there refuses first, and these writes check again.
const localRefusal = (root, what) => { const linked = localLink(root) || localLink(mainOf(root)); return linked ? refuse(what, `${linked}: keel does not write through it`) : null; };
function guardLocal(root) {
  const linked = localLink(root);
  if (linked) throw new Error(`${linked}: keel does not write through it`);
}
// Worktree sessions share closed-tasks.json: the read-change-write runs under a lock, and the new content
// replaces the file by rename (lib/safe-path.js).
function writeClosed(root, mutate) {
  const home = mainOf(root);
  guardLocal(home);
  withLocalLock(home, 'closed-tasks.json', () => {
    const closed = readClosed(root);
    mutate(closed);
    safeLocalReplace(home, 'closed-tasks.json', JSON.stringify(closed) + '\n');
  });
}
const closedEntry = (closed, id) => closed[Object.keys(closed).find((k) => sameId(k, id))] || null;
const forget = (closed, id) => { for (const k of Object.keys(closed)) if (sameId(k, id)) delete closed[k]; };
function markClosed(root, t) {
  const blobs = [...new Set(refTasks(root).filter((r) => sameId(r.id, t.id)).map((r) => r.blob))];
  writeClosed(root, (c) => { forget(c, t.id); c[t.id] = { updated: t.fm.updated || dateOf(new Date()), blobs }; });
}

// A branch copy of a closed task is stale when it was on a branch at closing time or is older. A copy
// of the same day that was not there is a new task with the same id, so it is listed.
function isStale(closed, t) {
  const c = closedEntry(closed, t.id);
  return Boolean(c) && (c.blobs.includes(t.blob) || (t.fm.updated || '') < c.updated);
}

// Unfinished tasks: the working tree and every branch, one per id (the newest `updated` wins; on a
// tie the working tree, then a local branch, then a remote one), newest first.
function listTasks(root) {
  const best = new Map();
  const closed = readClosed(root);
  const consider = (t) => {
    const cur = best.get(key(t.id));
    if (!cur || (t.fm.updated || '') > (cur.fm.updated || '')) best.set(key(t.id), t);
  };
  treeTasks(root).forEach(consider);
  refTasks(root).filter((t) => !isStale(closed, t)).forEach(consider);
  return [...best.values()].sort((a, b) => (b.fm.updated || '').localeCompare(a.fm.updated || '') || a.id.localeCompare(b.id));
}

const treeTask = (root, id) => (validId(id) ? treeTasks(root).find((t) => sameId(t.id, id)) || null : null);
const findTask = (root, id) => (validId(id) ? listTasks(root).find((t) => sameId(t.id, id)) || null : null);

// For commands that change the files: the task must be in this working tree.
function needTree(root, id, what) {
  if (!validId(id)) return { why: refuse(what, `invalid id "${clean(String(id))}"`) };
  const t = treeTask(root, id);
  if (t) return { t };
  const other = findTask(root, id);
  return { why: refuse(what, other ? `task ${id} is on branch ${other.where}: switch to it first` : `no task "${id}"`) };
}

// Where a task's files are, as the list shows it.
function location(root, t) {
  if (t.ref) return `.keel/tasks/${t.id}/ (on branch ${t.ref})`;
  const at = `${rel(root, t.folder)}/`;
  return t.local ? `${at} (this machine only)` : at;
}

// Every entry under a folder, or null when one of them is a link (deleting must never reach past it).
function plainFiles(folder, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (e.isSymbolicLink()) return null;
    if (e.isDirectory()) {
      const inner = plainFiles(path.join(folder, e.name), `${prefix}${e.name}/`);
      if (inner === null) return null;
      out.push(...inner);
    } else out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

module.exports = {
  TASK_FILE, PLAN_FILE, sameId, rel, dateOf, refuse, settings, sharedRoot, localRoot, treeDirs, currentBranch, treeTasks, readBlobs,
  readClosed, localRefusal, writeClosed, closedEntry, forget, markClosed, listTasks, treeTask, findTask, needTree, location, plainFiles,
};
