'use strict';
// Collects the change under verification from git: tracked changes against a base commit (staged and
// unstaged together) plus untracked files. Secret files are listed by path only: their content is never
// read and never reaches the diff that agents get. git cannot tell who created an untracked file, so
// the task start records them (untrackedSnapshot) and files that were there then, unchanged, are left
// out of the change.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_READ = 1024 * 1024;
const MAX_SNAPSHOT = 5000;
const MAX_UNTRACKED = 2000;

function git(dir, args, input) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// Base commit: merge base with `base` when given (a branch's whole work), else HEAD (uncommitted work).
// A repository without commits compares against the empty tree.
function resolveBase(root, base) {
  const head = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head) return { sha: EMPTY_TREE, label: 'empty repository' };
  if (!base) return { sha: head.trim(), label: 'HEAD' };
  const mb = git(root, ['merge-base', base, 'HEAD']);
  if (!mb) throw new Error(`cannot find a merge base with "${base}"`);
  return { sha: mb.trim(), label: `merge base with ${base}` };
}

// The one way keel asks git for a diff it parses. Prefixes are fixed because diff.noprefix and
// diff.mnemonicPrefix change them; --relative keeps a project folder inside a bigger repository to its own
// files with paths relative to it, like the untracked ones.
const diffArgs = (unified, sha) => ['-c', 'core.quotepath=off', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', '--relative', '-M', `--unified=${unified}`, sha];

const QUOTED = /^"(?:[^"\\]|\\.)*"/;
// A path in a diff header: quoted when it has special characters; unquoted with a space in it, git ends
// the `---`/`+++` line with a TAB. `prefix` is the a/ or b/ the diff was asked to use.
function headerPath(s, prefix) {
  const q = QUOTED.exec(s);
  let p;
  if (q) { try { p = JSON.parse(q[0]); } catch { p = q[0].slice(1, -1); } } else p = s.replace(/\t.*$/, '');
  return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

// The path of a file whose diff has no `---`/`+++` lines (binary, mode-only), from `diff --git a/P b/P`.
// A renamed file has rename lines, so here both names are the same and the header splits in the middle.
function nameFromHeader(line) {
  const rest = line.slice(11);
  const q = /^"a\/(?:[^"\\]|\\.)*" ("b\/(?:[^"\\]|\\.)*")$/.exec(rest);
  if (q) return headerPath(q[1], 'b/');
  const n = (rest.length - 5) / 2;
  if (Number.isInteger(n) && rest.startsWith('a/') && rest.slice(2 + n, 5 + n) === ' b/') return rest.slice(5 + n);
  return null;
}

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Splits `git diff` output into one chunk per file. addedAt: the line number in the new file of each
// added line, parallel to `added`.
function parseDiff(text) {
  const files = [];
  let cur = null;
  let newNo = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      cur = { path: null, oldPath: null, status: 'modified', binary: false, added: [], addedAt: [], removed: [], lines: [line] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (cur.inHunk === undefined) {
      if (line.startsWith('new file mode')) cur.status = 'added';
      else if (line.startsWith('deleted file mode')) cur.status = 'deleted';
      else if (line.startsWith('rename from ')) { cur.status = 'renamed'; cur.oldPath = headerPath(line.slice(12)); }
      else if (line.startsWith('rename to ')) cur.path = headerPath(line.slice(10));
      else if (line.startsWith('Binary files ')) cur.binary = true;
      else if (line.startsWith('--- ')) { const p = line.slice(4); if (p !== '/dev/null') cur.oldPath = cur.oldPath || headerPath(p, 'a/'); }
      else if (line.startsWith('+++ ')) { const p = line.slice(4); if (p !== '/dev/null') cur.path = headerPath(p, 'b/'); }
      else if (line.startsWith('@@')) { cur.inHunk = true; newNo = Number((HUNK.exec(line) || [])[1] || 0); }
      continue;
    }
    if (line.startsWith('@@')) newNo = Number((HUNK.exec(line) || [])[1] || 0);
    else if (line.startsWith('+')) { cur.added.push(line.slice(1)); cur.addedAt.push(newNo++); }
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
    else if (!line.startsWith('\\')) newNo++; // context
  }
  for (const f of files) {
    delete f.inHunk;
    if (!f.path) f.path = f.oldPath || nameFromHeader(f.lines[0]); // deleted file; mode-only or binary change
  }
  return files;
}

function readUntracked(root, rel) {
  try {
    const full = path.join(root, rel);
    if (fs.statSync(full).size > MAX_READ) return { binary: false, tooBig: true, text: null };
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return { binary: true, tooBig: false, text: null };
    return { binary: false, tooBig: false, text: buf.toString('utf8') };
  } catch {
    return { binary: false, tooBig: false, text: null };
  }
}

const splitLines = (text) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

function listUntracked(root) {
  const out = git(root, ['-c', 'core.quotepath=off', 'ls-files', '-z', '--others', '--exclude-standard']) || '';
  return out.split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'));
}

// How a file looks now, to tell later whether it changed: a content hash up to MAX_READ, size and
// modification time above it (hashing big data files would make the task start slow).
function fileStamp(root, rel) {
  try {
    const full = path.join(root, rel);
    const st = fs.statSync(full);
    if (st.size > MAX_READ) return `${st.size}:${Math.round(st.mtimeMs)}`;
    return crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex');
  } catch { return null; }
}

// { path: stamp } of every untracked file; null outside git or above MAX_SNAPSHOT files (then nothing
// is left out later and the overview says there is no record).
function untrackedSnapshot(root) {
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo || inRepo.trim() !== 'true') return null;
  const list = listUntracked(root);
  if (list.length > MAX_SNAPSHOT) return null;
  return Object.fromEntries(list.map((rel) => [rel, fileStamp(root, rel)]));
}

// The untracked files recorded at the task start (.keel/local/session-start.json), or null.
function untrackedRecord(root) {
  try {
    const start = JSON.parse(fs.readFileSync(path.join(root, '.keel', 'local', 'session-start.json'), 'utf8'));
    return start.untracked && typeof start.untracked === 'object' ? start.untracked : null;
  } catch { return null; }
}

// Returns { base, files, diff, untracked } or throws when the folder is not a git repository.
// files: [{ path, oldPath, status, binary, secret, added: [lines], addedAt: [line numbers], removed: [lines] }]
// diff: unified diff text for agents (secret files reduced to a one-line note; files isBulk() accepts,
// such as lock files, to a one-line count).
// before: untrackedSnapshot() taken at the task start, or null when none was recorded.
// skip: untracked paths the user said are not part of the task.
// ignore: paths that are not part of the change at all (keel's task files).
// maxUntracked: above this many untracked files none is read; untracked.overflow summarises them by folder.
// at: an exact commit to compare with instead of `base` (no merge base).
// untracked: { recorded, unchanged: [left out: there before, not changed], changed: [there before,
// changed since: kept], skipped: [left out on the user's word], overflow: null | { count, limit, folders, digest } }
function collectChanges(root, { base, at, isSecret, before = null, skip = [], isBulk = () => false, ignore = () => false, maxUntracked = MAX_UNTRACKED }) {
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!inRepo || inRepo.trim() !== 'true') throw new Error('not a git repository');
  const b = at ? { sha: at, label: at.slice(0, 7) } : resolveBase(root, base);
  const out = git(root, diffArgs(3, b.sha));
  if (out === null) throw new Error('git diff failed');
  const files = parseDiff(out).filter((f) => !ignore(f.path) && !(f.oldPath && ignore(f.oldPath)));
  const diffParts = [];
  const bulkNote = (f, what) => `diff --git a/${f.path} b/${f.path}\n(${what} ${f.status}: +${f.added.length} -${f.removed.length}, hunks not shown)`;
  for (const f of files) {
    f.secret = isSecret(f.path) || (f.oldPath ? isSecret(f.oldPath) : false);
    if (f.secret) {
      f.added = [];
      f.addedAt = [];
      f.removed = [];
      diffParts.push(`diff --git a/${f.path} b/${f.path}\n(secret file ${f.status}: content not shown)`);
    } else if (!f.binary && isBulk(f.path)) diffParts.push(bulkNote(f, 'lock, generated or vendored file'));
    else diffParts.push(f.lines.join('\n'));
    delete f.lines;
  }
  const untracked = { recorded: Boolean(before), unchanged: [], changed: [], skipped: [], overflow: null };
  const skipSet = new Set(skip.map((p) => p.replace(/\\/g, '/')));
  const candidates = [];
  for (const rel of listUntracked(root)) {
    if (ignore(rel)) continue;
    if (skipSet.has(rel)) untracked.skipped.push(rel);
    else candidates.push(rel);
  }
  if (candidates.length > maxUntracked) {
    const byDir = new Map();
    for (const rel of candidates) { const d = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'; byDir.set(d, (byDir.get(d) || 0) + 1); }
    const folders = [...byDir].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 10).map(([dir, n]) => ({ dir, files: n }));
    const digest = crypto.createHash('sha1').update(candidates.join('\n')).digest('hex');
    untracked.overflow = { count: candidates.length, limit: maxUntracked, folders, digest };
    diffParts.push(`(${candidates.length} untracked files in ${byDir.size} folders, more than ${maxUntracked}: not read; largest folders: ${folders.map((x) => `${x.dir} ${x.files}`).join('; ')})`);
    candidates.length = 0;
  }
  for (const rel of candidates) {
    const existed = Boolean(before) && Object.prototype.hasOwnProperty.call(before, rel);
    if (existed && before[rel] !== null && before[rel] === fileStamp(root, rel)) { untracked.unchanged.push(rel); continue; }
    if (existed) untracked.changed.push(rel);
    const note = existed ? 'untracked; it existed before the task and changed since, so only part of it may be this task' : 'untracked';
    const f = { path: rel, oldPath: null, status: 'added', untracked: true, binary: false, tooBig: false, secret: isSecret(rel), added: [], addedAt: [], removed: [] };
    if (f.secret) diffParts.push(`diff --git a/${rel} b/${rel}\n(secret file added, untracked: content not shown)`);
    else {
      const r = readUntracked(root, rel);
      f.binary = r.binary;
      f.tooBig = r.tooBig;
      if (r.text !== null) {
        f.added = splitLines(r.text);
        f.addedAt = f.added.map((_, i) => i + 1);
        if (isBulk(rel)) diffParts.push(bulkNote(f, 'untracked lock, generated or vendored file'));
        else diffParts.push(`diff --git a/${rel} b/${rel}\nnew file (${note})\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${f.added.length} @@\n${f.added.map((l) => `+${l}`).join('\n')}`);
      } else diffParts.push(`diff --git a/${rel} b/${rel}\nnew file (untracked, ${r.binary ? 'binary' : 'too big or unreadable'}: content not shown)`);
    }
    files.push(f);
  }
  return { base: b, files, diff: diffParts.join('\n') + (diffParts.length ? '\n' : ''), untracked };
}

// Line counts of files at the base commit, read by one `git cat-file --batch`: { path: count }, null for
// a file that did not exist there or is not text.
function baseLineCounts(root, baseSha, rels) {
  const out = Object.fromEntries(rels.map((r) => [r, null]));
  const asked = rels.filter((r) => !/[\r\n]/.test(r)); // one request per line
  if (baseSha === EMPTY_TREE || !asked.length) return out;
  let buf;
  try {
    // ./ : relative to the project folder, not the repository root
    buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: asked.map((r) => `${baseSha}:./${r}\n`).join(''), maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch { return out; }
  let pos = 0;
  for (const rel of asked) {
    const eol = buf.indexOf(0x0a, pos);
    if (eol === -1) break;
    // "<sha> <type> <size>" then the content and a newline; a missing name gets one "<name> missing" line.
    const head = /^[0-9a-f]+ (\w+) (\d+)$/.exec(buf.toString('utf8', pos, eol));
    pos = eol + 1;
    if (!head) continue;
    const body = buf.subarray(pos, pos + Number(head[2]));
    pos += Number(head[2]) + 1;
    if (head[1] === 'blob' && !body.includes(0)) out[rel] = splitLines(body.toString('utf8')).length;
  }
  return out;
}

module.exports = { collectChanges, untrackedSnapshot, untrackedRecord, parseDiff, baseLineCounts, fileStamp, git, splitLines, EMPTY_TREE, MAX_UNTRACKED };
