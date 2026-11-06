'use strict';
// The exported tickets lib/plans-state.js works out the states from, read from git and the files.
// - Finding tickets: .md files with a key in the name (PROJ-101-upload.md) whose front matter says
//   `type: ticket` with a `key`, and every .md beside them (a hand-made upload.md in the feature folder),
//   in any folder of the project; the ticket folder of the settings is not needed. Read in the working
//   tree, in every local and remote branch with a commit in the last 30 days, and always in each
//   ticket's own `branch` and `merge_into`: one ls-tree per distinct tree, one cat-file --batch for every
//   distinct candidate file. Plus this machine's tickets (.keel/local/plans/keel/<feature>/tickets/).
// - The working tree stands for the current branch: a status written and not yet committed counts.
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { git, read, frontmatter } = require('./repo-read.js');
const { readBlobs } = require('./tasks.js');
const { pickRemote } = require('../git-flow.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_DAYS = 30;
// A file name that holds a key: PROJ-101.md, PROJ-101-upload.md.
const KEY_NAME = /(^|\/)[A-Za-z][A-Za-z0-9]+-\d+(-[^/]*)?\.md$/;
const KEY = /^[A-Za-z][A-Za-z0-9]+-\d+$/;
const LOCAL = '.keel/local/';
// How deep a project that is not a git repository is walked for ticket files.
const WALK_DEPTH = 6;

const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const upper = (k) => String(k).toUpperCase();
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const prefixOf = (key) => key.slice(0, key.lastIndexOf('-'));
const numberOf = (key) => Number(key.slice(key.lastIndexOf('-') + 1));
const byKey = (a, b) => prefixOf(a).localeCompare(prefixOf(b)) || numberOf(a) - numberOf(b);
const keyList = (value) => String(value || '').replace(/[[\]]/g, '').split(/[\s,;]+/).filter((x) => KEY.test(x)).map(upper);

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
// the working tree in place of the current branch. `all`: every branch, whatever its age.
// lib/plans-linked.js reads the views' work, ref, sha and date to find a feature's overview.
function collect(root, now, { all = false } = {}) {
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
  add(refs.filter((r) => r.ref !== current && (all || r.date >= freshFrom)));
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

function serverData(d) {
  if (!d.inRepo) return 'not a git repository';
  if (!d.remote) return 'no remote';
  const p = git(d.root, ['rev-parse', '--git-path', 'FETCH_HEAD']);
  try { return `server data from ${new Date(fs.statSync(path.resolve(d.root, p)).mtimeMs).toISOString().replace(/\.\d{3}Z$/, 'Z')}`; } catch { return 'never fetched'; }
}

module.exports = {
  collect, serverData, ticketOf, pickTickets, workPaths, pcTickets,
  KEY, DAY_MS, FRESH_DAYS, dirOf, upper, prefixOf, byKey, keyList,
};
