'use strict';
// keel's tasks. One task = one folder, from start until finished.
// - Where: .keel/tasks/<id>/ (goes into git, so it travels with the task branch), or
//   .keel/local/tasks/<id>/ when config `tasks.in_git` is false. The folder holds task.md (ticket, state
//   and handoff in one file) and plan.md when the plan is big. Listing also reads every local and
//   remote-tracking branch, because a handed-off task is committed on its own branch and is absent
//   from the base branch. Only folders count: any other file in .keel/tasks (a README) is not a task.
// - Which task a session works on: .keel/local/active/<session id>.json = { "id": "<task id>" }, in the
//   main checkout of a linked worktree.
// - A finished or dropped task's folder goes to keel's trash (restorable until
//   cleanup.trash_max_age_days) and is noted in .keel/local/closed-tasks.json, so a stale copy
//   on another branch is not listed again.
// Nothing here prints a task file's text beyond the fields `taskList` shows.
// The parts: tasks-store.js (where the files are, listing, the closed record), tasks-text.js (reading a
// task file), tasks-markers.js (active markers), tasks-list.js (what /keel:tasks shows). This file makes
// and closes tasks, and callers require only it.
const fs = require('node:fs');
const path = require('node:path');
const { planAllowed } = require('../plan-steps.js');
const { moveToTrash, listBatches, restore, fromHere } = require('./trash.js');
const { git, clean, validBranchName } = require('./repo-read.js');
const { isSecretName } = require('./secret-names.js');
const { secretCheck } = require('./project.js');
const { realPath, samePath, linkOnWay } = require('./safe-path.js');
const { readFinish, writeFinish, clearFinish, ownItem } = require('./finish.js');
const { validId, validSid: validSession } = require('./ids.js');
const { mainOf } = require('./project-dir.js');
const {
  TASK_FILE, PLAN_FILE, sameId, rel, dateOf, refuse, settings, sharedRoot, localRoot, treeDirs, treeTasks, readBlobs, readClosed,
  localRefusal, writeClosed, closedEntry, forget, markClosed, listTasks, findTask, needTree, location, plainFiles,
} = require('./tasks-store.js');
const { oneLine, sections, setFront, stepCounts, planText } = require('./tasks-text.js');
const { sessionMarker, activeTask, busyTasks, setMarker, clearMarkers } = require('./tasks-markers.js');
const { summaryLine, taskList, taskInventory } = require('./tasks-list.js');

const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'keel', 'task.md');
const SOURCES = ['jira', 'linear', 'asana', 'github', 'file', 'text'];
const EXECUTIONS = ['here', 'delegate', 'fresh'];
const MAX_PLAN = 200 * 1024;

// --- commands that change things ---

// A plan file to copy into a task folder: a plain text file (not a link, no link on the way inside the
// project) of up to MAX_PLAN bytes. { text, from } or { refusal }.
function readPlanFile(root, file) {
  if (typeof file !== 'string' || !file) return { refusal: '--plan-file needs a path' };
  const full = path.resolve(root, file);
  const shown = clean(file);
  let st;
  try { st = fs.lstatSync(full); } catch { return { refusal: `--plan-file ${shown} does not exist` }; }
  if (st.isSymbolicLink()) return { refusal: `--plan-file ${shown} is a link` };
  const inside = path.relative(root, full);
  const linked = inside.startsWith('..') || path.isAbsolute(inside) ? null : linkOnWay(root, full);
  if (linked) return { refusal: `--plan-file: ${linked}` };
  if (!planAllowed(root, full)) return { refusal: `--plan-file ${shown} must be inside the project or in Claude Code's plans folder` };
  const named = (inside.startsWith('..') || path.isAbsolute(inside) ? path.basename(full) : inside).split(path.sep).join('/');
  if (isSecretName(named, { strict: true }) || secretCheck(root).isSecret(named)) return { refusal: `--plan-file ${shown} is a secret file` };
  if (!st.isFile()) return { refusal: `--plan-file ${shown} is not a file` };
  if (st.size > MAX_PLAN) return { refusal: `--plan-file ${shown} is over ${MAX_PLAN / 1024} KB` };
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { return { refusal: `--plan-file ${shown} cannot be read: ${e.message}` }; }
  if (text.includes('\0')) return { refusal: `--plan-file ${shown} is not a text file` };
  if (text.includes('�')) return { refusal: `--plan-file ${shown} is not UTF-8 text` };
  return { text, from: shown };
}

// The skeleton: the template without its comments, the front matter filled from the arguments.
function taskNew(root, id, o, now = new Date()) {
  if (!validId(id)) return refuse('task new', `invalid id "${clean(String(id))}": letters, digits, . _ -, at most 80 characters, starting with a letter or digit, no "..", not ending with ".", not a Windows device name (CON, NUL, COM1...)`);
  if (typeof o.title !== 'string' || !oneLine(o.title)) return refuse('task new', 'needs --title');
  if (!SOURCES.includes(o.source)) return refuse('task new', `--source must be one of ${SOURCES.join(', ')}`);
  if (o.session !== undefined && !validSession(o.session)) return refuse('task new', 'invalid --session');
  const picked = {};
  for (const [flag, field] of [['branch', 'branch'], ['base', 'base'], ['merge-into', 'mergeInto']]) {
    const v = o[field];
    if (v === undefined) continue;
    if (typeof v !== 'string') return refuse('task new', `--${flag} needs a value`);
    // "-" is the template's "none".
    if (v !== '-' && !validBranchName(root, v)) return refuse('task new', `--${flag} "${clean(v)}" is not a valid branch name`);
    picked[field] = v;
  }
  if (o.execution !== undefined && !EXECUTIONS.includes(o.execution)) return refuse('task new', `--execution must be one of ${EXECUTIONS.join(', ')}`);
  let plan = null;
  if (o.planFile !== undefined) {
    plan = readPlanFile(root, o.planFile);
    if (plan.refusal) return refuse('task new', plan.refusal);
  }
  const local = localRefusal(root, 'task new');
  if (local) return local;
  const old = findTask(root, id);
  if (old) return refuse('task new', `task ${old.id} already exists (${location(root, old)})`);
  for (const dir of treeDirs(root)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* none */ }
    const taken = names.find((n) => sameId(n, id));
    if (taken) return refuse('task new', `${rel(root, path.join(dir, taken))} exists (ids compare without case)`);
  }
  const folder = path.join(treeDirs(root)[0], id);
  // Local tasks live in the main checkout, tasks in git in this folder: links are checked in the one that holds it.
  const linked = linkOnWay(treeDirs(root)[0] === localRoot(root) ? mainOf(root) : root, path.join(folder, TASK_FILE));
  if (linked) return refuse('task new', linked);
  const { main } = settings(root);
  const today = dateOf(now);
  const title = oneLine(o.title);
  // The commit the task started from: `git diff <started>` is the task's work, also on a branch shared
  // with others, whose commits come in by sync.
  const started = git(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']) || '-';
  const front = {
    id, title, source: o.source, link: typeof o.link === 'string' && oneLine(o.link) ? oneLine(o.link) : '-', status: 'active',
    branch: picked.branch || '-', base: picked.base || main || '-', merge_into: picked.mergeInto || main || '-', execution: o.execution || 'here', plan: plan ? PLAN_FILE : 'inline',
    created: today, updated: today, after_commit: '-', started,
  };
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->\s*/g, '');
  const body = template.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart().replace(/^# .*$/m, () => `# ${id}: ${title}`);
  // A task made again after it was finished or dropped is a new one: its branch copies count again.
  // Before the folder, so a closed-tasks.json that cannot be written leaves nothing half made.
  try {
    if (closedEntry(readClosed(root), id)) writeClosed(root, (c) => forget(c, id));
  } catch (e) { return refuse('task new', e.message); }
  fs.mkdirSync(folder, { recursive: true });
  try {
    if (plan) fs.writeFileSync(path.join(folder, PLAN_FILE), plan.text);
    fs.writeFileSync(path.join(folder, TASK_FILE), `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`);
  } catch (e) {
    fs.rmSync(folder, { recursive: true, force: true });
    return refuse('task new', `could not write the task folder: ${e.message}`);
  }
  const out = [`created: ${rel(root, path.join(folder, TASK_FILE))}`, `folder: ${rel(root, folder)}/ (a big plan goes into ${PLAN_FILE} here)`, 'status: active'];
  if (plan) out.push(`plan: ${PLAN_FILE} (copied from ${plan.from})`);
  if (o.session) { setMarker(root, o.session, id); out.push(`active task: ${id}`); }
  return out;
}

function taskActivate(root, id, sid, now = new Date()) {
  if (!validSession(sid)) return refuse('task activate', 'needs --session <id>');
  const local = localRefusal(root, 'task activate');
  if (local) return local;
  const { t: found, why } = needTree(root, id, 'task activate');
  if (!found) return why;
  const text = setFront(found.text, { status: 'active', updated: dateOf(now) });
  if (text === null) return refuse('task activate', `${rel(root, found.file)} has no front matter (the --- block with id, status...): add it from the template, then activate again`);
  const linked = linkOnWay(root, found.file);
  if (linked) return refuse('task activate', linked);
  fs.writeFileSync(found.file, text);
  setMarker(root, sid, found.id);
  return [`active task: ${found.id}`, `file: ${rel(root, found.file)}`];
}

function taskDeactivate(root, sid) {
  if (!validSession(sid)) return refuse('task deactivate', 'needs --session <id>');
  const local = localRefusal(root, 'task deactivate');
  if (local) return local;
  clearMarkers(root, (m) => m.session === sid);
  return ['active task: none'];
}

const isTracked = (root, target) => git(root, ['ls-files', '--error-unmatch', '--', rel(root, target)]) !== null;
const TRACKED_NOTE = 'it was tracked in git: the removal is a change in the next commit';

// Why `target` must not be deleted as task `id`, or null when it is exactly that task's own folder
// under one of keel's two task folders, with no link anywhere on the way.
function unsafeTarget(root, t) {
  const base = t.local ? localRoot(root) : sharedRoot(root);
  const target = t.folder;
  const expected = path.join(base, t.id);
  if (!validId(t.id) || !target || path.resolve(target) !== path.resolve(expected)) return 'not the task\'s own path';
  let st;
  try { st = fs.lstatSync(target); } catch { return 'it is gone'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'it is a link or not a plain folder';
  // .keel, .keel/tasks or .keel/local may be links that lead out of the project. A local task is in the
  // main checkout, a task in git in this folder.
  const home = t.local ? mainOf(root) : root;
  const real = path.join(realPath(home), path.relative(home, expected));
  if (!samePath(realPath(target), real)) return 'a folder on its path is a link';
  return null;
}

// A finished task's folder, or a dropped one, goes to keel's trash: deleting comes before git, and a
// git step that stops (refused push, conflict, red gates) must not lose a task that was never committed.
function toTrash(root, id, sid, what, guard = () => null) {
  if (sid !== undefined && !validSession(sid)) return { why: refuse(what, 'invalid --session') };
  const local = localRefusal(root, what);
  if (local) return { why: local };
  const { t, why } = needTree(root, id, what);
  if (!t) return { why };
  const unsafe = unsafeTarget(root, t);
  if (unsafe) return { why: refuse(what, unsafe) };
  const target = t.folder || t.file;
  // Moving one copy would bring the other back into the list; the user decides which one is the task.
  const others = idEntries(root, t.id).filter((p) => p !== rel(root, target));
  if (others.length) return { why: refuse(what, `${[rel(root, target), ...others].join(' and ')} both hold task ${t.id}: keep one (move or merge the other by hand), then run this again`) };
  if (t.folder && plainFiles(target) === null) return { why: refuse(what, 'the folder holds a link') };
  const blocked = guard(t);
  if (blocked) return { why: refuse(what, blocked) };
  const tracked = isTracked(root, target);
  const r = moveToTrash(root, [rel(root, target)], 'task');
  if (!r.batch) return { why: refuse(what, `could not move it: ${r.failed.map((f) => f.reason).join(', ')}`) };
  try {
    markClosed(root, t);
    // A task in git keeps its folder in the other checkouts: only the markers set in this one go.
    clearMarkers(root, (m) => sameId(m.id, t.id) && (t.local || !m.root || samePath(path.resolve(m.root), path.resolve(root))));
  } catch (e) {
    // Half a step is worse than none: the folder goes back.
    restore(root, r.batch);
    try { writeClosed(root, (c) => forget(c, t.id)); } catch { /* never written */ }
    return { why: refuse(what, `${e.message}; the folder was put back`) };
  }
  return { t, target, batch: r.batch, tracked };
}

// Only work whose verification is recorded (fingerprint.js save, also --tier none) is finished; in
// autonomous git the finish is recorded for the session until a commit holds it or it is restored
// (lib/finish.js, hooks/finish-check.js).
function verifiedGuard(root) {
  const why = require('../fingerprint.js').unverified(root);
  if (!why) return null;
  const fp = path.join(__dirname, '..', 'fingerprint.js');
  return `${why}: finish the verification first (it ends with fingerprint.js save --tier <level>); when the user chose no verification, run node "${fp}" "${root}" save --tier none; then run task delete again`;
}

function taskDelete(root, id, sid) {
  const record = sid !== undefined && settings(root).mode === 'autonomous';
  let recorded = false;
  // The finish record comes before the move: a finish that cannot be recorded does not start.
  const guard = (task) => {
    const notVerified = verifiedGuard(root);
    if (notVerified || !record) return notVerified;
    try { writeFinish(root, sid, task.id, 'deleted'); recorded = true; return null; } catch (e) { return `the finish record cannot be written: ${e.message}`; }
  };
  const { why, t, target, batch, tracked } = toTrash(root, id, sid, 'task delete', guard);
  if (why) {
    if (recorded) clearFinish(root, sid);
    return why;
  }
  return [`deleted: ${rel(root, target)}${t.folder ? '/' : ''} (moved to keel's trash)`, `trash batch: ${batch}`, 'active task: none', ...(tracked ? [TRACKED_NOTE] : [])];
}

// The working-tree folders that hold task `id` in either tasks folder, any case.
function idEntries(root, id) {
  const out = [];
  for (const dir of [sharedRoot(root), localRoot(root)]) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
    for (const e of entries) {
      if (!e.isFile() && sameId(e.name, id)) out.push(rel(root, path.join(dir, e.name)));
    }
  }
  return out.sort();
}

// Undoes `task delete` when the finish's git step did not complete: the task's own folder from the
// newest trash batch that holds it goes back (nothing else of that batch), the task is no longer closed
// and is active again for the session.
function taskRestore(root, id, sid, now = new Date()) {
  if (!validId(id)) return refuse('task restore', 'invalid id');
  if (!validSession(sid)) return refuse('task restore', 'needs --session <id>');
  const local = localRefusal(root, 'task restore');
  if (local) return local;
  // The trash is shared by the worktrees: only a copy this folder dropped comes back here.
  const own = (i) => ownItem(i, id) && fromHere(root, i);
  const b = listBatches(root).filter((x) => x.by === 'task' && x.items.some(own)).pop();
  if (!b) return refuse('task restore', `no trash batch holds ${id}`);
  const taken = idEntries(root, id);
  if (taken.length) return refuse('task restore', `${taken.join(', ')} already holds the id ${id} (ids compare without case): the trash batch ${b.batch} stays as it is`);
  // The closed record changes first: when it cannot be written, the folder stays in the trash.
  const was = closedEntry(readClosed(root), id);
  try { writeClosed(root, (c) => forget(c, id)); } catch (e) { return refuse('task restore', `${e.message}; the trash batch ${b.batch} stays as it is`); }
  const r = restore(root, b.batch, own);
  if (r.refused || !r.restored.length) {
    try { if (was) writeClosed(root, (c) => { c[id] = was; }); } catch { /* the task then lists again; the batch still holds it */ }
    return refuse('task restore', r.refused || `nothing put back: ${r.kept.map((k) => `${k.path} (${k.reason})`).join(', ')}`);
  }
  const pending = readFinish(root, sid);
  if (pending && sameId(pending.id, id)) clearFinish(root, sid);
  return [`restored: ${r.restored.map((i) => i.path).join(', ')} (trash batch ${b.batch})`, ...taskActivate(root, id, sid, now)];
}

function taskDrop(root, id) {
  const { why, t, batch, tracked } = toTrash(root, id, undefined, 'task drop');
  if (why) return why;
  return [`dropped: ${t.id}`, `trash batch: ${batch} (/keel:cleanup restore ${batch} puts it back)`, ...(tracked ? [TRACKED_NOTE] : [])];
}

module.exports = {
  validId, readBlobs, listTasks, treeTasks, findTask, activeTask, sessionMarker, busyTasks, summaryLine, taskList, taskNew, taskActivate, taskDeactivate,
  taskDelete, taskRestore, taskDrop, taskInventory, sections, setFront, stepCounts, planText, readClosed, dateOf,
};
