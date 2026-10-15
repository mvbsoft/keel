'use strict';
// keel's notes between sessions: the note (.keel/next-session.md), project memory, and the tasks.
// One task = one folder: .keel/tasks/<id>/ (git), or .keel/local/tasks/<id>/ when config
// `tasks.in_git` is false; task.md in it, plan.md when the plan is big. A session works on the task
// named in .keel/local/active/<session id>.json.
// Only reads, except `--begin` (records where this session started, in .keel/local/) and the `task`
// commands, which write task files and the active markers and move a finished or dropped task's folder
// to keel's trash. Never fetches: "behind" is as of the last fetch. Never prints a task
// file's text beyond the fields `tasks` lists (lib/tasks.js).
// Usage: node notes.js <projectDir> <command>
//   check [--begin] [--session <id>]   presence and size of each file (limit LIMIT lines: the note,
//            memory and every task.md in this working tree), whether the note is behind the
//            repository, the unfinished tasks, the session's active task, where this session started,
//            the next session log name
//   --begin  also record the current commit as this session's start (used by end-task/end-session
//            to verify all the work, also when it was committed along the way) and the untracked
//            files that are there now (changes.js leaves them out unless they change); an unfinished
//            task or note keeps the untracked record of its first start
//   tasks [--session <id>]             the unfinished tasks (this working tree and every branch), one block each
//   lane <key or link>                 which lane leads a key: a task (start-task), the note (start-session),
//                                      both (conflict) or none; a link counts with the tracker key in it
//   task new <id> --title <t> --source <s> [--link <l>] [--session <id>]   the folder and task.md, status active;
//                                      refused for a key the note names (that lane is the session's)
//   task active --session <id>         the session's active task
//   task activate <id> --session <id>  mark a task active for the session (status active)
//   task deactivate --session <id>     the session works on no task
//   task delete <id> [--session <id>]  move the finished task's folder to keel's trash; refused unless a
//                                      verification of the current work is recorded (fingerprint.js save)
//   task restore <id> --session <id>   put the task's folder (only it) back from keel's trash, make it active again
//                                      (git-flow.js --finish runs it when a git step stops; manual git: end-task)
//   task drop <id>                     move the task's folder to keel's trash (/keel:cleanup restore)
//   task inventory <id>                what the task left: its files, branch, commits and changed files not in its base
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('./lib/config.js');
const { untrackedSnapshot } = require('./lib/diff.js');
const { parseArgs } = require('./lib/project.js');
const { git, read, frontmatter, count, freshRef, clean } = require('./lib/repo-read.js');
const tasks = require('./lib/tasks.js');
const { localLink, safeLocalWrite } = require('./lib/safe-path.js');

const LIMIT = 150;
const NOTE = 'next-session.md';
const MEMORY = path.join('memory', 'project-memory.md');
const START = path.join('local', 'session-start.json');
const MAX_IDS = 8;

const lineCount = (text) => text.replace(/\r?\n$/, '').split(/\r?\n/).length;
const size = (text) => `${lineCount(text)} / ${LIMIT} lines${lineCount(text) > LIMIT ? ' - over the limit' : ''}`;

// The commit the note describes: the last commit that changed the note when it is committed as it is
// now, else the note's own `after_commit` field.
function noteCommit(root, keel, fields) {
  const rel = path.relative(root, path.join(keel, NOTE)).split(path.sep).join('/');
  const tracked = git(root, ['ls-files', '--error-unmatch', rel]) !== null;
  const clean = tracked && git(root, ['status', '--porcelain', '--', rel]) === '';
  if (clean) {
    const c = git(root, ['log', '-1', '--format=%H', '--', rel]);
    if (c) return { sha: c, how: 'the commit that last changed the note' };
  }
  const field = fields.after_commit;
  if (field && field !== '-' && !field.startsWith('-')) {
    const sha = git(root, ['rev-parse', '-q', '--verify', '--end-of-options', `${field}^{commit}`]);
    if (sha) return { sha, how: 'after_commit in the note' };
  }
  return null;
}

function check(root, begin, session) {
  const keel = path.join(root, '.keel');
  const { state, config } = checkConfig(root);
  const main = state === 'ok' ? config.git.main_branch : null;
  const isRepo = git(root, ['rev-parse', '--git-dir']) !== null;
  const head = isRepo ? git(root, ['rev-parse', '-q', '--verify', 'HEAD']) : null;
  const branch = isRepo ? git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) : null;
  const out = [];

  const note = read(path.join(keel, NOTE));
  if (note === null) out.push('note: missing');
  else {
    const f = frontmatter(note);
    out.push(`note: present, status ${clean(f.status || '?')}, branch ${clean(f.branch || '?')}, written ${clean(f.date || '?')}; ${size(note)}`);
    if (f.branch && f.branch !== '-' && branch && f.branch !== branch) out.push(`note branch: ${clean(f.branch)}, but the current branch is ${branch}`);
    const at = isRepo ? noteCommit(root, keel, f) : null;
    if (!isRepo) out.push('note behind: unknown (not a git repository)');
    else if (!at) out.push('note behind: unknown (its commit is not in this repository: history rewritten or another clone)');
    else {
      const parts = [];
      const mainRef = main && freshRef(root, main);
      if (mainRef) parts.push(`${mainRef} has ${count(root, `${at.sha}..${mainRef}`)} new commits`);
      const lineRef = f.branch && f.branch !== '-' && freshRef(root, f.branch);
      if (lineRef) parts.push(`${lineRef} has ${count(root, `${at.sha}..${lineRef}`)} commits after the note`);
      out.push(`note behind: ${parts.join('; ') || 'nothing to compare'} (since ${at.sha.slice(0, 7)}, ${at.how}; as of the last fetch)`);
    }
  }

  const memory = read(path.join(keel, MEMORY));
  out.push(memory === null ? 'memory: missing' : `memory: present; ${size(memory)}`);

  const open = tasks.listTasks(root);
  out.push(tasks.summaryLine(open, MAX_IDS));
  const here = tasks.treeTasks(root);
  if (here.length) {
    const over = here.filter((t) => lineCount(t.text) > LIMIT).map((t) => `${t.id} (${lineCount(t.text)} lines)`);
    out.push(`task files: ${here.length} in this working tree; over the limit of ${LIMIT} lines: ${over.join(', ') || 'none'}`);
  }
  if (session !== undefined) {
    const active = tasks.activeTask(root, session);
    out.push(`active task: ${active ? active.id : 'none'}`);
  }
  for (const c of laneConflicts(root, open)) out.push('lane conflict: ' + c + ' (lanes never mix: ask the user which one leads it and stop until it is settled)');

  let start = null;
  try { start = JSON.parse(read(path.join(keel, START))); } catch { /* none */ }
  const unfinished = open.length > 0 || (note !== null && frontmatter(note).status !== 'done');
  const linked = begin ? localLink(root) : null;
  if (linked) out.push(`session start record: refused (${linked}: keel does not write through it)`);
  else if (begin && state === 'ok' && head) {
    const at = new Date().toISOString();
    // A line of work still open keeps its first record: files an earlier session of the same task
    // created are that task's, not older leftovers.
    const keep = unfinished && start && start.untracked ? start : null;
    start = { head, branch, at, untracked: keep ? keep.untracked : untrackedSnapshot(root), untracked_at: keep ? keep.untracked_at : at };
    try { safeLocalWrite(root, 'session-start.json', JSON.stringify(start) + '\n'); } catch (e) { out.push(`session start record: refused (${e.message})`); start = null; }
  }
  if (start && start.head && head && git(root, ['merge-base', '--is-ancestor', start.head, 'HEAD']) !== null) {
    const n = count(root, `${start.head}..HEAD`);
    const u = start.untracked ? `; ${Object.keys(start.untracked).length} untracked files on record since ${start.untracked_at}` : '';
    out.push(`session start: ${start.head.slice(0, 7)} at ${start.at}; ${n} commits since${n ? ` (verify with --base ${start.head.slice(0, 7)})` : ''}${u}`);
  } else if (start && start.head) {
    // Recorded, but HEAD does not contain it (another branch, or history rewritten): no --base from it.
    const where = start.branch && start.branch !== branch ? `recorded on branch ${clean(start.branch)}` : 'recorded';
    out.push(`session start: ${start.head.slice(0, 7)} at ${start.at}, ${where}; not in the history of HEAD, so no commits since to verify from it`);
  } else out.push('session start: not recorded');

  // The local day, as in task dates; one past the highest number of that day, so a gap never names a
  // log that exists.
  const day = tasks.dateOf(new Date());
  let n = 0;
  try {
    for (const x of fs.readdirSync(path.join(keel, 'sessions'))) {
      const m = /^(\d{4}-\d\d-\d\d)-(\d+)(?:-[^.]*)?\.md$/.exec(x);
      if (m && m[1] === day) n = Math.max(n, Number(m[2]));
    }
  } catch { /* none yet */ }
  out.push(`next session log: .keel/sessions/${day}-${String(n + 1).padStart(3, '0')}.md`);
  return out;
}

// Which lane leads a tracker key, a task id or a link: an unfinished task (start-task), the note's
// `keys:` (start-session), both (a conflict the user settles) or none. Lanes never mix, so each start
// command asks this first. Both sides are read the same way (laneKeys): the tracker keys in the text,
// in any case and any wrapping (a link with or without its scheme, a markdown link, quotes, a list
// such as [CAN-1, CAN-2] or CAN-4;CAN-5, a trailing dot), #<n> of an issue or pull request link, and
// the text itself without scheme, wrapping and trailing / or . (a task id, a link to the same page).
const TRACKER = /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9]+-\d+)(?!\d)/g;
const LINK_NUMBER = /\/(?:issues|pull|merge_requests)\/(\d+)(?!\d)/g;
function laneKeys(arg) {
  const text = String(arg).trim();
  const keys = new Set();
  for (const m of text.matchAll(TRACKER)) keys.add(m[1].toUpperCase());
  for (const m of text.matchAll(LINK_NUMBER)) keys.add(`#${m[1]}`);
  const bare = text.replace(/^["'`<[(]+|["'`>\])]+$/g, '').replace(/^https?:\/\//i, '').replace(/[/.]+$/, '').toLowerCase();
  if (bare) keys.add(bare);
  return keys;
}
const overlap = (a, b) => [...a].some((k) => b.has(k));
// For a link-like argument, the key found in it (shown back to the user).
const derivedKey = (arg) => {
  if (!/[/=]/.test(arg)) return null;
  const tracker = new RegExp(TRACKER.source).exec(arg);
  const number = new RegExp(LINK_NUMBER.source).exec(arg);
  return tracker ? tracker[1] : number ? `#${number[1]}` : null;
};
// A task's keys: its id, its link and the tracker key in that link.
const taskKeys = (t) => new Set([...laneKeys(t.id), ...(given(t.fm.link) ? laneKeys(t.fm.link) : [])]);
const given = (v) => typeof v === 'string' && v.trim() && v.trim() !== '-';

// The keys the note names while its line is open (none when it is missing or done), as written.
function noteKeys(root) {
  const note = read(path.join(root, '.keel', NOTE));
  const f = note === null ? {} : frontmatter(note);
  return f.status === 'done' ? [] : String(f.keys || '').split(/[\s,;]+/).filter((x) => x && x !== '-' && laneKeys(x).size);
}

// Keys both lanes claim: the note names an unfinished task's id, link or the tracker key in it.
function laneConflicts(root, open = tasks.listTasks(root)) {
  const out = [];
  for (const key of noteKeys(root)) {
    const k = laneKeys(key);
    const t = open.find((x) => overlap(taskKeys(x), k));
    if (t) out.push(`${clean(key)}: the note .keel/next-session.md names it and ${t.id} is an unfinished task`);
  }
  return out;
}

function lane(root, arg) {
  if (typeof arg !== 'string' || !arg.trim()) return ['notes: lane refused (needs a key)'];
  const keys = laneKeys(arg);
  const derived = derivedKey(arg);
  const task = tasks.listTasks(root).find((t) => overlap(taskKeys(t), keys));
  const noteKey = noteKeys(root).find((k) => overlap(laneKeys(k), keys));
  const from = derived ? [`  key from the link: ${clean(derived)}`] : [];
  const taskLine = task && `${task.id} is an unfinished keel task, on ${task.where}`;
  const noteLine = noteKey && `the note .keel/next-session.md names ${clean(noteKey)}`;
  if (task && noteKey) return ['lane: conflict (both lanes name it: ask the user which one leads it before going on)', `  task: ${taskLine} (/keel:start-task)`, `  session: ${noteLine} (/keel:start-session)`, ...from];
  if (task) return [`lane: task (${taskLine}: /keel:start-task leads it)`, ...from];
  if (noteKey) return [`lane: session (${noteLine}: /keel:start-session leads it)`, ...from];
  const closed = Object.keys(tasks.readClosed(root)).find((id) => overlap(laneKeys(id), keys));
  return [`lane: none${closed ? ` (task ${closed} was finished or dropped earlier)` : ''}`, ...from];
}

const TASK_COMMANDS = 'new, active, activate, deactivate, delete, restore, drop, inventory';

// `task <sub> ...`: pos = [project, 'task', sub, id?]
function taskCommand(root, pos, opts) {
  const sub = pos[2];
  const id = pos[3];
  const session = typeof opts.session === 'string' ? opts.session : undefined;
  if (sub === 'new') {
    // Lanes never mix: a key the note leads stays with /keel:start-session.
    const keys = new Set([...(typeof id === 'string' ? laneKeys(id) : []), ...(given(opts.link) ? laneKeys(opts.link) : [])]);
    const named = noteKeys(root).find((k) => overlap(laneKeys(k), keys));
    if (named) return ['notes: task new refused (the note .keel/next-session.md names ' + clean(named) + ': /keel:start-session leads it; lanes never mix)'];
    return tasks.taskNew(root, id, { title: opts.title, source: opts.source, link: opts.link, session });
  }
  if (sub === 'active') {
    const active = tasks.activeTask(root, session);
    return active ? [`active task: ${active.id}`, `on: ${active.where}`] : ['active task: none'];
  }
  if (sub === 'activate') return tasks.taskActivate(root, id, session);
  if (sub === 'deactivate') return tasks.taskDeactivate(root, session);
  if (sub === 'delete') return tasks.taskDelete(root, id, session);
  if (sub === 'restore') return tasks.taskRestore(root, id, session);
  if (sub === 'drop') return tasks.taskDrop(root, id);
  if (sub === 'inventory') return tasks.taskInventory(root, id);
  return [`notes: unknown task command "${sub}" (${TASK_COMMANDS})`];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const command = pos[1] || 'check';
    const session = typeof opts.session === 'string' ? opts.session : undefined;
    if (command === 'check') lines = check(root, opts.begin === true || typeof opts.begin === 'string', session);
    else if (command === 'tasks') lines = tasks.taskList(root, session);
    else if (command === 'task') lines = taskCommand(root, pos, opts);
    else if (command === 'lane') lines = lane(root, pos[2]);
    else lines = [`notes: unknown command "${command}" (check, tasks, lane, task)`];
  } catch (e) {
    lines = [`notes: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { check, lane, laneConflicts, frontmatter, LIMIT };
