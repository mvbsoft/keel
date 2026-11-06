'use strict';
// plans.js tickets, done and drop: the state of exported tickets, worked out from git and the files
// (no tokens), and the two steps that end a ticket and a feature.
// - Finding and reading the tickets: lib/plans-state-read.js; the state of each key and the next
//   ticket: lib/plans-state-rules.js.
// Reads only, except `done` (one status line of a ticket in the working tree) and `drop` (the feature
// folder to keel's trash).
const path = require('node:path');
const plans = require('./plans.js');
const { git, read, clean } = require('./repo-read.js');
const { moveToTrash } = require('./trash.js');
const { setFront } = require('./tasks.js');
const { sameBranch } = require('../git-flow.js');
const { collect, serverData, pickTickets, workPaths, pcTickets, KEY, dirOf, upper, prefixOf, byKey } = require('./plans-state-read.js');
const { STATES, short, states, doneInHistory, stateIn, keysHere, metBy, depWhere, whereLine, nextOf } = require('./plans-state-rules.js');
// Loaded when used: lib/plans-neighbours.js reads other repositories with this file's code.
const neighbours = () => require('./plans-neighbours.js');

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// --- tickets ---

function ticketLine(e, next, marks = []) {
  const state = e === next ? 'next' : STATES[e.state];
  return `  ${clean(e.shown, 40)}${e.title ? ` ${clean(e.title, 80)}` : ''} — ${[state, e.hint, ...e.marks, ...marks].filter(Boolean).join(' · ')}`;
}

// Every key's state here, and what nextOf needs: the other repositories' dependencies and the ones
// found in history.
function readStates(root, now) {
  const d = collect(root, now);
  const keys = states(d);
  const isForeign = neighbours().foreignTest(root, [...keys.keys()]);
  const foreign = (k) => !keys.has(k) && isForeign(k);
  const others = neighbours().neighbourStates(root, [...new Set([...keys.values()].flatMap((e) => e.depends))].filter(foreign), now);
  const gone = d.inRepo ? doneInHistory(d, keys, null, foreign) : new Map();
  return { d, keys, others, gone };
}

// `--fetch`: the remote first (lib/plans-export.js fetched); other repositories are read as they are,
// never fetched. arg: a feature, a key, or nothing (every feature with a ticket not done).
function ticketsCommand(root, arg, { fetch = false, now = new Date() } = {}) {
  const notes = fetch ? require('./plans-export.js').fetched(root).notes.map((n) => n.replace(/; keys .*$/, '')) : [];
  const { d, keys, others, gone } = readStates(root, now);
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
    const own = nextOf(keys, list, gone, others);
    if (!next && own) next = own;
    const done = list.filter((e) => e.state === 0).length;
    const waiting = list.filter((e) => e.state === 1 || e.state === 2).length;
    out.push(`${f} (${done} of ${list.length} done${waiting ? `, ${waiting} waiting for merge` : ''})`);
    const lines = asKey ? list.filter((e) => e.key === asKey) : list;
    if (arg) out.push(`  branch: ${lines[0].branch} -> ${lines[0].mergeInto}`);
    // A to do ticket's dependencies that are not checked, or whose code waits in another branch.
    const marks = (e) => (e.state !== 4 ? [] : e.depends.map((k) => {
      if (others.has(k) && others.get(k).state === neighbours().NOT_CHECKED) return `${k} not checked`;
      const w = depWhere(keys, others, e, k);
      return w && (w.kind === 'feature' || w.kind === 'ticket') ? `${k} only in ${w.word} ${w.branch}` : null;
    }).filter(Boolean));
    for (const e of lines) {
      out.push(ticketLine(e, own, marks(e)));
      if (!asKey) continue;
      for (const p of e.paths) {
        const where = e.found.find((x) => x.path === p && x.view.work) || e.pc.find((x) => x.path === p) ? null : e.found.find((x) => x.path === p).view.ref;
        out.push(`  file: ${where ? `${short(where)}:` : ''}${p}`);
      }
      const dep = (k) => (others.has(k) ? neighbours().stateText(k, others.get(k)) : `${keys.has(k) ? keys.get(k).shown : k} ${keys.has(k) ? STATES[keys.get(k).state] : gone.get(`${e.target} ${k}`) || 'not found'}`);
      if (e.depends.length) out.push(`  depends: ${e.depends.map(dep).join(', ')}`);
      for (const k of e.state === 4 ? e.depends : []) {
        const w = depWhere(keys, others, e, k);
        if (w) out.push(`  where: ${whereLine(keys.has(k) ? keys.get(k).shown : others.get(k).shown || k, w, e, others.has(k) ? others.get(k).folder : null)}`);
      }
    }
    count += lines.length;
  }
  return [
    `tickets: ${plural(shown.length, 'feature')}, ${plural(count, 'ticket')}; ${serverData(d)}`,
    ...out,
    next ? `next: ${next.shown} (${next.feature})` : 'next: none',
    // Only with no argument: a feature or key view is read for its own repository's tickets.
    ...(arg ? [] : require('./plans-linked.js').linkedLines(d, keys, now)),
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

module.exports = {
  ticketsCommand, doneCommand, dropCommand, stateIn, keysHere, metBy, depWhere, KEY, prefixOf, STATES,
  // for lib/plans-linked.js
  collect, states, ticketLine, serverData,
  // for feature-page.js
  readStates, nextOf, byKey,
};
