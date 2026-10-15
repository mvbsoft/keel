'use strict';
// The record of a finish in progress, one file per session: .keel/local/finish/<session id>.json
// { id, state, at }. `task delete` writes state `deleted` (autonomous git only: in manual mode keel runs
// no git) before it moves the folder; a git-flow commit turns it into `committed`; a restore or a push
// after that commit removes it. The Stop hook (hooks/finish-check.js) keeps the model working while a
// session's record says `deleted`, for at most a day and only while keel's trash still holds the task.
const fs = require('node:fs');
const path = require('node:path');
const { safeLocalPath } = require('./safe-path.js');
const { validId, validSid } = require('./ids.js');

const STALE_MS = 24 * 60 * 60 * 1000;
// A record dated in the future is planted or from a broken clock: a few minutes of clock skew at most.
const SKEW_MS = 5 * 60 * 1000;
const file = (root, sid) => safeLocalPath(root, 'finish', `${sid}.json`);

function readFinish(root, sid) {
  if (!validSid(sid)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(root, '.keel', 'local', 'finish', `${sid}.json`), 'utf8'));
    return r && validId(r.id) && typeof r.state === 'string' ? r : null;
  } catch { return null; }
}

// Throws when the record cannot be written (a link on the way, a full disk): a finish that cannot be
// recorded must not start.
function writeFinish(root, sid, id, state) {
  if (!validSid(sid) || !validId(id)) throw new Error('invalid session or task id');
  const f = file(root, sid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify({ id, state, at: new Date().toISOString() })}\n`);
}

function clearFinish(root, sid) {
  if (!validSid(sid)) return;
  try { fs.rmSync(file(root, sid)); } catch { /* none, or behind a link */ }
}

// A commit stages every change of the tree, so every finish waiting for one is now committed.
function markCommitted(root) {
  let names = [];
  try { names = fs.readdirSync(safeLocalPath(root, 'finish')).filter((n) => n.endsWith('.json')); } catch { return; }
  for (const n of names) {
    const sid = n.slice(0, -5);
    const r = readFinish(root, sid);
    if (r && r.state === 'deleted') { try { writeFinish(root, sid, r.id, 'committed'); } catch { /* left as it was */ } }
  }
}

// A trash item that is exactly this task's own folder under one of keel's two tasks folders. The
// folder name is compared whole: an id may itself end in ".md".
function ownItem(item, id) {
  if (!item || typeof item.path !== 'string') return false;
  const m = /^\.keel\/(?:local\/)?tasks\/([^/]+)$/.exec(item.path);
  return !!m && item.kind === 'folder' && m[1].toLowerCase() === id.toLowerCase();
}

// The session's finish that still waits for a commit, or null: a record older than a day, or one whose
// task is no longer in keel's trash (restored by hand, the trash emptied), no longer holds the session.
function pendingFinish(root, sid, now = Date.now()) {
  const r = readFinish(root, sid);
  if (!r || r.state !== 'deleted') return null;
  const at = Date.parse(r.at);
  if (!Number.isFinite(at) || now - at > STALE_MS || at - now > SKEW_MS) return null;
  const { listBatches } = require('./trash.js');
  return listBatches(root).some((b) => b.by === 'task' && b.items.some((i) => ownItem(i, r.id))) ? r : null;
}

module.exports = { readFinish, writeFinish, clearFinish, markCommitted, pendingFinish, ownItem, validSid };
