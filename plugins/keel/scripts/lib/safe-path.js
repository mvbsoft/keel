'use strict';
// Checks before keel moves or writes a file under the project: the path stays inside the project, out
// of .git, and no link on the way leads elsewhere (.keel, .keel/local or a folder below it made a
// junction would carry markers, trash batches and restored folders out of the project). Every write
// under .keel/local goes through safeLocalPath.
const fs = require('node:fs');
const path = require('node:path');

const realPath = (p) => fs.realpathSync.native(p);
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

// Why writing `file` (under the project) could follow a link out of the project, or null. Parts that
// do not exist yet are made by keel itself.
function linkOnWay(root, file) {
  let at = root;
  let last = root;
  for (const part of path.relative(root, file).split(path.sep)) {
    if (!part) continue;
    at = path.join(at, part);
    let st;
    try { st = fs.lstatSync(at); } catch { break; }
    if (st.isSymbolicLink()) return `${rel(root, at)} is a link`;
    last = at;
  }
  try {
    return samePath(realPath(last), path.join(realPath(root), path.relative(root, last))) ? null : `a folder on the way to ${rel(root, file)} is a link`;
  } catch { return null; }
}

// Why a project-relative path from a manifest or a list must not be moved, or null: it must be
// relative, without "..", outside .git, inside the project and with no link above it.
function unsafeRel(root, relPath) {
  if (typeof relPath !== 'string' || !relPath || relPath.includes('\0')) return 'not a path';
  const parts = relPath.split(/[\\/]/);
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath) || /^[A-Za-z]:/.test(relPath)) return 'not a relative path';
  if (parts.includes('..')) return 'contains ..';
  if (parts.some((p) => p.toLowerCase() === '.git')) return 'inside .git';
  const full = path.resolve(root, relPath);
  const r = path.relative(path.resolve(root), full);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return 'outside the project';
  // The item itself may be a link (renaming moves the link); a link above it would lead elsewhere.
  return linkOnWay(root, path.dirname(full));
}

// Why keel's local folder (.keel/local) cannot take a write, or null.
const localLink = (root) => linkOnWay(root, path.join(root, '.keel', 'local', 'x'));

// The path of `parts` under .keel/local for keel to write, create, move or remove. Throws when a link
// is anywhere on the way, the last part included: a junction below .keel/local (tmp/, trash/, finish/)
// or a linked file (last-verify.json) would carry the write out of the project.
function safeLocalPath(root, ...parts) {
  const file = path.join(root, '.keel', 'local', ...parts);
  const r = path.relative(path.join(root, '.keel', 'local'), file);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${rel(root, file)} is outside .keel/local`);
  const why = linkOnWay(root, file);
  if (why) throw new Error(`${why}: keel does not write through it`);
  return file;
}

// Writes (or appends) text to a file under .keel/local after safeLocalPath; returns its path.
function safeLocalWrite(root, parts, text, { append = false } = {}) {
  const file = safeLocalPath(root, ...[].concat(parts));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (append) fs.appendFileSync(file, text); else fs.writeFileSync(file, text);
  return file;
}

module.exports = { realPath, samePath, linkOnWay, unsafeRel, localLink, safeLocalPath, safeLocalWrite };
