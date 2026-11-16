'use strict';
// plans.js tickets and drop: the planned tickets' states as their `status` fields say (no tokens), the
// ticket to take next, and the step that ends a feature. Reads only, except `drop` (the feature folder
// to keel's trash).
const path = require('node:path');
const plans = require('./plans.js');
const { git, clean } = require('./repo-read.js');
const { moveToTrash } = require('./trash.js');
const { sameBranch } = require('../git-flow.js');
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

function ticketLine(t, next) {
  const marks = [t === next ? 'next' : t.fm.status || 'no status', plans.needsReview(t) && !plans.CLOSED.includes(t.fm.status) ? 'needs review' : null, t.fm.status === 'in-progress' && t.fm.branch ? `on ${clean(t.fm.branch, 60)}` : null];
  return `  ${t.id} ${clean(heading(t.text)[1], 80)} — ${marks.filter(Boolean).join(' · ')}`;
}

// arg: a feature, <feature>/T<n>, or nothing (every ready or in-progress feature with a ticket not done
// or abandoned). `--fetch`: the remote first, so git's warning sees the merged branches.
function ticketsCommand(root, arg, { fetch = false } = {}) {
  const notes = fetch ? require('./plans-git.js').fetched(root).notes : [];
  const all = plans.listDrafts(root).map((d) => ({ d, list: plans.tickets(d) }));
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
      out.push(`  file: ${rel(root, t.file)}`);
      const deps = depsOf(t).map((k) => { const x = list.find((y) => y.id === k); return `${k} ${x ? x.fm.status || 'no status' : 'not found'}`; });
      if (deps.length) out.push(`  depends: ${deps.join(', ')}`);
    }
    out.push(...require('./plans-git.js').mergedWarnings(root, d, lines), ...blockedNotes(list, lines), ...require('./plans-check.js').doneHint(d, list));
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
  const open = plans.tickets(d).filter((t) => !plans.CLOSED.includes(t.fm.status));
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

module.exports = { ticketsCommand, dropCommand, nextOf, STATES };
