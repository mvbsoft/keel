'use strict';
// plans.js tickets, drop and move: the planned tickets' states as their `status` fields say (no
// tokens), the ticket to take next, the step that ends a feature, and the move of a feature folder
// between this machine and the repository. Reads only, except `drop` (the feature folder to keel's
// trash) and `move`.
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { git, clean, frontmatter, noBom } = require('./repo-read.js');
const { moveToTrash } = require('./trash.js');
const { sameBranch, pickRemote } = require('../git-flow.js');
const { heading } = require('./plans-format.js');

// The ticket states, in their order.
const STATES = plans.STATES;
const OPEN_PLAN = ['ready', 'in-progress'];
const TICKET_ARG = /^([a-z][a-z0-9-]*)\/(T\d+)$/i;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const depsOf = (t) => plans.ticketIds(t.fm.depends_on).map((k) => k.toUpperCase());

// The ticket to take next in one feature, or null: the first by number that is ready, needs no review
// and whose dependencies are all done. One that depends on an abandoned ticket waits for the user:
// remove the dependency or abandon it too.
function nextOf(list) {
  const byId = new Map(list.map((t) => [t.id, t]));
  return list.find((t) => t.fm.status === 'ready' && !plans.needsReview(t)
    && depsOf(t).every((k) => byId.has(k) && byId.get(k).fm.status === 'done')) || null;
}

// The open tickets of `shown` that depend on an abandoned one of `list`: `note:` lines.
function blockedNotes(list, shown) {
  const byId = new Map(list.map((t) => [t.id, t]));
  return shown.filter((t) => !plans.CLOSED.includes(t.fm.status)).flatMap((t) => depsOf(t)
    .filter((k) => byId.has(k) && byId.get(k).fm.status === 'abandoned')
    .map((k) => `note: ${t.id} depends on ${k}, which is abandoned: remove the dependency or abandon ${t.id} too`));
}

// An elsewhere ticket (lib/plans-repos.js withElsewhere) shows where it lives, and why its status is
// unknown when its file there cannot be read.
function ticketLine(t, next) {
  if (t.unknown) return `  ${t.id} ${clean(heading(t.text)[1], 80)} — unknown (${clean(t.unknown, 300)})`;
  const marks = [t === next ? 'next' : t.fm.status || 'no status', plans.needsReview(t) && !plans.CLOSED.includes(t.fm.status) ? 'needs review' : null, t.fm.status === 'in-progress' && t.fm.branch ? `on ${clean(t.fm.branch, 60)}` : null, t.there ? `in ${clean(t.there.name, 120)}` : null];
  return `  ${t.id} ${clean(heading(t.text)[1], 80)} — ${marks.filter(Boolean).join(' · ')}`;
}

// The ticket as the remote's copy of the plan's branch has it: the main copy, where a start elsewhere
// shows. Nothing for a feature on this machine, an elsewhere ticket, or a branch or file the remote does
// not have (as of the last fetch).
function remoteLine(root, d, t) {
  const remote = d.local || t.there ? null : pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean));
  if (!remote) return [];
  const ref = `${remote}/${plans.branchesOf(root, d).branch}`;
  const text = git(root, ['show', `${ref}:./${rel(root, t.file)}`]);
  if (text === null) return [];
  const fm = frontmatter(noBom(text));
  const on = fm.status === 'in-progress' && fm.branch && fm.branch !== '-' ? ` on ${clean(fm.branch, 60)}` : '';
  return [`  remote: ${clean(fm.status || 'no status', 20)}${on} (${clean(ref, 80)})`];
}

// The feature's tickets, an elsewhere one as its file in its repository says.
const featureTickets = (root, d) => (d.fm.home ? plans.tickets(d) : require('./plans-repos.js').withElsewhere(root, d, plans.tickets(d)));

// arg: a feature, <feature>/T<n>, or nothing (every ready or in-progress feature with a ticket not done
// or abandoned). `--fetch`: the remote first, so git's warning sees the merged branches.
function ticketsCommand(root, arg, { fetch = false } = {}) {
  const notes = fetch ? require('./plans-git.js').fetched(root).notes : [];
  const all = plans.listDrafts(root).map((d) => ({ d, list: featureTickets(root, d) }));
  const one = typeof arg === 'string' ? TICKET_ARG.exec(arg) : null;
  const name = one ? one[1] : typeof arg === 'string' && arg ? arg : null;
  const shown = name ? all.filter((f) => f.d.feature === name)
    : all.filter((f) => OPEN_PLAN.includes(f.d.fm.status) && f.list.some((t) => !plans.CLOSED.includes(t.fm.status)));
  if (name && !shown.length) return [`tickets: none (no feature ${clean(name, 60)})`, ...notes];
  if (!shown.length) return ['tickets: none', ...notes];
  const out = [];
  let count = 0;
  let next = null;
  for (const { d, list } of shown) {
    const own = OPEN_PLAN.includes(d.fm.status) ? nextOf(list) : null;
    if (!next && own) next = { t: own, feature: d.feature };
    const lines = one ? list.filter((t) => t.id === one[2].toUpperCase()) : list;
    if (one && !lines.length) return [`tickets: none (no ticket ${clean(arg, 60)})`, ...notes];
    const done = list.filter((t) => t.fm.status === 'done').length;
    out.push(`${d.feature} (${d.fm.status}; ${done} of ${list.length} done)`);
    if (name) { const b = plans.branchesOf(root, d); out.push(`  branch: ${b.branch} -> ${b.merge_into || '-'}`); }
    for (const t of lines) {
      out.push(ticketLine(t, own));
      if (!one) continue;
      out.push(`  file: ${t.there ? t.there.t.file.split(path.sep).join('/') : rel(root, t.file)}`, ...remoteLine(root, d, t));
      const deps = depsOf(t).map((k) => { const x = list.find((y) => y.id === k); return `${k} ${x ? x.fm.status || 'no status' : 'not found'}`; });
      if (deps.length) out.push(`  depends: ${deps.join(', ')}`);
    }
    // An elsewhere ticket's branch is in its own repository.
    out.push(...require('./plans-git.js').mergedWarnings(root, d, lines.filter((t) => !t.there)), ...blockedNotes(list, lines), ...require('./plans-check.js').doneHint(d, list));
    count += lines.length;
  }
  return [
    `tickets: ${plural(shown.length, 'feature')}, ${plural(count, 'ticket')}`,
    ...out,
    next ? `next: ${next.feature}/${next.t.id}` : 'next: none',
    ...notes,
  ];
}

// --- drop ---

// A feature whose every ticket is done or abandoned: its folder to keel's trash. A folder in the
// repository goes only off the branch it merges into (then plans.js commit <feature>).
function dropCommand(root, feature) {
  const what = 'drop';
  const { d, why } = plans.needDraft(root, feature, what);
  if (!d) return why;
  const open = featureTickets(root, d).filter((t) => !plans.CLOSED.includes(t.fm.status));
  if (open.length) return refuse(what, `not every ticket of ${feature} is done or abandoned: ${open.map((t) => `${t.id} ${t.fm.status || 'no status'}`).join(', ')}`);
  if (!d.local) {
    const branch = git(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
    if (!branch) return refuse(what, 'HEAD is detached; switch to the feature branch first');
    const b = plans.branchesOf(root, d);
    if ([plans.mainBranch(root), b.merge_into].filter(Boolean).some((x) => sameBranch(x, branch))) return refuse(what, `on ${branch}, where the feature merges; the folder is removed on the feature branch before its merge`);
  }
  const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
  if (!r.batch || r.failed.length) return refuse(what, `not moved to keel's trash: ${r.failed.map((f) => `${f.path}: ${f.reason}`).join(', ')}`);
  try { plans.clearMarks(root, (m) => m.feature === feature); } catch { /* a mark left is harmless: its feature is gone */ }
  return r.moved.map((m) => `drop: ${m.path}/ -> trash ${r.batch}`);
}

// --- move ---

// plans.js move <feature> --to repo|pc: the feature folder as it is between this machine
// (.keel/local/plans/keel/<feature>/) and the repository (<tickets_dir>/<feature>/); no file is
// rewritten. Refused while the target exists, a ticket is in progress, a task names a ticket of the
// feature (`ticket: <feature>/T<n>` in its task.md) or the folder has uncommitted changes.
function moveCommand(root, feature, to) {
  const what = 'move';
  const { d, why } = plans.needDraft(root, feature, what);
  if (!d) return why;
  if (!['repo', 'pc'].includes(to)) return refuse(what, '--to repo or --to pc');
  if (d.local === (to === 'pc')) return [`move: ${feature} is already in ${rel(root, d.folder)}/ (${to})`];
  const s = require('./plans-settings.js').settings(root);
  const bad = require('./plans-settings.js').badFolder(root, s.tickets_dir);
  if (to === 'repo' && bad) return refuse(what, `tickets_dir "${clean(s.tickets_dir)}": ${bad}`);
  const { localLink, linkOnWay } = require('./safe-path.js');
  if (to === 'pc' && localLink(root)) return refuse(what, `${localLink(root)}: keel does not write through it`);
  const target = path.join(to === 'pc' ? plans.base(root) : path.join(root, s.tickets_dir), feature);
  if (to === 'repo' && linkOnWay(root, target)) return refuse(what, `${linkOnWay(root, target)}: keel does not write through it`);
  if (fs.existsSync(target)) return refuse(what, `${rel(root, target)}/ exists`);
  const busy = featureTickets(root, d).filter((t) => t.fm.status === 'in-progress').map((t) => t.id);
  if (busy.length) return refuse(what, `in progress: ${busy.join(', ')}`);
  const tasks = require('./tasks.js').treeTasks(root).filter((t) => String(t.fm.ticket || '').trim().startsWith(`${feature}/`)).map((t) => t.id);
  if (tasks.length) return refuse(what, `tasks work on its tickets: ${tasks.join(', ')}`);
  if (!d.local && git(root, ['status', '--porcelain', '--', rel(root, d.folder)])) return refuse(what, `${rel(root, d.folder)}/ has uncommitted changes: plans.js commit ${feature} first`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(d.folder, target);
  } catch (e) { return refuse(what, e.message); }
  return [
    `moved: ${rel(root, d.folder)}/ -> ${rel(root, target)}/`,
    ...(to === 'pc'
      ? [`warn: once committed (plans.js commit ${feature}), the folder leaves git for everyone: only this machine keeps it`]
      : [`next: plans.js commit ${feature}`]),
  ];
}

module.exports = { ticketsCommand, dropCommand, moveCommand, nextOf, STATES };
