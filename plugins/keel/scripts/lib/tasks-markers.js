'use strict';
// Active markers: which task each session works on (lib/tasks.js).
const fs = require('node:fs');
const path = require('node:path');
const { safeLocalPath, safeLocalWrite } = require('./safe-path.js');
const { validId, validSid: validSession } = require('./ids.js');
const { mainOf } = require('./project-dir.js');
const { treeTask, findTask } = require('./tasks-store.js');

// An active marker younger than this may belong to a session that is still open.
const FRESH_MS = 24 * 60 * 60 * 1000;

// A marker is keyed by session and kept in the main checkout (lib/project-dir.js): it holds wherever the
// chat works, and every worktree sees the tasks another session works on.
const activeDir = (root) => path.join(mainOf(root), '.keel', 'local', 'active');

function markers(root) {
  let names = [];
  try { names = fs.readdirSync(activeDir(root)).filter((n) => n.endsWith('.json')); } catch { /* none */ }
  const out = [];
  for (const name of names) {
    try {
      const file = path.join(activeDir(root), name);
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      out.push({ session: name.slice(0, -5), id: m.id, root: typeof m.root === 'string' ? m.root : null, at: fs.statSync(file).mtimeMs });
    } catch { /* unreadable marker: ignored */ }
  }
  return out;
}

// This session's marker with a valid task id, or null. It counts even when the task's file cannot be
// seen from this folder (not committed yet, in another checkout).
function sessionMarker(root, sid) {
  if (!validSession(sid)) return null;
  return markers(root).find((m) => m.session === sid && validId(m.id)) || null;
}

// The task this session works on, or null (no marker, or its task is gone).
function activeTask(root, sid) {
  if (!validSession(sid)) return null;
  const mark = markers(root).find((m) => m.session === sid);
  return mark && validId(mark.id) ? treeTask(root, mark.id) || findTask(root, mark.id) : null;
}

// The tasks some session marked active within FRESH_MS whose folder is in this working tree: someone may
// be working on them now.
function busyTasks(root, now = Date.now()) {
  return [...new Set(markers(root).filter((m) => now - m.at < FRESH_MS && validId(m.id) && treeTask(root, m.id)).map((m) => m.id))];
}

function setMarker(root, sid, id) {
  safeLocalWrite(mainOf(root), ['active', `${sid}.json`], JSON.stringify({ id, root: path.resolve(root) }) + '\n');
}

function clearMarkers(root, match) {
  safeLocalPath(mainOf(root), 'active');
  for (const m of markers(root)) if (match(m)) fs.rmSync(safeLocalPath(mainOf(root), 'active', `${m.session}.json`), { force: true });
}

module.exports = { FRESH_MS, markers, sessionMarker, activeTask, busyTasks, setMarker, clearMarkers };
