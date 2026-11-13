'use strict';
// What /keel:tasks shows: the list of unfinished tasks and what a task left behind (lib/tasks.js).
const { git, count, freshRef, clean } = require('./repo-read.js');
const { validId } = require('./ids.js');
const { sameId, refuse, settings, currentBranch, listTasks, findTask, location, plainFiles } = require('./tasks-store.js');
const { given, sections, sectionNamed, firstLine, stepCounts } = require('./tasks-text.js');
const { FRESH_MS, markers } = require('./tasks-markers.js');

const SOURCE_NAMES = { jira: 'Jira', linear: 'Linear', asana: 'Asana', github: 'GitHub', file: 'file', text: 'text' };
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = { commits: 20, files: 40 };
// A branch or commit name from a task file: never one git could read as an option.
const refName = (v) => given(v) && !v.startsWith('-');
// HEAD when the task file was last written (its own commit follows).
const afterCommit = (fm) => (given(fm.after_commit) ? fm.after_commit : null);

function daysSince(updated, now) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(updated || '');
  if (!m) return null;
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.max(0, Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - then) / DAY_MS));
}
const ago = (days) => (days === null ? '' : days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);

// How far the base branch moved since the task was handed off (as of the last fetch).
function baseMoved(root, fm, main) {
  const base = refName(fm.base) ? fm.base : main;
  const last = afterCommit(fm);
  if (!base || !refName(last) || git(root, ['rev-parse', '-q', '--verify', '--end-of-options', `${last}^{commit}`]) === null) return null;
  const ref = freshRef(root, base);
  const mb = ref && git(root, ['merge-base', last, ref]);
  const n = mb ? count(root, `${mb}..${ref}`) : 0;
  return n > 0 ? `${n} commits on ${ref} since the handoff (git-flow.js sync brings them in)` : null;
}

// --- the list ---

function taskBlock(root, task, session, marked, main, now) {
  const secs = sections(task.text);
  const steps = stepCounts(root, task);
  const here = Boolean(session) && marked.some((m) => sameId(m.id, task.id) && m.session === session);
  const others = marked.filter((m) => sameId(m.id, task.id) && m.session !== session && now - m.at < FRESH_MS).length;
  const fm = task.fm;
  const age = ago(daysSince(fm.updated, now));
  let state;
  if (here) state = 'active in this session';
  else if (others) state = others === 1 ? 'active in another session' : `active in ${others} other sessions`;
  else if (fm.status === 'handed-off') state = `handed off ${age}`.trim();
  else state = `active${age ? `, updated ${age}` : ''}`;
  const source = (Object.hasOwn(SOURCE_NAMES, fm.source) && SOURCE_NAMES[fm.source]) || (given(fm.source) ? clean(fm.source) : 'text');
  const moved = fm.status === 'handed-off' ? baseMoved(root, fm, main) : null;
  return [
    '',
    `${task.id} · ${given(fm.title) ? clean(fm.title) : '-'}`,
    `  Source: ${source}${given(fm.link) ? ` — ${clean(fm.link)}` : ''}`,
    `  State: ${[state, steps && `steps ${steps.done}/${steps.total}`, given(fm.branch) && `branch ${clean(fm.branch)}`].filter(Boolean).join(' · ')}`,
    `  Next: ${firstLine(sectionNamed(secs, 'Next action')) || '-'}`,
    `  Files: ${location(root, task)}`,
    ...(moved ? [`  Base moved: ${moved}`] : []),
    `  Goal: ${firstLine(sectionNamed(secs, 'Goal')) || '-'}`,
  ];
}

const idList = (tasks, max) => (tasks.length ? ` (${tasks.slice(0, max).map((t) => t.id).join(', ')}${tasks.length > max ? ', ...' : ''})` : '');
const summaryLine = (tasks, max = Infinity) => `tasks: ${tasks.length} unfinished${idList(tasks, max)}`;

function taskList(root, session, now = new Date()) {
  const tasks = listTasks(root);
  const marked = markers(root);
  const { main } = settings(root);
  return [summaryLine(tasks), ...tasks.flatMap((t) => taskBlock(root, t, session, marked, main, now))];
}

// --- what a task left behind (for /keel:tasks drop) ---

const DOC = /(^|\/)(docs?|documentation)\/|\.(md|mdx|rst|adoc)$|(^|\/)(readme|changelog)(\.[^/]*)?$/i;

function taskInventory(root, id) {
  if (!validId(id)) return refuse('task inventory', `invalid id "${clean(String(id))}"`);
  const t = findTask(root, id);
  if (!t) return refuse('task inventory', `no task "${id}"`);
  const { main } = settings(root);
  const fm = t.fm;
  const files = t.folder ? plainFiles(t.folder) : null;
  const out = [`task: ${t.id} · ${given(fm.title) ? clean(fm.title) : '-'}`, `task files: ${location(root, t)}${files ? ` (${files.join(', ')})` : ''}`];
  const branch = given(fm.branch) ? fm.branch : null;
  const base = given(fm.base) ? fm.base : main;
  // A name starting with "-" would reach git as an option (--output=<file> writes a file).
  const dashed = [['branch', branch], ['base', base]].filter(([, v]) => v && v.startsWith('-')).map(([k]) => k);
  if (dashed.length) return refuse('task inventory', `the task's ${dashed.join(' and ')} starts with "-": fix it in the task file`);
  if (!branch || git(root, ['rev-parse', '--git-dir']) === null) {
    out.push(`branch: ${branch ? `${clean(branch)} (not a git repository)` : 'none recorded'}`);
  } else {
    const local = git(root, ['rev-parse', '-q', '--verify', `refs/heads/${branch}`]) !== null;
    const fresh = freshRef(root, branch);
    const pushed = fresh && fresh !== branch ? fresh : null;
    const tip = local ? branch : pushed;
    out.push(`branch: ${clean(branch)} (local: ${local ? 'yes' : 'no'}; pushed: ${pushed || 'no'})${branch === currentBranch(root) ? '; the current branch' : ''}`);
    const baseRef = base && freshRef(root, base);
    if (tip && baseRef) {
      const commits = (git(root, ['log', '--format=%h %s', '--end-of-options', `${baseRef}..${tip}`]) || '').split('\n').filter(Boolean);
      out.push(`commits not in ${baseRef}: ${commits.length}`, ...commits.slice(0, MAX_LISTED.commits).map((c) => `  ${clean(c)}`), ...(commits.length > MAX_LISTED.commits ? ['  ...'] : []));
      const changed = (git(root, ['diff', '--name-only', '--relative', '--end-of-options', `${baseRef}...${tip}`]) || '').split('\n').filter((f) => f && !f.startsWith('.keel/'));
      out.push(`changed files vs ${baseRef}: ${changed.length}`, ...changed.slice(0, MAX_LISTED.files).map((f) => `  ${clean(f)}`), ...(changed.length > MAX_LISTED.files ? ['  ...'] : []));
      const docs = changed.filter((f) => DOC.test(f));
      out.push(`docs among them: ${docs.length}${docs.length ? ` (${docs.slice(0, MAX_LISTED.files).map((d) => clean(d)).join(', ')})` : ''}`);
    } else out.push(`commits: unknown (${tip ? `base ${base || '-'} not found` : 'the branch is not here'})`);
    if (branch === currentBranch(root)) {
      const dirty = (git(root, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length;
      out.push(`uncommitted changes: ${dirty} files`);
    }
  }
  const sessions = markers(root).filter((m) => sameId(m.id, t.id)).length;
  if (sessions) out.push(`active markers: ${sessions} session(s)`);
  return out;
}

module.exports = { summaryLine, taskList, taskInventory };
