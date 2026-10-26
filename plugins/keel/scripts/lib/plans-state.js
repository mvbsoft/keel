'use strict';
// plans.js tickets, done and drop: the state of exported tickets, worked out from git and the files
// (no tokens), and the two steps that end a ticket and a feature.
// - Finding tickets: .md files with a key in the name (PROJ-101-upload.md) whose front matter says
//   `type: ticket` with a `key`, and every .md beside them (a hand-made upload.md in the feature folder),
//   in any folder of the project; the ticket folder of the settings is not needed. Read in the working
//   tree, in every local and remote branch with a commit in the last 30 days, and always in each
//   ticket's own `branch` and `merge_into`: one ls-tree per distinct tree, one cat-file --batch for every
//   distinct candidate file. Plus this machine's tickets (.keel/local/plans/keel/<feature>/tickets/).
// - The working tree stands for the current branch: a status written and not yet committed counts.
// - State of a key, the first that holds:
//   done                          status done on <remote>/<merge_into> (no remote: the local one), or on
//                                 a branch merged into it that has no file for the key (folder removed,
//                                 not by a revert of that merge)
//   waiting for the feature merge done on the feature branch (or on the local merge_into), or on a
//                                 ticket branch merged into a feature branch that no longer has the ticket
//   waiting for merge into the feature branch   done on any other branch
//   in progress                   a commit with the key that changes more than the ticket's folder, on a
//                                 branch not merged into merge_into, or on merge_into since the folder
//                                 was first added anywhere (done by hand, status not written); a commit
//                                 that changes only ticket folders does not count; a branch of any age
//                                 named with the key; an unfinished keel task with the key as id; the
//                                 key in `keys:` of .keel/next-session.md
//   to do                         none of these
//   A ticket on this machine: done in its file, in progress by a task or the note, else to do. Keys
//   compare without case.
// - Marks: reverted (done on a branch already merged into merge_into, whose file says todo again or
//   whose folder a revert took away),
//   stale (the branch behind the state has no commit for 30 days), duplicate key (several files).
// - Next, per feature: the first to do by key number whose depends_on are each done, or waiting for
//   the feature merge in the same feature (its code is already on the feature branch).
// Reads only, except `done` (one status line of a ticket in the working tree) and `drop` (the feature
// folder to keel's trash).
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { git, read, frontmatter, clean } = require('./repo-read.js');
const { moveToTrash } = require('./trash.js');
const { listTasks, setFront, readBlobs } = require('./tasks.js');
const { TRACKER, noteKeys } = require('../notes.js');
const { pickRemote, sameBranch } = require('../git-flow.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_DAYS = 30;
// A file name that holds a key: PROJ-101.md, PROJ-101-upload.md.
const KEY_NAME = /(^|\/)[A-Za-z][A-Za-z0-9]+-\d+(-[^/]*)?\.md$/;
const KEY = /^[A-Za-z][A-Za-z0-9]+-\d+$/;
const LOCAL = '.keel/local/';
// How deep a project that is not a git repository is walked for ticket files.
const WALK_DEPTH = 6;
const STATES = ['done', 'waiting for the feature merge', 'waiting for merge into the feature branch', 'in progress', 'to do'];

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const upper = (k) => String(k).toUpperCase();
const short = (ref) => ref.replace(/^refs\/(heads|remotes)\//, '');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const prefixOf = (key) => key.slice(0, key.lastIndexOf('-'));
const numberOf = (key) => Number(key.slice(key.lastIndexOf('-') + 1));
const byKey = (a, b) => prefixOf(a).localeCompare(prefixOf(b)) || numberOf(a) - numberOf(b);
const keyList = (value) => String(value || '').replace(/[[\]]/g, '').split(/[\s,;]+/).filter((x) => KEY.test(x)).map(upper);

function ago(seconds, now) {
  const days = Math.max(0, Math.floor((now.getTime() - seconds * 1000) / DAY_MS));
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
}

// --- reading the tickets ---

// A ticket's fields from its text, or null when it is not one.
function ticketOf(text) {
  const fm = frontmatter(text || '');
  if (fm.type !== 'ticket' || !KEY.test(fm.key || '')) return null;
  const h = /^# (.+)$/m.exec(String(text).replace(/^---\r?\n[\s\S]*?\r?\n---/, ''));
  return { key: upper(fm.key), shown: fm.key, fm, title: h ? h[1].replace(/^\[[^\]]*\]\s*/, '').trim() : '' };
}

// The paths whose text is read: key-named .md files and every .md in their folders. keel's own
// .keel/local/ is never a repository ticket folder.
function candidates(paths) {
  const named = paths.filter((p) => KEY_NAME.test(p) && !p.startsWith(LOCAL));
  const dirs = new Set(named.map(dirOf));
  return paths.filter((p) => /\.md$/i.test(p) && !p.startsWith(LOCAL) && dirs.has(dirOf(p)));
}

// The tickets among the paths: key-named files confirmed by their front matter, then the other .md files
// in the folders where one was confirmed.
function pickTickets(paths, textOf) {
  const list = candidates(paths);
  const out = [];
  const folders = new Set();
  for (const p of list.filter((x) => KEY_NAME.test(x))) {
    const t = ticketOf(textOf(p));
    if (t) { out.push({ ...t, path: p }); folders.add(dirOf(p)); }
  }
  for (const p of list.filter((x) => !KEY_NAME.test(x) && folders.has(dirOf(x)))) {
    const t = ticketOf(textOf(p));
    if (t) out.push({ ...t, path: p });
  }
  return out;
}

// The tickets of each commit (sha -> tickets), filled into `cache`: one cat-file --batch-check finds the
// project's tree in every commit (`./`: the project may be a sub-folder of the repository), one ls-tree
// per tree not read yet, one cat-file --batch for the candidate files not read yet. --full-tree: from a
// sub-folder, ls-tree would list only the paths under that folder's name inside the project's tree.
function readCommits(root, cache, shas) {
  const fresh = [...new Set(shas)].filter((c) => !cache.commits.has(c));
  if (!fresh.length) return;
  const answers = (git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], fresh.map((c) => `${c}:./\n`).join('')) || '').split('\n');
  const treeOf = new Map(fresh.map((c, i) => [c, (/^([0-9a-f]+) tree$/.exec(answers[i] || '') || [])[1] || null]));
  const listed = new Map();
  for (const tree of treeOf.values()) {
    if (!tree || cache.trees.has(tree) || listed.has(tree)) continue;
    const files = new Map();
    for (const entry of (git(root, ['ls-tree', '-r', '-z', '--full-tree', tree]) || '').split('\0')) {
      // Regular files only: a committed link (120000) is never read as a ticket.
      const m = /^100(?:644|755) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
      if (m) files.set(m[2], m[1]);
    }
    listed.set(tree, files);
  }
  const wanted = new Set();
  for (const files of listed.values()) for (const p of candidates([...files.keys()])) if (!cache.blobs.has(files.get(p))) wanted.add(files.get(p));
  for (const [sha, text] of readBlobs(root, [...wanted])) cache.blobs.set(sha, text);
  for (const [tree, files] of listed) cache.trees.set(tree, pickTickets([...files.keys()], (p) => cache.blobs.get(files.get(p)) ?? null));
  for (const [c, tree] of treeOf) cache.commits.set(c, tree ? cache.trees.get(tree) : []);
}

// The project's files in the working tree: git's list (tracked and untracked, not ignored), or a short
// walk when the project is not a git repository.
function workPaths(root, inRepo) {
  if (inRepo) return [...new Set((git(root, ['ls-files', '-z', '-co', '--exclude-standard']) || '').split('\0').filter(Boolean))];
  const out = [];
  const walk = (dir, prefix, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile()) out.push(`${prefix}${e.name}`);
      else if (e.isDirectory() && depth < WALK_DEPTH && !e.name.startsWith('.') && e.name !== 'node_modules') walk(path.join(dir, e.name), `${prefix}${e.name}/`, depth + 1);
    }
  };
  walk(root, '', 0);
  return out;
}

// This machine's exported tickets: .keel/local/plans/keel/<feature>/tickets/*.md.
function pcTickets(root) {
  let dirs = [];
  try { dirs = fs.readdirSync(plans.base(root), { withFileTypes: true }).filter((e) => e.isDirectory() && plans.validFeature(e.name)).map((e) => e.name); } catch { /* none */ }
  const out = [];
  for (const feature of dirs) {
    const folder = path.join(plans.base(root), feature, 'tickets');
    let names = [];
    try { names = fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name); } catch { /* none */ }
    for (const name of names) {
      const t = ticketOf(read(path.join(folder, name)));
      if (t) out.push({ ...t, path: rel(root, path.join(folder, name)), feature, pc: true });
    }
  }
  return out;
}

// Local and remote branches (not <remote>/HEAD): ref, tip, its commit time and author.
function listRefs(root) {
  const text = git(root, ['for-each-ref', '--format=%(objectname)%00%(committerdate:unix)%00%(authorname)%00%(refname)', 'refs/heads', 'refs/remotes']) || '';
  return text.split('\n').map((l) => l.split('\0')).filter((f) => f.length === 4 && !/^refs\/remotes\/[^/]+\/HEAD$/.test(f[3]))
    .map(([sha, date, author, ref]) => ({ ref, sha, date: Number(date) || 0, author }));
}

// Everything the states are worked out from. A view is one place the tickets were read: a branch, or
// the working tree in place of the current branch.
function collect(root, now) {
  const inRepo = git(root, ['rev-parse', '--git-dir']) !== null;
  const remote = inRepo ? pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean)) : null;
  const refs = inRepo ? listRefs(root) : [];
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const current = inRepo ? git(root, ['symbolic-ref', '-q', 'HEAD']) : null;
  const tip = current && byRef.get(current);
  const work = { ref: current || 'HEAD', sha: inRepo ? git(root, ['rev-parse', '-q', '--verify', 'HEAD']) : null, date: tip ? tip.date : 0, author: tip ? tip.author : '', work: true };
  work.tickets = pickTickets(workPaths(root, inRepo), (p) => read(path.join(root, p)));
  const cache = { commits: new Map(), trees: new Map(), blobs: new Map() };
  const views = [work];
  const add = (list) => {
    readCommits(root, cache, list.map((r) => r.sha));
    for (const r of list) views.push({ ...r, tickets: cache.commits.get(r.sha) || [] });
  };
  const freshFrom = now.getTime() / 1000 - FRESH_DAYS * DAY_MS / 1000;
  add(refs.filter((r) => r.ref !== current && r.date >= freshFrom));
  // Each ticket's own branch and merge_into, whatever their age.
  const named = new Set();
  for (const v of views) {
    for (const t of v.tickets) {
      for (const b of [t.fm.branch, t.fm.merge_into].filter(given)) {
        named.add(`refs/heads/${b}`);
        if (remote) named.add(`refs/remotes/${remote}/${b}`);
      }
    }
  }
  const seen = new Set(views.map((v) => v.ref));
  add([...named].filter((r) => byRef.has(r) && !seen.has(r)).map((r) => byRef.get(r)));
  return { root, now, inRepo, remote, refs, byRef, current, views, pc: pcTickets(root), main: plans.mainBranch(root), ancestors: new Map() };
}

// --- the states ---

// Whether commit a is in b's history; each pair is asked once per run.
function isAncestor(d, a, b) {
  if (!a || !b) return false;
  const k = `${a} ${b}`;
  if (!d.ancestors.has(k)) d.ancestors.set(k, git(d.root, ['merge-base', '--is-ancestor', a, b]) !== null);
  return d.ancestors.get(k);
}
const greps = (keys) => ['-i', '-F', ...keys.map((k) => `--grep=${k}`)];
const outside = (folders) => ['--', '.', ...folders.filter(Boolean).map((f) => `:(exclude,literal)${f}`)];

// The keys of `keys` the messages name (notes.js TRACKER), each with the first record that names it.
function keysIn(records, keys, field) {
  const found = new Map();
  for (const r of records) {
    for (const m of r.body.matchAll(TRACKER)) {
      const k = upper(m[1]);
      if (keys.includes(k) && !found.has(k)) found.set(k, r[field]);
    }
  }
  return found;
}
const records = (text) => String(text || '').split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => { const i = r.indexOf('\0'); return { ref: r.slice(0, i), body: r.slice(i + 1) }; });

// The branches git log reads: every view but a working tree whose branch has no commit yet.
const readRefs = (d) => [...new Set(d.views.filter((v) => !v.work || d.byRef.has(v.ref)).map((v) => v.ref))];
// Revisions go to git on stdin: hundreds of branches would pass the length a command line may have.
const stdin = (revs) => `${revs.join('\n')}\n`;

// Commits with a key that change something outside every ticket folder: on the read branches but not on
// the target (key -> the branch that has it), and on the target since the feature folder was first added
// on any read branch (keys): work done there by hand, before or after the feature merged.
function keyCommits(d, keys, own, all, target) {
  const refs = readRefs(d).filter((r) => r !== target);
  const onBranches = refs.length
    ? keysIn(records(git(d.root, ['log', '--source', '--format=%S%x00%B%x1e', ...greps(keys), '--stdin', ...outside(all)], stdin([...refs, ...(target ? [`^${target}`] : [])]))), keys, 'ref')
    : new Map();
  let onTarget = new Map();
  const shown = own.filter(Boolean);
  if (target && shown.length) {
    const times = (git(d.root, ['log', '--format=%ct', '--diff-filter=A', '--stdin', '--', ...shown.map((f) => `:(literal)${f}`)], stdin(readRefs(d))) || '').split('\n').map(Number).filter((t) => t > 0);
    const first = times.reduce((a, b) => Math.min(a, b), Infinity);
    if (first !== Infinity) onTarget = keysIn(records(git(d.root, ['log', '--format=%x00%B%x1e', ...greps(keys), `--since=@${first}`, target, ...outside(all)])), keys, 'ref');
  }
  return { onBranches, onTarget };
}

// The commit that last removed the feature's folders from the target: { sha, subject }, or null.
function removal(d, folders, target) {
  const shown = folders.filter(Boolean);
  if (!shown.length) return null;
  const out = git(d.root, ['log', '-1', '--diff-filter=D', '--format=%H%x00%s', target, '--', ...shown.map((f) => `:(literal)${f}`)]);
  if (!out) return null;
  const [sha, subject] = out.split('\0');
  return { sha, subject: subject || '' };
}

// One entry per key: its files, where they are, and the fields of the one that speaks for it (the
// working tree's, else the newest branch's).
function byKeys(d) {
  const keys = new Map();
  const entry = (t) => {
    if (!keys.has(t.key)) keys.set(t.key, { key: t.key, found: [], pc: [] });
    return keys.get(t.key);
  };
  for (const v of d.views) for (const t of v.tickets) entry(t).found.push({ ...t, view: v });
  for (const t of d.pc) entry(t).pc.push(t);
  for (const e of keys.values()) {
    const newest = [...e.found].sort((a, b) => Number(b.view.work === true) - Number(a.view.work === true) || b.view.date - a.view.date)[0];
    const rep = newest || e.pc[0];
    e.rep = rep;
    e.shown = rep.shown;
    e.title = rep.title;
    e.feature = rep.pc ? rep.feature : given(rep.fm.feature) ? rep.fm.feature : path.posix.basename(dirOf(rep.path)) || '-';
    e.branch = given(rep.fm.branch) ? rep.fm.branch : e.feature;
    e.mergeInto = given(rep.fm.merge_into) ? rep.fm.merge_into : d.main || '-';
    e.depends = keyList(rep.fm.depends_on);
    e.paths = [...new Set([...e.found.map((f) => f.path), ...e.pc.map((t) => t.path)])];
    e.folders = [...new Set(e.found.map((f) => dirOf(f.path)))];
  }
  return keys;
}

// The hint for the branch behind a state, and whether it is stale.
function behind(d, v) {
  const r = d.byRef.get(v.ref) || v;
  const stale = r.date > 0 && d.now.getTime() - r.date * 1000 > FRESH_DAYS * DAY_MS;
  return { hint: `branch ${short(v.ref)}${r.author ? `, ${clean(r.author, 40)}` : ''}${r.date ? `, ${ago(r.date, d.now)}` : ''}`, stale };
}

// Works out every key's state, marks and hint.
function states(d) {
  const keys = byKeys(d);
  const featureCommits = new Map();
  let tasks = null;
  let note = null;
  const taskIds = () => (tasks = tasks || new Set(listTasks(d.root).map((t) => upper(t.id))));
  const noteSet = () => (note = note || new Set(noteKeys(d.root).map(upper)));
  const keyRefs = new Map();
  for (const r of d.refs) for (const m of short(r.ref).matchAll(TRACKER)) if (!keyRefs.has(upper(m[1]))) keyRefs.set(upper(m[1]), r);
  // The ticket folders of each feature, and of all of them: a commit that only edits tickets is no work.
  const folders = new Map();
  for (const e of keys.values()) folders.set(e.feature, [...new Set([...(folders.get(e.feature) || []), ...e.folders])]);
  const every = [...new Set([...folders.values()].flat())];
  const removals = new Map();
  const targetOf = (e) => {
    if (d.remote && d.byRef.has(`refs/remotes/${d.remote}/${e.mergeInto}`)) return `refs/remotes/${d.remote}/${e.mergeInto}`;
    return d.byRef.has(`refs/heads/${e.mergeInto}`) ? `refs/heads/${e.mergeInto}` : null;
  };
  for (const e of keys.values()) {
    e.marks = [];
    if (e.paths.length > 1) e.marks.push(`duplicate key (${e.paths.length} files)`);
    const inProgress = () => {
      if (taskIds().has(e.key)) return { state: 3, hint: 'keel task' };
      if (noteSet().has(e.key)) return { state: 3, hint: 'session (.keel/next-session.md)' };
      return null;
    };
    if (!e.found.length) {
      const s = e.pc.some((t) => t.fm.status === 'done') ? { state: 0 } : inProgress() || { state: 4 };
      Object.assign(e, s);
      continue;
    }
    const target = targetOf(e);
    e.target = target;
    const featureRefs = new Set([`refs/heads/${e.branch}`, ...(d.remote ? [`refs/remotes/${d.remote}/${e.branch}`] : []), ...(target && target !== `refs/heads/${e.mergeInto}` ? [`refs/heads/${e.mergeInto}`] : [])]);
    const onTarget = e.found.filter((f) => f.view.ref === target);
    // A done that a later commit or the working tree took back (done --undo) does not count. The target and
    // the local merge_into are left out: a todo there after a merge is a revert, marked below.
    const undoneBy = e.found.filter((f) => f.fm.status !== 'done' && f.view.ref !== target && f.view.ref !== `refs/heads/${e.mergeInto}`).map((f) => f.view);
    const doneOn = e.found.filter((f) => f.fm.status === 'done' && f.view.ref !== target
      && (f.view.work || !undoneBy.some((u) => (u.sha !== f.view.sha || u.work) && isAncestor(d, f.view.sha, u.sha)))).map((f) => f.view);
    if (onTarget.some((f) => f.fm.status === 'done')) { e.state = 0; continue; }
    const tips = [`refs/heads/${e.branch}`, ...(d.remote ? [`refs/remotes/${d.remote}/${e.branch}`] : [])].filter((r) => d.byRef.has(r));
    // Merged into the target, which has no file for the key: done, unless the folder left the target with
    // a revert the feature branch does not have (the merge was undone, the tickets were not removed). A
    // status written in the working tree and not committed is never merged.
    let undone = false;
    if (target && !onTarget.length && doneOn.some((v) => !v.work && isAncestor(d, v.sha, target))) {
      const k = `${e.feature} ${target}`;
      if (!removals.has(k)) removals.set(k, removal(d, folders.get(e.feature), target));
      const gone = removals.get(k);
      undone = Boolean(gone) && gone.subject.startsWith('Revert "') && !tips.some((r) => isAncestor(d, gone.sha, r));
      if (!undone) { e.state = 0; continue; }
    }
    const newest = (list) => [...new Set(list)].sort((a, b) => b.date - a.date || Number(b.ref.startsWith('refs/heads/')) - Number(a.ref.startsWith('refs/heads/')))[0];
    const held = newest(doneOn.filter((v) => featureRefs.has(v.ref))) || newest(doneOn);
    if (held) {
      // A ticket branch merged into a feature branch that no longer has the ticket (dropped): its code is
      // on the feature branch.
      const merged = !featureRefs.has(held.ref) && !held.work && !e.found.some((f) => tips.includes(f.view.ref)) && tips.some((r) => isAncestor(d, held.sha, r));
      e.state = undone || merged || featureRefs.has(held.ref) ? 1 : 2;
      const b = behind(d, held);
      e.hint = b.hint;
      // Reverted: a committed done already merged; a done only in the working tree is not merged yet.
      if (undone || (onTarget.length && doneOn.some((v) => !v.work && isAncestor(d, v.sha, target)))) e.marks.unshift('reverted');
      if (b.stale) e.marks.push('stale');
      continue;
    }
    if (!featureCommits.has(e.feature)) {
      const mates = [...keys.values()].filter((x) => x.feature === e.feature && x.found.length);
      featureCommits.set(e.feature, d.inRepo ? keyCommits(d, mates.map((x) => x.key), folders.get(e.feature), every, target) : { onBranches: new Map(), onTarget: new Map() });
    }
    const c = featureCommits.get(e.feature);
    const ref = c.onBranches.get(e.key);
    if (!ref && c.onTarget.has(e.key)) {
      Object.assign(e, { state: 3, hint: `commits with the key on ${e.mergeInto}, status not written` });
      continue;
    }
    const by = ref ? d.byRef.get(ref) || { ref } : keyRefs.get(e.key);
    if (by) {
      const b = behind(d, by);
      Object.assign(e, { state: 3, hint: b.hint });
      if (b.stale) e.marks.push('stale');
      continue;
    }
    Object.assign(e, inProgress() || { state: 4 });
  }
  return keys;
}

// The next ticket of each feature: the first to do whose dependencies are done, or waiting for the
// feature merge in the same feature.
function nextOf(keys, list) {
  return list.find((e) => e.state === 4 && e.depends.every((k) => {
    const dep = keys.get(k);
    return Boolean(dep) && (dep.state === 0 || (dep.state === 1 && dep.feature === e.feature));
  })) || null;
}

// --- tickets ---

function serverData(d) {
  if (!d.inRepo) return 'not a git repository';
  if (!d.remote) return 'no remote';
  const p = git(d.root, ['rev-parse', '--git-path', 'FETCH_HEAD']);
  try { return `server data from ${new Date(fs.statSync(path.resolve(d.root, p)).mtimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z')}`; } catch { return 'never fetched'; }
}

function ticketLine(e, next) {
  const state = e === next ? 'next' : STATES[e.state];
  return `  ${clean(e.shown, 40)}${e.title ? ` ${clean(e.title, 80)}` : ''} — ${[state, e.hint, ...e.marks].filter(Boolean).join(' · ')}`;
}

// `--fetch`: the remote first (lib/plans-export.js fetched). arg: a feature, a key, or nothing (every
// feature with a ticket not done).
function ticketsCommand(root, arg, { fetch = false, now = new Date() } = {}) {
  const notes = fetch ? require('./plans-export.js').fetched(root).notes.map((n) => n.replace(/; keys .*$/, '')) : [];
  const d = collect(root, now);
  const keys = states(d);
  if (!keys.size && !arg) return ['tickets: none', ...notes];
  const features = new Map();
  for (const e of [...keys.values()].sort((a, b) => byKey(a.key, b.key))) {
    if (!features.has(e.feature)) features.set(e.feature, []);
    features.get(e.feature).push(e);
  }
  const asKey = typeof arg === 'string' && KEY.test(arg) ? upper(arg) : null;
  let shown;
  if (asKey) shown = keys.has(asKey) ? [keys.get(asKey).feature] : [];
  else if (typeof arg === 'string' && arg) shown = features.has(arg) ? [arg] : [];
  else shown = [...features.keys()].filter((f) => features.get(f).some((e) => e.state !== 0));
  if (typeof arg === 'string' && arg && !shown.length) return [`tickets: none (no ticket or feature ${clean(arg, 60)})`, ...notes];
  const out = [];
  let count = 0;
  let next = null;
  for (const f of shown) {
    const list = features.get(f);
    const own = nextOf(keys, list);
    if (!next && own) next = own;
    const done = list.filter((e) => e.state === 0).length;
    const waiting = list.filter((e) => e.state === 1 || e.state === 2).length;
    out.push(`${f} (${done} of ${list.length} done${waiting ? `, ${waiting} waiting for merge` : ''})`);
    const lines = asKey ? list.filter((e) => e.key === asKey) : list;
    if (arg) out.push(`  branch: ${lines[0].branch} -> ${lines[0].mergeInto}`);
    for (const e of lines) {
      out.push(ticketLine(e, own));
      if (!asKey) continue;
      for (const p of e.paths) {
        const where = e.found.find((x) => x.path === p && x.view.work) || e.pc.find((x) => x.path === p) ? null : e.found.find((x) => x.path === p).view.ref;
        out.push(`  file: ${where ? `${short(where)}:` : ''}${p}`);
      }
      if (e.depends.length) out.push(`  depends: ${e.depends.map((k) => `${keys.has(k) ? keys.get(k).shown : k} ${keys.has(k) ? STATES[keys.get(k).state] : 'not found'}`).join(', ')}`);
    }
    count += lines.length;
  }
  return [
    `tickets: ${plural(shown.length, 'feature')}, ${plural(count, 'ticket')}; ${serverData(d)}`,
    ...out,
    next ? `next: ${next.shown} (${next.feature})` : 'next: none',
    ...notes,
  ];
}

// --- done ---

// The tickets in this working tree, the repository's and this machine's.
function workTickets(root) {
  const inRepo = git(root, ['rev-parse', '--git-dir']) !== null;
  return [...pickTickets(workPaths(root, inRepo), (p) => read(path.join(root, p))), ...pcTickets(root)];
}

const folderOf = (t) => dirOf(t.path);

function doneCommand(root, key, undo = false) {
  const what = 'done';
  if (typeof key !== 'string' || !KEY.test(key)) return refuse(what, key === undefined ? 'needs a ticket key' : `invalid key "${clean(String(key), 60)}"`);
  const all = workTickets(root);
  const found = all.filter((t) => t.key === upper(key));
  if (!found.length) return [`done: none (no ticket ${clean(key, 60)} here)`];
  if (found.length > 1) return refuse(what, `${found.length} files have ${found[0].shown}: ${found.map((t) => t.path).join(', ')}; keep one`);
  const t = found[0];
  const to = undo ? 'todo' : 'done';
  const shown = undo ? `${t.shown} -> todo` : t.shown;
  if (t.fm.status === to) return [`done: ${shown} (already)`];
  const file = path.join(root, t.path);
  const text = setFront(read(file), { status: to });
  if (text === null) return refuse(what, `${t.path} has no front matter`);
  try { plans.writeFile(root, { local: Boolean(t.pc) }, file, text); } catch (e) { return refuse(what, e.message); }
  const out = [`done: ${shown} (${t.path})`];
  const mates = all.filter((x) => folderOf(x) === folderOf(t));
  if (!undo && mates.every((x) => x === t || x.fm.status === 'done')) out.push(`done: feature ${t.pc ? t.feature : given(t.fm.feature) ? t.fm.feature : path.posix.basename(folderOf(t))} complete (${plural(mates.length, 'ticket')})`);
  return out;
}

// --- drop ---

function dropCommand(root, feature) {
  const what = 'drop';
  if (!plans.validFeature(feature)) return refuse(what, `invalid feature name "${clean(String(feature), 60)}"`);
  const d = collect(root, new Date());
  const keys = [...states(d).values()].filter((e) => e.feature === feature);
  const here = workTickets(root).filter((t) => (t.pc ? t.feature : given(t.fm.feature) ? t.fm.feature : path.posix.basename(folderOf(t))) === feature);
  if (!here.length) return refuse(what, `no tickets of ${feature} in this working tree`);
  const open = keys.filter((e) => (e.found.length ? e.state > 1 : e.state !== 0));
  if (open.length) return refuse(what, `not every ticket of ${feature} is done: ${open.map((e) => `${e.shown} ${STATES[e.state]}`).join(', ')}`);
  const repo = here.filter((t) => !t.pc);
  const folders = [...new Set(here.map((t) => (t.pc ? rel(root, path.join(plans.base(root), feature)) : folderOf(t))))];
  if (repo.length) {
    if (folders.includes('')) return refuse(what, 'a ticket of the feature is in the project\'s top folder, not in a feature folder');
    // Only the feature's own folder goes: one shared with other features or with code is never moved.
    const shared = [...new Set(repo.map(folderOf))].find((f) => path.posix.basename(f) !== feature);
    if (shared) return refuse(what, `${shared}/ is not the feature's own folder ${feature}/; move its tickets into one first`);
    if (!d.current) return refuse(what, 'HEAD is detached; switch to the feature branch first');
    const branch = short(d.current);
    const mainLine = [d.main, ...new Set(keys.map((e) => e.mergeInto))].filter(Boolean);
    if (mainLine.some((b) => sameBranch(b, branch))) return refuse(what, `on ${branch}, where the feature merges; the tickets are removed on the feature branch before its merge`);
  }
  const r = moveToTrash(root, folders, 'planning');
  if (!r.batch || r.failed.length) return refuse(what, `not moved to keel's trash: ${r.failed.map((f) => `${f.path}: ${f.reason}`).join(', ')}`);
  return r.moved.map((m) => `drop: ${m.path}/ -> trash ${r.batch}`);
}

module.exports = { ticketsCommand, doneCommand, dropCommand };
