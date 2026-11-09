'use strict';
// The state of each exported ticket (lib/plans-state.js), worked out from what lib/plans-state-read.js
// collects, and the next ticket of each feature.
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
//                                 that changes only ticket folders and .keel/ does not count; a branch of any age
//                                 named with the key; an unfinished keel task with the key as id; the
//                                 key in `keys:` of .keel/next-session.md
//   to do                         none of these
//   A ticket on this machine: done in its file, in progress by a task or the note, else to do. Keys
//   compare without case.
// - Marks: reverted (done on a branch already merged into merge_into, whose file says todo again or
//   whose folder a revert took away),
//   stale (the branch behind the state has no commit for 30 days), duplicate key (several files).
// - Next, per feature: the first to do by key number whose depends_on are each done, waiting for the
//   feature merge in the same feature (its code is already on the feature branch), or done on the
//   ticket's own feature branch (merged in by hand or with main). A to do ticket's key view adds a
//   `where:` line per dependency that holds it back or was merged in by hand. A dependency no
//   read branch has a file for (its feature finished, its tickets dropped and merged) counts as done when
//   the last version of its file before a commit deleted it on the dependent ticket's merge_into says done
//   (not when a revert of a merge deleted it, or the deletion came with a merge reverted since); else it
//   is in progress when a commit with the key on merge_into's own line changes the project outside ticket
//   folders and .keel/ (a squash merge after the drop), else not found. A merge applied again after its
//   revert (a revert of the revert) is still read as undone: the dependency then shows as not done.
//   Another repository's dependency (a prefix neither the planning one nor a ticket's here) is read in
//   that repository's folder on this machine (lib/plans-neighbours.js) and counts the same way; one not
//   checked (no folder) does not hold the ticket back, its line says so. A stub's key (<PREFIX>-S<n>,
//   lib/plans-stubs.js) is read the same way, as the ticket there whose `replaces:` names it; a stub
//   no ticket replaces yet is never read and never holds a ticket back.
const path = require('node:path');
const { git, clean } = require('./repo-read.js');
const { listTasks, readBlobs } = require('./tasks.js');
const { TRACKER, noteKeys } = require('../notes.js');
const { collect, serverData, ticketOf, dirOf, upper, keyList, stubList, DAY_MS, FRESH_DAYS } = require('./plans-state-read.js');
const { STUB_KEY } = require('./plans-format.js');
// Loaded when used: lib/plans-neighbours.js reads other repositories with this file's code.
const neighbours = () => require('./plans-neighbours.js');

const STATES = ['done', 'waiting for the feature merge', 'waiting for merge into the feature branch', 'in progress', 'to do'];

const short = (ref) => ref.replace(/^refs\/(heads|remotes)\//, '');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';

function ago(seconds, now) {
  const days = Math.max(0, Math.floor((now.getTime() - seconds * 1000) / DAY_MS));
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
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
// The project outside the ticket folders and keel's own .keel/ (task files, notes): a commit that changes
// only those is no work on a key.
const outside = (folders) => ['--', '.', ':(exclude,literal).keel', ...folders.filter(Boolean).map((f) => `:(exclude,literal)${f}`)];

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

// The reverts on the target's own line (first parents), once per target: revert sha -> whether it
// reverted a merge, and those merges with their first parent.
function revertsOn(d, target) {
  if (!d.reverts) d.reverts = new Map();
  if (d.reverts.has(target)) return d.reverts.get(target);
  const pairs = [];
  for (const r of (git(d.root, ['log', '--first-parent', '--format=%H%x00%B%x1e', '--grep=This reverts commit', target]) || '').split('\x1e')) {
    const i = r.indexOf('\0');
    const m = i < 0 ? null : /This reverts commit ([0-9a-f]{7,40})/.exec(r.slice(i + 1));
    if (m) pairs.push([r.slice(0, i).trim(), m[1]]);
  }
  const parents = pairs.length ? (git(d.root, ['rev-list', '--no-walk', '--parents', '--stdin'], stdin(pairs.map((p) => p[1]))) || '').split('\n').map((l) => l.split(' ')) : [];
  const out = { reverts: new Map(), merges: [] };
  for (const [revert, reverted] of pairs) {
    const hit = parents.find((l) => l[0].startsWith(reverted));
    const merge = Boolean(hit) && hit.length > 2;
    out.reverts.set(revert, merge);
    if (merge) out.merges.push({ sha: hit[0], first: hit[1] });
  }
  d.reverts.set(target, out);
  return out;
}

// Whether commit c came to the target with a merge that a later revert undid: c is on the merged side of
// that merge (in its history, not in its first parent's). A merge applied again (a revert of the revert)
// still counts as undone: a limit, the dependent ticket then names the key as not done.
const revertedIn = (d, c, target) => revertsOn(d, target).merges.some((m) => isAncestor(d, c, m.sha) && !isAncestor(d, c, m.first));

// One entry per key: its files, where they are, and the fields of the one that speaks for it (the
// working tree's, else the newest branch's).
function byKeys(d) {
  const keys = new Map();
  // The stub keys in a folder of the project (lib/plans-stubs.js), read once per folder.
  const stubsIn = new Map();
  const stubKeys = (folder) => {
    if (!stubsIn.has(folder)) stubsIn.set(folder, new Set(require('./plans-stubs.js').stubFiles(path.join(d.root, folder)).map((st) => upper(st.fm.key))));
    return stubsIn.get(folder);
  };
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
    e.stubs = stubList(rep.fm.depends_on);
    e.paths = [...new Set([...e.found.map((f) => f.path), ...e.pc.map((t) => t.path)])];
    e.folders = [...new Set(e.found.map((f) => dirOf(f.path)))];
    // The stubs it depends on that its folder in the working tree (or on this machine) no longer has:
    // converted. A ticket read from a branch only cannot tell, so there its stubs count as here.
    const work = e.found.find((f) => f.view.work) || e.pc[0];
    e.stubsGone = work && e.stubs.length ? e.stubs.filter((k) => !stubKeys(dirOf(work.path)).has(k)) : [];
  }
  return keys;
}

// The hint for the branch behind a state, the same as data (`via`, the date in Unix seconds), and whether
// it is stale.
function behind(d, v) {
  const r = d.byRef.get(v.ref) || v;
  const stale = r.date > 0 && d.now.getTime() - r.date * 1000 > FRESH_DAYS * DAY_MS;
  const via = { kind: 'branch', branch: short(v.ref), author: r.author ? clean(r.author, 40) : null, date: r.date || null };
  return { hint: `branch ${via.branch}${via.author ? `, ${via.author}` : ''}${r.date ? `, ${ago(r.date, d.now)}` : ''}`, via, stale };
}

// A branch as git reads it for the states: the remote's when there is one, else the local one, or null.
function targetRef(d, branch) {
  if (d.remote && d.byRef.has(`refs/remotes/${d.remote}/${branch}`)) return `refs/remotes/${d.remote}/${branch}`;
  return d.byRef.has(`refs/heads/${branch}`) ? `refs/heads/${branch}` : null;
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
  for (const e of keys.values()) {
    e.marks = [];
    e.tips = [];
    if (e.paths.length > 1) e.marks.push(`duplicate key (${e.paths.length} files)`);
    const inProgress = () => {
      if (taskIds().has(e.key)) return { state: 3, hint: 'keel task', via: { kind: 'task' } };
      if (noteSet().has(e.key)) return { state: 3, hint: 'session (.keel/next-session.md)', via: { kind: 'session' } };
      return null;
    };
    // The target also for a ticket kept on this machine: its dependencies may be read from git history.
    const target = targetRef(d, e.mergeInto);
    e.target = target;
    if (!e.found.length) {
      const s = e.pc.some((t) => t.fm.status === 'done') ? { state: 0 } : inProgress() || { state: 4 };
      Object.assign(e, s);
      continue;
    }
    const featureRefs = new Set([`refs/heads/${e.branch}`, ...(d.remote ? [`refs/remotes/${d.remote}/${e.branch}`] : []), ...(target && target !== `refs/heads/${e.mergeInto}` ? [`refs/heads/${e.mergeInto}`] : [])]);
    const onTarget = e.found.filter((f) => f.view.ref === target);
    // A done that a later commit or the working tree took back (done --undo) does not count. The target and
    // the local merge_into are left out: a todo there after a merge is a revert, marked below.
    const undoneBy = e.found.filter((f) => f.fm.status !== 'done' && f.view.ref !== target && f.view.ref !== `refs/heads/${e.mergeInto}`).map((f) => f.view);
    const doneOn = e.found.filter((f) => f.fm.status === 'done' && f.view.ref !== target
      && (f.view.work || !undoneBy.some((u) => (u.sha !== f.view.sha || u.work) && isAncestor(d, f.view.sha, u.sha)))).map((f) => f.view);
    if (onTarget.some((f) => f.fm.status === 'done')) { e.state = 0; continue; }
    const tips = [`refs/heads/${e.branch}`, ...(d.remote ? [`refs/remotes/${d.remote}/${e.branch}`] : [])].filter((r) => d.byRef.has(r));
    e.tips = tips;
    // Merged into the target, which has no file for the key: done, unless the folder left the target with
    // a revert the feature branch does not have (the merge was undone, the tickets were not removed). A
    // status written in the working tree and not committed is never merged.
    // Also undone: every merged done came with a merge reverted since (the drop went with it).
    let undone = false;
    const merged = target && !onTarget.length ? doneOn.filter((v) => !v.work && isAncestor(d, v.sha, target)) : [];
    if (merged.length) {
      const k = `${e.feature} ${target}`;
      if (!removals.has(k)) removals.set(k, removal(d, folders.get(e.feature), target));
      const gone = removals.get(k);
      undone = (Boolean(gone) && gone.subject.startsWith('Revert "') && !tips.some((r) => isAncestor(d, gone.sha, r))) || merged.every((v) => revertedIn(d, v.sha, target));
      if (!undone) { e.state = 0; continue; }
    }
    const newest = (list) => [...new Set(list)].sort((a, b) => b.date - a.date || Number(b.ref.startsWith('refs/heads/')) - Number(a.ref.startsWith('refs/heads/')))[0];
    const held = newest(doneOn.filter((v) => featureRefs.has(v.ref))) || newest(doneOn);
    if (held) {
      // A ticket branch merged into a feature branch that no longer has the ticket (dropped): its code is
      // on the feature branch.
      const merged = !featureRefs.has(held.ref) && !held.work && !e.found.some((f) => tips.includes(f.view.ref)) && tips.some((r) => isAncestor(d, held.sha, r));
      e.state = undone || merged || featureRefs.has(held.ref) ? 1 : 2;
      // The branch that has the code: the one the done is on, but the feature branch for a ticket branch
      // merged into it.
      e.at = merged && !undone ? e.branch : short(held.ref);
      const b = behind(d, held);
      e.hint = b.hint;
      e.via = b.via;
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
      Object.assign(e, { state: 3, hint: `commits with the key on ${e.mergeInto}, status not written`, via: { kind: 'commits', branch: e.mergeInto } });
      continue;
    }
    const by = ref ? d.byRef.get(ref) || { ref } : keyRefs.get(e.key);
    if (by) {
      const b = behind(d, by);
      Object.assign(e, { state: 3, hint: b.hint, via: b.via });
      if (b.stale) e.marks.push('stale');
      continue;
    }
    Object.assign(e, inProgress() || { state: 4 });
  }
  return keys;
}

// Dependencies no read branch has a file for (a finished feature whose tickets were dropped and merged),
// per dependent ticket's target, as "<target> <KEY>" -> done | in progress:
// - done: the last version of the ticket file before a commit deleted it on the target says done. The
//   deletions of key-named files are read newest first; one that is not that ticket (docs/PROJ-1-notes.md)
//   is passed over, and so is a revert of a commit that is not a merge. A revert of a merge, or a deletion
//   that came with a merge reverted since, means not done.
// - in progress: not done, and a commit with the key on the target's own line changes the project outside
//   ticket folders and .keel/ (a squash merge after the drop, work by hand).
// One git log of deletions per target for all its keys, one cat-file --batch for every last version, the
// reverts of the target (revertsOn), and one git log of key commits per target with keys still open.
// `wanted`: target -> keys to look for; by default the dependencies of `keys` that are not among them,
// another repository's (`foreign`) left out: a commit here naming one is no work on it.
function doneInHistory(d, keys, wanted = null, foreign = () => false) {
  if (!wanted) {
    wanted = new Map();
    for (const e of keys.values()) {
      for (const k of e.target ? e.depends : []) {
        if (keys.has(k) || foreign(k)) continue;
        if (!wanted.has(e.target)) wanted.set(e.target, new Set());
        wanted.get(e.target).add(k);
      }
    }
  }
  const found = [];
  for (const [target, set] of wanted) {
    // Newest first: "\0<sha>\0<subject>\n\n<path>\n..." per commit, paths from the project folder and not
    // quoted (core.quotePath: a path with non-ASCII letters would come back in quotes). One pathspec for
    // every key (a key has a hyphen), the keys are picked here. --full-history: a feature branch merged
    // without its folder would be left out of the walk.
    const parts = (git(d.root, ['-c', 'core.quotePath=false', 'log', '--full-history', '--diff-filter=D', '--name-only', '--relative', '--format=%x00%H%x00%s', target, '--', ':(glob,icase)**/*-*.md']) || '').split('\0');
    for (let i = 1; i + 1 < parts.length; i += 2) {
      const [subject, ...paths] = parts[i + 1].split('\n');
      for (const p of paths.filter(Boolean)) {
        const m = /^([A-Za-z][A-Za-z0-9]+-\d+)(?:-[^/]*)?\.md$/.exec(path.posix.basename(p));
        const k = m && upper(m[1]);
        if (k && set.has(k)) found.push({ target, k, sha: parts[i], subject, name: `${parts[i]}^:./${p}` });
      }
    }
  }
  const blobs = readBlobs(d.root, [...new Set(found.map((f) => f.name))]);
  const out = new Map();
  const decided = new Set();
  for (const f of found) {
    const at = `${f.target} ${f.k}`;
    const t = decided.has(at) ? null : ticketOf(blobs.get(f.name));
    if (!t || t.key !== f.k) continue;
    const reverts = revertsOn(d, f.target).reverts;
    if (reverts.has(f.sha) ? !reverts.get(f.sha) : f.subject.startsWith('Revert "')) continue;
    decided.add(at);
    if (!reverts.has(f.sha) && !revertedIn(d, f.sha, f.target) && t.fm.status === 'done') out.set(at, 'done');
  }
  const folders = [...new Set([...keys.values()].flatMap((e) => e.folders))];
  for (const [target, set] of wanted) {
    const open = [...set].filter((k) => !out.has(`${target} ${k}`));
    if (!open.length) continue;
    const named = keysIn(records(git(d.root, ['log', '--first-parent', '--format=%x00%B%x1e', ...greps(open), target, ...outside(folders)])), open, 'ref');
    for (const k of named.keys()) out.set(`${target} ${k}`, 'in progress');
  }
  return out;
}

// The state of keys in another project folder (lib/plans-neighbours.js): key -> { state, shown, feature },
// a key with no ticket file there looked up in the history of that project's main branch as a dependency
// is, else not found; that folder's server data, and whether it is a git repository. A key on none of
// the recent branches is looked for again on every branch: an old unmerged branch may hold it.
function stateIn(folder, list, now = new Date(), d = collect(folder, now)) {
  const read = (d) => {
    const keys = states(d);
    // A stub's key has no ticket of its own: `by` holds, per feature, the state of the ticket whose
    // `replaces:` names it (lib/plans-neighbours.js stubState picks the dependent's feature).
    const by = new Map();
    for (const e of keys.values()) {
      if (!given(e.rep.fm.replaces)) continue;
      const k = upper(e.rep.fm.replaces.trim());
      by.set(k, { ...(by.get(k) || {}), [e.feature]: stateOf(e) });
    }
    const target = d.main ? targetRef(d, d.main) : null;
    // A stub's key is never a file name, so history has none.
    const missing = list.filter((k) => !keys.has(k) && !STUB_KEY.test(k));
    const gone = d.inRepo && target && missing.length ? doneInHistory(d, keys, new Map([[target, new Set(missing)]])) : new Map();
    return new Map(list.map((k) => [k, STUB_KEY.test(k) ? { state: 'not found', by: by.get(k) || {} }
      : keys.has(k) ? stateOf(keys.get(k)) : { state: gone.get(`${target} ${k}`) || 'not found' }]));
  };
  // `d`: that folder's collect() when the caller has it already (lib/plans-linked.js).
  const out = read(d);
  // Only a key still not found (a stub key: no ticket replaces it) is read again on every branch: one
  // found in history keeps that state.
  const open = (k) => (STUB_KEY.test(k) ? !Object.keys(out.get(k).by).length : out.get(k).state === 'not found');
  if (d.inRepo && list.some(open)) {
    for (const [k, s] of read(collect(folder, now, { all: true }))) if (open(k)) out.set(k, s);
  }
  return { keys: out, data: serverData(d), inRepo: d.inRepo };
}

// The keys of this project's tickets (the working tree, recent and named branches, this machine's).
const keysHere = (root) => [...byKeys(collect(root, new Date())).keys()];

// A key's state as a dependency is read, by name: where its code is (`at`, for the two waiting states)
// and the hint of its branch.
const stateOf = (e) => ({ state: STATES[e.state], shown: e.shown, feature: e.feature, branch: e.branch, mergeInto: e.mergeInto, at: e.at || null, hint: e.hint || null });

// Whether a dependency lets a ticket of `feature` start: done, or waiting for the merge of a feature of
// the same name (its code is on that feature branch). States by name.
const metBy = (state, depFeature, feature) => state === STATES[0] || (state === STATES[1] && depFeature === feature);

// Whether a dependency of this project says done on ticket e's own feature branch (local or the
// remote's): its code is there, by a merge of main or of its branch by hand.
const inBranch = (dep, e) => dep.found.some((f) => f.fm.status === 'done' && e.tips.includes(f.view.ref));

// Where a dependency's code is for ticket e, when that says more than its state (`s`, stateOf or another
// repository's): yours (on e's feature branch, so e may start), feature (on another feature's branch),
// local (done on the local merge_into, not pushed), ticket (on a ticket branch), progress, todo; null
// when it is done or waits for the merge of e's own feature, and for not found or not checked.
function whereOf(s, e, yours = false) {
  if (metBy(s.state, s.feature, e.feature)) return null;
  if (yours) return { kind: 'yours', branch: e.branch };
  // A done on a ticket branch whose merge was reverted waits on that branch, not on the feature branch.
  const word = s.at === s.branch || String(s.at).endsWith(`/${s.branch}`) ? 'feature branch' : 'branch';
  if (s.state === STATES[1]) return { kind: s.at === s.mergeInto ? 'local' : 'feature', branch: s.at, word, into: s.mergeInto };
  if (s.state === STATES[2]) return { kind: 'ticket', branch: s.at, word: 'ticket branch', into: s.branch };
  if (s.state === STATES[3]) return { kind: 'progress', hint: s.hint };
  if (s.state === STATES[4]) return { kind: 'todo' };
  return null;
}

// whereOf for dependency k of ticket e: this project's (`keys`) or another repository's (`others`).
const depWhere = (keys, others, e, k) => (others.has(k) ? whereOf(others.get(k), e)
  : keys.has(k) ? whereOf(stateOf(keys.get(k)), e, inBranch(keys.get(k), e)) : null);

// The where: line of the ticket view. `repo`: another repository's folder, whose code is not merged
// from here.
function whereLine(k, w, e, repo = null) {
  const there = repo ? ` in ${repo}` : '';
  if (w.kind === 'yours') return `${k} is in your feature branch ${w.branch}: ${e.shown} can start`;
  if (w.kind === 'feature') {
    return repo ? `${k} is ready in ${w.word} ${w.branch}${there}, not in its ${w.into}: wait for its merge`
      : `${k} is ready in ${w.word} ${w.branch}, not in ${w.into}. To start ${e.shown}: wait for its merge into ${w.into}, or pull it into ${e.branch}: git merge ${w.branch}`;
  }
  if (w.kind === 'local') return `${k} is done in the local ${w.branch}${there}, not pushed yet: wait for its push`;
  if (w.kind === 'ticket') return `${k} is ready in ticket branch ${w.branch}${there}, not in feature branch ${w.into} yet: wait for that merge`;
  if (w.kind === 'progress') return `${k} is in progress${there}${w.hint ? ` (${w.hint})` : ''}: wait for it`;
  return `${k} is not started${there}: wait for it`;
}

// The next ticket of each feature: the first to do whose dependencies are done (also one found done in
// history), waiting for the feature merge in the same feature, or done on its own feature branch;
// another repository's (`others`, lib/plans-neighbours.js) by its state, one not checked passes; a
// stub's key as lib/plans-neighbours.js stubState reads it.
function nextOf(keys, list, gone, others) {
  return list.find((e) => e.state === 4 && e.depends.every((k) => {
    const dep = keys.get(k);
    if (others.has(k)) return neighbours().met(others.get(k), e.feature);
    return dep ? metBy(STATES[dep.state], dep.feature, e.feature) || inBranch(dep, e) : gone.get(`${e.target} ${k}`) === 'done';
  }) && e.stubs.every((k) => {
    const s = neighbours().stubState(others.get(k), e.feature, !e.stubsGone.includes(k));
    return !s || neighbours().met(s, e.feature);
  })) || null;
}

module.exports = {
  STATES, short, states, doneInHistory, stateIn, keysHere, metBy, depWhere, whereLine, nextOf,
};
