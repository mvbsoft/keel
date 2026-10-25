'use strict';
// Fingerprint of the working tree (HEAD + uncommitted changes + untracked files). Secret files count
// by size and modification time, never by content. A file with no text lines (binary, too big, mode
// change only) counts by its content hash, or by size and modification time above 1 MB.
// Usage: node fingerprint.js <projectDir> snapshot <name>   save the current state as <name>
//        node fingerprint.js <projectDir> compare <name>    same | changed: <files>
//        node fingerprint.js <projectDir> save --tier <tier> record a finished verification (also
//                                                          --tier none: the user chose no verification)
// Used to warn about re-verifying an unchanged tree (last-verify.json), to prove that code-running
// agents left the tree as they found it (snapshot before step 5b, compare after), and by
// `notes.js task delete`, which moves a finished task only when the work is as it was verified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectChanges, fileStamp, git } = require('./lib/diff.js');
const { loadProject, localDir, writeLocal, readJson, parseArgs } = require('./lib/project.js');
const { levelOf } = require('./lib/tier.js');
const { planningFiles } = require('./lib/planning.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// at: the commit to measure the change from (default HEAD).
function treeState(root, isSecret, { ignore, at } = {}) {
  const { base, files, untracked } = collectChanges(root, { isSecret, ignore, at });
  const perFile = {};
  for (const f of files) {
    let data;
    if (f.secret) {
      try { const st = fs.statSync(path.join(root, f.path)); data = `secret ${st.size} ${st.mtimeMs}`; } catch { data = 'secret missing'; }
    } else {
      data = `${f.status}\0${f.added.join('\n')}\0${f.removed.join('\n')}`;
      if (!f.added.length && !f.removed.length && f.status !== 'deleted') data += `\0${fileStamp(root, f.path)}`;
    }
    perFile[f.path] = sha(data).slice(0, 16);
  }
  const all = sha(`${base.sha}\0${Object.entries(perFile).sort().map(([p, h]) => `${p}:${h}`).join('\n')}${untracked.overflow ? `\0${untracked.overflow.digest}` : ''}`);
  return { head: base.sha, fingerprint: all, files: perFile };
}

function compareStates(a, b) {
  if (a.fingerprint === b.fingerprint) return [];
  const changed = new Set();
  for (const p of new Set([...Object.keys(a.files), ...Object.keys(b.files)])) if (a.files[p] !== b.files[p]) changed.add(p);
  if (!changed.size && a.head !== b.head) changed.add(`(HEAD moved ${a.head.slice(0, 7)} -> ${b.head.slice(0, 7)})`);
  return [...changed].sort();
}

// The work without keel's own files: task files and .keel/local/ change during an ending (usage data,
// a task's notes), and a ticket gets `done` after its verification (lib/planning.js); none is the
// verified work. It is measured from the commit that was HEAD at the verification, so committing the
// verified work keeps it verified and any other edit does not.
function workState(root, isSecret, at) {
  const planning = planningFiles(root);
  const notWork = (p) => p.startsWith('.keel/tasks/') || p === '.keel/local' || p.startsWith('.keel/local/') || Boolean(planning(p));
  return treeState(root, isSecret, { ignore: notWork, at }).fingerprint;
}
const isRepo = (root) => (git(root, ['rev-parse', '--is-inside-work-tree']) || '').trim() === 'true';

// Why the work differs from the recorded verification `last`, or null when it is the same.
function workChanged(root, last) {
  const { isSecret } = loadProject(root);
  const at = /^[0-9a-f]{40,64}$/.test(last.head) ? last.head : undefined; // never an option for git
  let now;
  try { now = workState(root, isSecret, at); } catch { return `the verification at ${last.ts} was recorded on a commit this repository no longer has`; }
  return now === last.work ? null : `the work changed after the verification at ${last.ts} (${last.tier || 'level not recorded'})`;
}

// Why the current work has no recorded verification, or null when it has one: last-verify.json exists
// and the work is as it was then (outside git: the record exists).
function unverified(root) {
  const last = readJson(localDir(root, 'last-verify.json'));
  if (!last) return 'no verification is recorded for this change';
  if (!isRepo(root)) return null;
  if (typeof last.work !== 'string') return `the verification at ${last.ts} was recorded by an older keel`;
  return workChanged(root, last);
}

// For changes.js: the last finished verification, if the work is the same now (a "none" record is
// no verification).
function lastVerify(root, current) {
  const last = readJson(localDir(root, 'last-verify.json'));
  if (!last || !last.fingerprint || last.tier === 'none') return null;
  const same = last.fingerprint === current.fingerprint || (typeof last.work === 'string' && !workChanged(root, last));
  return { ...last, same };
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || '.');
  const cmd = pos[1];
  const { isSecret } = loadProject(root);
  if (cmd === 'save') {
    const tier = typeof opts.tier === 'string' && /^[a-z][a-z-]{0,19}$/i.test(opts.tier) ? levelOf(opts.tier.toLowerCase()) : null;
    if (!tier) throw new Error('save needs --tier <level> (gates-only, basic, standard, maximum, or none when the user chose no verification)');
    const repo = isRepo(root);
    const now = repo ? treeState(root, isSecret) : null;
    const record = { ts: new Date().toISOString(), fingerprint: now ? now.fingerprint : null, head: now ? now.head : null, work: repo ? workState(root, isSecret, now.head) : null, tier };
    writeLocal(root, 'last-verify.json', JSON.stringify(record, null, 2) + '\n');
    return `saved: verification at ${record.ts} (${tier})`;
  }
  const now = treeState(root, isSecret);
  if (cmd === 'snapshot' && pos[2] && /^[a-z0-9-]+$/.test(pos[2])) {
    writeLocal(root, `tmp/fingerprint-${pos[2]}.json`, JSON.stringify(now));
    return `snapshot ${pos[2]}: ${Object.keys(now.files).length} changed files recorded`;
  }
  if (cmd === 'compare' && pos[2] && /^[a-z0-9-]+$/.test(pos[2])) {
    const before = readJson(localDir(root, 'tmp', `fingerprint-${pos[2]}.json`));
    if (!before) return `compare ${pos[2]}: no snapshot`;
    const diff = compareStates(before, now);
    return diff.length ? `changed: ${diff.join(', ')}` : 'same';
  }
  throw new Error('usage: fingerprint.js <projectDir> snapshot|compare <name> | save --tier <tier>');
}

if (require.main === module) {
  let out;
  let code = 0;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `fingerprint: error: ${e.message}`; code = 1; }
  process.stdout.write(out + '\n');
  process.exit(code);
}

module.exports = { treeState, compareStates, lastVerify, unverified };
