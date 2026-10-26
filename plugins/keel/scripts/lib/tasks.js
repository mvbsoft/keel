'use strict';
// keel's tasks. One task = one folder, from start until finished.
// - Where: .keel/tasks/<id>/ (goes into git, so it travels with the task branch), or
//   .keel/local/tasks/<id>/ when config `tasks.in_git` is false. The folder holds task.md (ticket, state
//   and handoff in one file) and plan.md when the plan is big. Listing also reads every local and
//   remote-tracking branch, because a handed-off task is committed on its own branch and is absent
//   from the base branch. Only folders count: any other file in .keel/tasks (a README) is not a task.
// - Which task a session works on: .keel/local/active/<session id>.json = { "id": "<task id>" }.
// - A finished or dropped task's folder goes to keel's trash (restorable until
//   cleanup.trash_max_age_days) and is noted in .keel/local/closed-tasks.json, so a stale copy
//   on another branch is not listed again.
// Nothing here prints a task file's text beyond the fields `taskList` shows.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkConfig } = require('./config.js');
const { parseSteps, planAllowed } = require('../plan-steps.js');
const { moveToTrash, listBatches, restore } = require('./trash.js');
const { git, read, noBom, frontmatter, count, freshRef, clean } = require('./repo-read.js');
const { realPath, samePath, linkOnWay, localLink, safeLocalPath, safeLocalWrite } = require('./safe-path.js');
const { readFinish, writeFinish, clearFinish, ownItem } = require('./finish.js');
const { validId, validSid } = require('./ids.js');

const TASK_FILE = 'task.md';
const PLAN_FILE = 'plan.md';
const TEMPLATE = path.join(__dirname, '..', '..', 'templates', 'keel', 'task.md');
const SOURCES = ['jira', 'linear', 'asana', 'github', 'file', 'text'];
const SOURCE_NAMES = { jira: 'Jira', linear: 'Linear', asana: 'Asana', github: 'GitHub', file: 'file', text: 'text' };
// An active marker younger than this may belong to a session that is still open.
const FRESH_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LISTED = { commits: 20, files: 40 };

// Ids compare without case: on Windows and macOS Foo and foo are one folder.
const key = (id) => String(id).toLowerCase();
const sameId = (a, b) => key(a) === key(b);
const validSession = validSid;
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const pad = (n) => String(n).padStart(2, '0');
const dateOf = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const refuse = (what, why) => [`notes: ${what} refused (${why})`];
const given = (v) => typeof v === 'string' && v !== '-' && !/^</.test(v);
// A branch or commit name from a task file: never one git could read as an option.
const refName = (v) => given(v) && !v.startsWith('-');
// HEAD when the task file was last written (its own commit follows).
const afterCommit = (fm) => (given(fm.after_commit) ? fm.after_commit : null);

// --- where the files are ---

function settings(root) {
  const { state, config } = checkConfig(root);
  return { main: state === 'ok' ? config.git.main_branch : null, mode: state === 'ok' ? config.git.mode : null, inGit: !(config && config.tasks && config.tasks.in_git === false) };
}

const sharedRoot = (root) => path.join(root, '.keel', 'tasks');
const localRoot = (root) => path.join(root, '.keel', 'local', 'tasks');

// Working-tree folders, the configured one first; the other is still read, so switching
// `tasks.in_git` does not hide a task that is in flight.
function treeDirs(root) {
  return settings(root).inGit ? [sharedRoot(root), localRoot(root)] : [localRoot(root), sharedRoot(root)];
}

const currentBranch = (root) => git(root, ['symbolic-ref', '--short', '-q', 'HEAD']);

// The tasks in one tasks folder: <id>/task.md. Links are skipped: a task folder is always a real
// folder keel made.
function tasksIn(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
  const found = [];
  for (const e of entries) {
    if (e.isDirectory()) found.push({ id: e.name, folder: path.join(dir, e.name), file: path.join(dir, e.name, TASK_FILE) });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

function treeTasks(root) {
  const seen = new Set();
  const out = [];
  const branch = currentBranch(root);
  for (const dir of treeDirs(root)) {
    const local = dir === localRoot(root);
    for (const f of tasksIn(dir)) {
      const text = validId(f.id) && !seen.has(key(f.id)) ? read(f.file) : null;
      if (text === null) continue;
      seen.add(key(f.id));
      out.push({ ...f, text, fm: frontmatter(text), planText: f.folder ? read(path.join(f.folder, PLAN_FILE)) : null, local, ref: null, where: local ? 'this machine only' : branch ? `${branch} (working tree)` : 'working tree' });
    }
  }
  return out;
}

// The task files of one committed .keel/tasks tree: id -> { task, plan } (blob shas).
// --full-tree: from a sub-folder of the repository, ls-tree would list only the paths under that folder.
function treeFiles(root, tree) {
  const found = new Map();
  for (const line of (git(root, ['ls-tree', '-r', '--full-tree', tree]) || '').split('\n')) {
    // Git modes of regular files (100644, 100755); a committed link (120000) is never read as a task.
    const m = /^100(?:644|755) blob ([0-9a-f]+)\t([^/]+)\/(task|plan)\.md$/.exec(line);
    if (!m || !validId(m[2])) continue;
    const f = found.get(m[2]) || {};
    f[m[3]] = m[1];
    found.set(m[2], f);
  }
  return found;
}

// The text of each blob, read by one `git cat-file --batch` (one process per blob took 30 s with 400
// branches). Its output is "<sha> blob <bytes>\n<content>\n" per blob, so it is cut by bytes.
function readBlobs(root, shas) {
  const out = new Map();
  if (!shas.length) return out;
  let buf;
  try {
    buf = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: shas.map((s) => `${s}\n`).join(''), stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
  } catch { return out; }
  let at = 0;
  for (const sha of shas) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const head = /^([0-9a-f]+) (\S+) (\d+)$/.exec(buf.toString('utf8', at, nl));
    if (!head) { at = nl + 1; continue; }
    const size = Number(head[3]);
    if (head[2] === 'blob') out.set(sha, noBom(buf.toString('utf8', nl + 1, nl + 1 + size)));
    at = nl + 1 + size + 1;
  }
  return out;
}

// Tasks committed on any local or remote-tracking branch. Branches mostly share commits or the same
// .keel/tasks tree, so one `cat-file --batch-check` finds every tree, then one `ls-tree` per distinct
// tree and one `cat-file --batch` for every distinct blob. `./` makes the path relative to the project
// folder, which may be a sub-folder of the repository.
function refTasks(root) {
  if (!settings(root).inGit || git(root, ['rev-parse', '--git-dir']) === null) return [];
  const refs = (git(root, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n')
    .map((l) => /^([0-9a-f]+) (\S+)$/.exec(l)).filter((m) => m && !/^refs\/remotes\/[^/]+\/HEAD$/.test(m[2]));
  if (!refs.length) return [];
  const commits = [...new Set(refs.map((m) => m[1]))];
  const answers = (git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], commits.map((c) => `${c}:./.keel/tasks\n`).join('')) || '').split('\n');
  const treeOf = new Map(commits.map((c, i) => [c, (/^([0-9a-f]+) tree$/.exec(answers[i] || '') || [])[1] || null]));
  const trees = new Map();
  for (const tree of treeOf.values()) if (tree && !trees.has(tree)) trees.set(tree, treeFiles(root, tree));
  const wanted = new Set();
  for (const files of trees.values()) for (const f of files.values()) { if (f.task) wanted.add(f.task); if (f.plan) wanted.add(f.plan); }
  const blobs = readBlobs(root, [...wanted]);
  const blob = (sha) => blobs.get(sha) ?? null;
  const out = [];
  for (const [, commit, ref] of refs) {
    const tree = treeOf.get(commit);
    if (!tree) continue;
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    for (const [id, f] of trees.get(tree)) {
      const text = f.task ? blob(f.task) : null;
      if (!text) continue;
      out.push({ id, folder: null, file: null, blob: f.task, text, fm: frontmatter(text), planText: f.plan ? blob(f.plan) : null, local: false, ref: name, where: name });
    }
  }
  return out;
}

const closedFile = (root) => path.join(root, '.keel', 'local', 'closed-tasks.json');
// id -> { updated, blobs }: the closed task's `updated` and the blobs of its task file that branches
// held when it closed. A map without a prototype: an id may be "constructor".
function readClosed(root) {
  const out = Object.create(null);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(closedFile(root), 'utf8')); } catch { return out; }
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw)) {
    if (!validId(id)) continue;
    out[id] = typeof v === 'string' ? { updated: v, blobs: [] } : { updated: String((v && v.updated) || ''), blobs: Array.isArray(v && v.blobs) ? v.blobs : [] };
  }
  return out;
}
// .keel or .keel/local made a link would carry markers, closed-tasks.json and trash batches out of
// the project: every command that writes there refuses first, and these writes check again.
const localRefusal = (root, what) => { const linked = localLink(root); return linked ? refuse(what, `${linked}: keel does not write through it`) : null; };
function guardLocal(root) {
  const linked = localLink(root);
  if (linked) throw new Error(`${linked}: keel does not write through it`);
}
function writeClosed(root, mutate) {
  guardLocal(root);
  const closed = readClosed(root);
  mutate(closed);
  safeLocalWrite(root, 'closed-tasks.json', JSON.stringify(closed) + '\n');
}
const closedEntry = (closed, id) => closed[Object.keys(closed).find((k) => sameId(k, id))] || null;
const forget = (closed, id) => { for (const k of Object.keys(closed)) if (sameId(k, id)) delete closed[k]; };
function markClosed(root, t) {
  const blobs = [...new Set(refTasks(root).filter((r) => sameId(r.id, t.id)).map((r) => r.blob))];
  writeClosed(root, (c) => { forget(c, t.id); c[t.id] = { updated: t.fm.updated || dateOf(new Date()), blobs }; });
}

// A branch copy of a closed task is stale when it was on a branch at closing time or is older. A copy
// of the same day that was not there is a new task with the same id, so it is listed.
function isStale(closed, t) {
  const c = closedEntry(closed, t.id);
  return Boolean(c) && (c.blobs.includes(t.blob) || (t.fm.updated || '') < c.updated);
}

// Unfinished tasks: the working tree and every branch, one per id (the newest `updated` wins; on a
// tie the working tree, then a local branch, then a remote one), newest first.
function listTasks(root) {
  const best = new Map();
  const closed = readClosed(root);
  const consider = (t) => {
    const cur = best.get(key(t.id));
    if (!cur || (t.fm.updated || '') > (cur.fm.updated || '')) best.set(key(t.id), t);
  };
  treeTasks(root).forEach(consider);
  refTasks(root).filter((t) => !isStale(closed, t)).forEach(consider);
  return [...best.values()].sort((a, b) => (b.fm.updated || '').localeCompare(a.fm.updated || '') || a.id.localeCompare(b.id));
}

const treeTask = (root, id) => (validId(id) ? treeTasks(root).find((t) => sameId(t.id, id)) || null : null);
const findTask = (root, id) => (validId(id) ? listTasks(root).find((t) => sameId(t.id, id)) || null : null);

// For commands that change the files: the task must be in this working tree.
function needTree(root, id, what) {
  if (!validId(id)) return { why: refuse(what, `invalid id "${clean(String(id))}"`) };
  const t = treeTask(root, id);
  if (t) return { t };
  const other = findTask(root, id);
  return { why: refuse(what, other ? `task ${id} is on branch ${other.where}: switch to it first` : `no task "${id}"`) };
}

// Where a task's files are, as the list shows it.
function location(root, t) {
  if (t.ref) return `.keel/tasks/${t.id}/ (on branch ${t.ref})`;
  const at = `${rel(root, t.folder)}/`;
  return t.local ? `${at} (this machine only)` : at;
}

// --- reading a task ---

// "## Name" sections of a task file: name -> text. "### " lines stay inside their section.
function sections(text) {
  const body = (text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const out = {};
  let name = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m) { name = m[1]; out[name] = []; } else if (name) out[name].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

const sectionNamed = (secs, name) => secs[name] ?? secs[Object.keys(secs).find((k) => k.startsWith(name)) || ''] ?? '';
const PLACEHOLDER = /^<[^<>]*>$/;
function firstLine(text, max = 160) {
  const line = (text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()).find((l) => l && !PLACEHOLDER.test(l));
  return line ? clean(line, max) : '';
}

// The text of the task's plan file: `plan:` as an absolute path, else plan.md in the task folder, else
// `plan:` relative to the project; null when the plan is inline. A `plan:` file is read only where
// plan-steps.js reads plans (the project, Claude Code's plans folder): its headings leave the machine
// with the usage data.
function planText(root, task) {
  const p = task.fm.plan;
  const allowed = (file) => (planAllowed(root, file) ? read(file) : null);
  if (given(p) && p !== 'inline' && path.isAbsolute(p)) return allowed(p);
  if (task.planText !== null && task.planText !== undefined) return task.planText;
  return given(p) && p !== 'inline' && task.ref === null ? allowed(path.resolve(root, p)) : null;
}

// Steps done / total: from the plan file when it is readable, else from the task file (step blocks as
// plan-steps.js reads them, else list lines of the State section, or the older Plan section, that
// start with a status symbol).
function stepCounts(root, task) {
  const counted = (steps) => ({ done: steps.filter((s) => s.done).length, total: steps.length });
  const fromPlan = planText(root, task);
  const planned = fromPlan === null ? [] : parseSteps(fromPlan);
  if (planned.length) return counted(planned);
  const secs = sections(task.text);
  const own = secs.State !== undefined ? secs.State : sectionNamed(secs, 'Plan');
  const steps = parseSteps(own);
  if (steps.length) return counted(steps);
  const marks = [...own.matchAll(/^\s*(?:[-*]|\d+[.)])\s+([✅⬜◐⚠])/gmu)].map((m) => m[1]);
  return marks.length ? { done: marks.filter((m) => m === '✅').length, total: marks.length } : null;
}

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

// --- active markers ---

const activeDir = (root) => path.join(root, '.keel', 'local', 'active');
const markerFile = (root, sid) => path.join(activeDir(root), `${sid}.json`);

function markers(root) {
  let names = [];
  try { names = fs.readdirSync(activeDir(root)).filter((n) => n.endsWith('.json')); } catch { /* none */ }
  const out = [];
  for (const name of names) {
    try {
      const file = path.join(activeDir(root), name);
      out.push({ session: name.slice(0, -5), id: JSON.parse(fs.readFileSync(file, 'utf8')).id, at: fs.statSync(file).mtimeMs });
    } catch { /* unreadable marker: ignored */ }
  }
  return out;
}

// The task this session works on, or null (no marker, or its task is gone).
function activeTask(root, sid) {
  if (!validSession(sid)) return null;
  const mark = markers(root).find((m) => m.session === sid);
  return mark && validId(mark.id) ? treeTask(root, mark.id) || findTask(root, mark.id) : null;
}

function setMarker(root, sid, id) {
  safeLocalWrite(root, ['active', `${sid}.json`], JSON.stringify({ id }) + '\n');
}

function clearMarkers(root, match) {
  safeLocalPath(root, 'active');
  for (const m of markers(root)) if (match(m)) fs.rmSync(safeLocalPath(root, 'active', `${m.session}.json`), { force: true });
}

// Replaces or adds "key: value" lines of the leading --- block; null when there is none.
function setFront(text, updates) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) return null;
  let block = m[2];
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}: ${oneLine(value)}`;
    const re = new RegExp(`^${key}:.*$`, 'm');
    block = re.test(block) ? block.replace(re, () => line) : `${block}\n${line}`;
  }
  return m[1] + block + m[3] + text.slice(m[0].length);
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

// --- commands that change things ---

// The skeleton: the template without its comments, the front matter filled from the arguments.
function taskNew(root, id, o, now = new Date()) {
  if (!validId(id)) return refuse('task new', `invalid id "${clean(String(id))}": letters, digits, . _ -, at most 80 characters, starting with a letter or digit, no "..", not ending with ".", not a Windows device name (CON, NUL, COM1...)`);
  if (typeof o.title !== 'string' || !oneLine(o.title)) return refuse('task new', 'needs --title');
  if (!SOURCES.includes(o.source)) return refuse('task new', `--source must be one of ${SOURCES.join(', ')}`);
  if (o.session !== undefined && !validSession(o.session)) return refuse('task new', 'invalid --session');
  const local = localRefusal(root, 'task new');
  if (local) return local;
  const old = findTask(root, id);
  if (old) return refuse('task new', `task ${old.id} already exists (${location(root, old)})`);
  for (const dir of treeDirs(root)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* none */ }
    const taken = names.find((n) => sameId(n, id));
    if (taken) return refuse('task new', `${rel(root, path.join(dir, taken))} exists (ids compare without case)`);
  }
  const folder = path.join(treeDirs(root)[0], id);
  const linked = linkOnWay(root, path.join(folder, TASK_FILE));
  if (linked) return refuse('task new', linked);
  const { main } = settings(root);
  const today = dateOf(now);
  const title = oneLine(o.title);
  // The commit the task started from: `git diff <started>` is the task's work, also on a branch shared
  // with others, whose commits come in by sync.
  const started = git(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']) || '-';
  const front = {
    id, title, source: o.source, link: typeof o.link === 'string' && oneLine(o.link) ? oneLine(o.link) : '-', status: 'active',
    branch: '-', base: main || '-', merge_into: main || '-', execution: 'here', plan: 'inline', created: today, updated: today, after_commit: '-', started,
  };
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->\s*/g, '');
  const body = template.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart().replace(/^# .*$/m, () => `# ${id}: ${title}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, TASK_FILE), `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}`);
  // A task made again after it was finished or dropped is a new one: its branch copies count again.
  if (closedEntry(readClosed(root), id)) writeClosed(root, (c) => forget(c, id));
  const out = [`created: ${rel(root, path.join(folder, TASK_FILE))}`, `folder: ${rel(root, folder)}/ (a big plan goes into ${PLAN_FILE} here)`, 'status: active'];
  if (o.session) { setMarker(root, o.session, id); out.push(`active task: ${id}`); }
  return out;
}

function taskActivate(root, id, sid, now = new Date()) {
  if (!validSession(sid)) return refuse('task activate', 'needs --session <id>');
  const local = localRefusal(root, 'task activate');
  if (local) return local;
  const { t: found, why } = needTree(root, id, 'task activate');
  if (!found) return why;
  const text = setFront(found.text, { status: 'active', updated: dateOf(now) });
  if (text === null) return refuse('task activate', `${rel(root, found.file)} has no front matter (the --- block with id, status...): add it from the template, then activate again`);
  const linked = linkOnWay(root, found.file);
  if (linked) return refuse('task activate', linked);
  fs.writeFileSync(found.file, text);
  setMarker(root, sid, found.id);
  return [`active task: ${found.id}`, `file: ${rel(root, found.file)}`];
}

function taskDeactivate(root, sid) {
  if (!validSession(sid)) return refuse('task deactivate', 'needs --session <id>');
  const local = localRefusal(root, 'task deactivate');
  if (local) return local;
  clearMarkers(root, (m) => m.session === sid);
  return ['active task: none'];
}

const isTracked = (root, target) => git(root, ['ls-files', '--error-unmatch', '--', rel(root, target)]) !== null;
const TRACKED_NOTE = 'it was tracked in git: the removal is a change in the next commit';

// Every entry under a folder, or null when one of them is a link (deleting must never reach past it).
function plainFiles(folder, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (e.isSymbolicLink()) return null;
    if (e.isDirectory()) {
      const inner = plainFiles(path.join(folder, e.name), `${prefix}${e.name}/`);
      if (inner === null) return null;
      out.push(...inner);
    } else out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

// Why `target` must not be deleted as task `id`, or null when it is exactly that task's own folder
// under one of keel's two task folders, with no link anywhere on the way.
function unsafeTarget(root, t) {
  const base = t.local ? localRoot(root) : sharedRoot(root);
  const target = t.folder;
  const expected = path.join(base, t.id);
  if (!validId(t.id) || !target || path.resolve(target) !== path.resolve(expected)) return 'not the task\'s own path';
  let st;
  try { st = fs.lstatSync(target); } catch { return 'it is gone'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'it is a link or not a plain folder';
  // .keel, .keel/tasks or .keel/local may be links that lead out of the project.
  const real = path.join(realPath(root), path.relative(root, expected));
  if (!samePath(realPath(target), real)) return 'a folder on its path is a link';
  return null;
}

// A finished task's folder, or a dropped one, goes to keel's trash: deleting comes before git, and a
// git step that stops (refused push, conflict, red gates) must not lose a task that was never committed.
function toTrash(root, id, sid, what, guard = () => null) {
  if (sid !== undefined && !validSession(sid)) return { why: refuse(what, 'invalid --session') };
  const local = localRefusal(root, what);
  if (local) return { why: local };
  const { t, why } = needTree(root, id, what);
  if (!t) return { why };
  const unsafe = unsafeTarget(root, t);
  if (unsafe) return { why: refuse(what, unsafe) };
  const target = t.folder || t.file;
  // Moving one copy would bring the other back into the list; the user decides which one is the task.
  const others = idEntries(root, t.id).filter((p) => p !== rel(root, target));
  if (others.length) return { why: refuse(what, `${[rel(root, target), ...others].join(' and ')} both hold task ${t.id}: keep one (move or merge the other by hand), then run this again`) };
  if (t.folder && plainFiles(target) === null) return { why: refuse(what, 'the folder holds a link') };
  const blocked = guard(t);
  if (blocked) return { why: refuse(what, blocked) };
  const tracked = isTracked(root, target);
  const r = moveToTrash(root, [rel(root, target)], 'task');
  if (!r.batch) return { why: refuse(what, `could not move it: ${r.failed.map((f) => f.reason).join(', ')}`) };
  try {
    markClosed(root, t);
    clearMarkers(root, (m) => sameId(m.id, t.id));
  } catch (e) {
    // Half a step is worse than none: the folder goes back.
    restore(root, r.batch);
    try { writeClosed(root, (c) => forget(c, t.id)); } catch { /* never written */ }
    return { why: refuse(what, `${e.message}; the folder was put back`) };
  }
  return { t, target, batch: r.batch, tracked };
}

// Only work whose verification is recorded (fingerprint.js save, also --tier none) is finished; in
// autonomous git the finish is recorded for the session until a commit holds it or it is restored
// (lib/finish.js, hooks/finish-check.js).
function verifiedGuard(root) {
  const why = require('../fingerprint.js').unverified(root);
  if (!why) return null;
  const fp = path.join(__dirname, '..', 'fingerprint.js');
  return `${why}: finish the verification first (it ends with fingerprint.js save --tier <level>); when the user chose no verification, run node "${fp}" "${root}" save --tier none; then run task delete again`;
}

function taskDelete(root, id, sid) {
  const record = sid !== undefined && settings(root).mode === 'autonomous';
  let recorded = false;
  // The finish record comes before the move: a finish that cannot be recorded does not start.
  const guard = (task) => {
    const notVerified = verifiedGuard(root);
    if (notVerified || !record) return notVerified;
    try { writeFinish(root, sid, task.id, 'deleted'); recorded = true; return null; } catch (e) { return `the finish record cannot be written: ${e.message}`; }
  };
  const { why, t, target, batch, tracked } = toTrash(root, id, sid, 'task delete', guard);
  if (why) {
    if (recorded) clearFinish(root, sid);
    return why;
  }
  return [`deleted: ${rel(root, target)}${t.folder ? '/' : ''} (moved to keel's trash)`, `trash batch: ${batch}`, 'active task: none', ...(tracked ? [TRACKED_NOTE] : [])];
}

// The working-tree folders that hold task `id` in either tasks folder, any case.
function idEntries(root, id) {
  const out = [];
  for (const dir of [sharedRoot(root), localRoot(root)]) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
    for (const e of entries) {
      if (!e.isFile() && sameId(e.name, id)) out.push(rel(root, path.join(dir, e.name)));
    }
  }
  return out.sort();
}

// Undoes `task delete` when the finish's git step did not complete: the task's own folder from the
// newest trash batch that holds it goes back (nothing else of that batch), the task is no longer closed
// and is active again for the session.
function taskRestore(root, id, sid, now = new Date()) {
  if (!validId(id)) return refuse('task restore', 'invalid id');
  if (!validSession(sid)) return refuse('task restore', 'needs --session <id>');
  const local = localRefusal(root, 'task restore');
  if (local) return local;
  const own = (i) => ownItem(i, id);
  const b = listBatches(root).filter((x) => x.by === 'task' && x.items.some(own)).pop();
  if (!b) return refuse('task restore', `no trash batch holds ${id}`);
  const taken = idEntries(root, id);
  if (taken.length) return refuse('task restore', `${taken.join(', ')} already holds the id ${id} (ids compare without case): the trash batch ${b.batch} stays as it is`);
  const r = restore(root, b.batch, own);
  if (r.refused) return refuse('task restore', r.refused);
  if (!r.restored.length) return refuse('task restore', `nothing put back: ${r.kept.map((k) => `${k.path} (${k.reason})`).join(', ')}`);
  writeClosed(root, (c) => forget(c, id));
  const pending = readFinish(root, sid);
  if (pending && sameId(pending.id, id)) clearFinish(root, sid);
  return [`restored: ${r.restored.map((i) => i.path).join(', ')} (trash batch ${b.batch})`, ...taskActivate(root, id, sid, now)];
}

function taskDrop(root, id) {
  const { why, t, batch, tracked } = toTrash(root, id, undefined, 'task drop');
  if (why) return why;
  return [`dropped: ${t.id}`, `trash batch: ${batch} (/keel:cleanup restore ${batch} puts it back)`, ...(tracked ? [TRACKED_NOTE] : [])];
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

module.exports = {
  validId, readBlobs, listTasks, treeTasks, findTask, activeTask, summaryLine, taskList, taskNew, taskActivate, taskDeactivate,
  taskDelete, taskRestore, taskDrop, taskInventory, sections, setFront, stepCounts, planText, readClosed, dateOf,
};
