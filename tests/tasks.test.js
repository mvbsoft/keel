'use strict';
// Task files: notes.js `tasks` / `task ...` (lib/tasks.js) on throwaway projects and repositories.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const tasks = require(path.join(SCRIPTS, 'lib', 'tasks.js'));
const { validate } = require(path.join(SCRIPTS, 'lib', 'schema.js'));
const { checkConfig } = require(path.join(SCRIPTS, 'lib', 'config.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (extra = {}, mode = 'autonomous') => ({
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode, main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  ...extra,
});

const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (script, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const notes = (dir, ...args) => run('notes.js', dir, ...args);
// A finish: the verification is recorded first (here: the user chose none), then the task is deleted.
const finish = (dir, ...args) => { run('fingerprint.js', dir, 'save', '--tier', 'none'); return notes(dir, 'task', 'delete', ...args); };
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';
// One task's block of `notes.js tasks`: the lines after "<id> · <title>" up to the next unindented line.
const block = (out, id) => {
  const i = out.findIndex((l) => l.startsWith(`${id} · `));
  if (i < 0) return [];
  const rest = out.slice(i + 1);
  const end = rest.findIndex((l) => !l.startsWith('  '));
  return end < 0 ? rest : rest.slice(0, end);
};
const has = (out, id, text) => block(out, id).some((l) => l.includes(text));
const taskPath = (id) => `.keel/tasks/${id}/task.md`;

function project(config = CONFIG()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-tasks-'));
  write(dir, '.keel/config.json', JSON.stringify(config));
  write(dir, '.keel/.gitignore', 'local/\n');
  return dir;
}

// A repository with one commit on main, a keel config and no remote.
function repo(config) {
  const dir = project(config);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'src/app.js', 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const commitAll = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };

const TASK = (id, extra = {}, body = '', section = 'State') => {
  const f = { id, title: `Title of ${id}`, source: 'text', link: '-', status: 'handed-off', branch: '-', base: 'main', merge_into: 'main', execution: 'here', plan: 'inline', created: '2026-10-01', updated: '2026-10-01', after_commit: '-', ...extra };
  return `---\n${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# ${id}\n\n## Goal\nGoal of ${id}\n\n## Next action\nDo the next thing of ${id}\n\n## ${section}\n${body}\n`;
};
const putTask = (dir, id, ...args) => write(dir, taskPath(id), TASK(id, ...args));

test('ids: tracker keys, slugs and dates are valid; paths, dots and long names are not', () => {
  for (const id of ['PROJ-123', 'gh-45', 'file-readme', '20261014-fix-export-button', 'fix-reset-500', 'a', 'v1.2_x']) assert.equal(tasks.validId(id), true, id);
  for (const id of ['', '-x', '.x', 'a/b', 'a\\b', 'a..b', '../x', 'a b', 'x'.repeat(81), 'ü', null, undefined]) assert.equal(tasks.validId(id), false, String(id));
  assert.equal(tasks.validId('x'.repeat(80)), true);
});

test('task new: a folder with task.md from the template, status active; bad input is refused', () => {
  const dir = project();
  const out = notes(dir, 'task', 'new', 'PROJ-1', '--title', 'Fix the export', '--source', 'jira', '--link', 'https://tracker.example/PROJ-1', '--session', 's1');
  assert.deepEqual(out, ['created: .keel/tasks/PROJ-1/task.md', 'folder: .keel/tasks/PROJ-1/ (a big plan goes into plan.md here)', 'status: active', 'active task: PROJ-1']);
  const text = fs.readFileSync(path.join(dir, taskPath('PROJ-1')), 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)[1].split('\n').map((l) => l.split(': ')[0]);
  assert.deepEqual(front, ['id', 'title', 'source', 'link', 'status', 'branch', 'base', 'merge_into', 'execution', 'plan', 'created', 'updated', 'after_commit']);
  assert.match(text, /^id: PROJ-1$/m);
  assert.match(text, /^title: Fix the export$/m);
  assert.match(text, /^link: https:\/\/tracker\.example\/PROJ-1$/m);
  assert.match(text, /^status: active$/m);
  assert.match(text, /^base: main$/m);
  assert.match(text, /^# PROJ-1: Fix the export$/m);
  assert.doesNotMatch(text, /<!--|Sources:/, "the template's comment is not copied into the task");
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, ['Goal', 'Next action', 'Acceptance criteria', 'Out of scope', 'State', 'Files', 'Decisions and why', 'Tried and did not work', 'Open questions', 'How to check', "User's changes"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'active', 's1.json'), 'utf8')), { id: 'PROJ-1' });

  assert.match(notes(dir, 'task', 'new', 'PROJ-1', '--title', 'x', '--source', 'jira')[0], /already exists \(\.keel\/tasks\/PROJ-1\/\)/);
  assert.match(notes(dir, 'task', 'new', '../evil', '--title', 'x', '--source', 'text')[0], /^notes: task new refused \(invalid id/);
  assert.match(notes(dir, 'task', 'new', 'A-1', '--source', 'text')[0], /needs --title/);
  assert.match(notes(dir, 'task', 'new', 'A-1', '--title', 'x', '--source', 'email')[0], /--source must be one of jira, linear, asana, github, file, text/);
  assert.match(notes(dir, 'task', 'new', 'A-1', '--title', 'x', '--source', 'text', '--session', '../s')[0], /invalid --session/);
  assert.ok(!exists(dir, '.keel/tasks/A-1') && !exists(dir, '.keel/evil') && !exists(dir, '.keel/tasks/evil'));
});

test('tasks.in_git: false keeps task folders in .keel/local/tasks/; a task in the other place is still listed', () => {
  const dir = project(CONFIG({ tasks: { in_git: false } }));
  assert.equal(notes(dir, 'task', 'new', 'LOC-1', '--title', 'Local one', '--source', 'text')[0], 'created: .keel/local/tasks/LOC-1/task.md');
  putTask(dir, 'OLD-1');
  const out = notes(dir, 'tasks');
  assert.equal(line(out, 'tasks:'), 'tasks: 2 unfinished (LOC-1, OLD-1)');
  assert.ok(has(out, 'LOC-1', 'Files: .keel/local/tasks/LOC-1/ (this machine only)'));
  assert.ok(!exists(dir, '.keel/tasks/LOC-1'));
});

test('config: tasks.in_git is optional, boolean only', () => {
  const dir = project();
  assert.equal(checkConfig(dir).state, 'ok', 'a config without the field is valid');
  assert.equal(checkConfig(project(CONFIG({ tasks: { in_git: false } }))).state, 'ok');
  assert.equal(checkConfig(project(CONFIG({ tasks: {} }))).state, 'ok');
  const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'config.schema.json'), 'utf8'));
  assert.equal(schema.properties.tasks.properties.in_git.default, true);
  assert.match(validate(CONFIG({ tasks: { in_git: 'no' } }), schema).join('\n'), /in_git/);
  assert.match(validate(CONFIG({ tasks: { elsewhere: true } }), schema).join('\n'), /elsewhere: unexpected property/);
});

test('tasks: the approved block per task, listed fields only; steps from marks (⚠ too), step blocks or the plan file', () => {
  const dir = project();
  putTask(dir, 'A-1', { updated: '2026-10-10' }, '- ✅ first\n- ◐ 40% second\n- ⚠ third: broke after the merge\n- ⬜ fourth\n\n## Decisions and why\n- SECRET-DECISION-TEXT');
  const stepBlocks = '### Step 1: one\n- files: `a.js`\n- model: haiku\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ✅\n\n### Step 2: two\n- files: `b.js`\n- model: haiku\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ⬜\n';
  putTask(dir, 'B-2', { updated: '2026-10-09', source: 'jira', link: 'https://tracker.example/B-2', branch: 'B-2-login' }, stepBlocks);
  write(dir, 'plan-c.md', `# plan\n\n${stepBlocks}\n${stepBlocks.replace(/Step 1: one/, 'Step 3: three').replace('Step 2: two', 'Step 4: four')}`);
  putTask(dir, 'C-3', { updated: '2026-10-08', plan: path.join(dir, 'plan-c.md') }, 'see the plan file');
  putTask(dir, 'D-4', { updated: '2026-10-07' }, 'no marks here');
  putTask(dir, 'E-5', { updated: '2026-10-06', plan: 'plan.md' }, 'see plan.md');
  write(dir, '.keel/tasks/E-5/plan.md', `# plan\n\n${stepBlocks.replace('status: ⬜', 'status: ✅')}`);
  putTask(dir, 'F-6', { updated: '2026-10-05' }, '- ✅ old layout\n- ⬜ next', 'Plan');
  const out = tasks.taskList(dir, 's1', new Date(2026, 9, 14));
  assert.equal(out[0], 'tasks: 6 unfinished (A-1, B-2, C-3, D-4, E-5, F-6)', 'newest update first');
  assert.ok(has(out, 'B-2', 'steps 1/2'));
  assert.ok(has(out, 'C-3', 'steps 2/4'), 'the plan file wins over the State section');
  assert.ok(!has(out, 'D-4', 'steps'), 'no steps marked: no steps part');
  assert.ok(has(out, 'E-5', 'steps 2/2'), 'plan.md in the task folder');
  assert.deepEqual(block(out, 'F-6'), ['  Source: text', '  State: handed off 9 days ago · steps 1/2', '  Next: Do the next thing of F-6', '  Files: .keel/tasks/F-6/', '  Goal: Goal of F-6'], 'steps from a Plan section when there is no State section');
  assert.ok(out.includes('A-1 · Title of A-1'));
  assert.deepEqual(block(out, 'A-1'), [
    '  Source: text',
    '  State: handed off 4 days ago · steps 1/4',
    '  Next: Do the next thing of A-1',
    '  Files: .keel/tasks/A-1/',
    '  Goal: Goal of A-1',
  ]);
  assert.deepEqual(block(out, 'B-2').slice(0, 2), ['  Source: Jira — https://tracker.example/B-2', '  State: handed off 5 days ago · steps 1/2 · branch B-2-login']);
  assert.doesNotMatch(out.join('\n'), /SECRET-DECISION-TEXT/, 'only the listed fields are printed');
});

test('check: tasks line, sizes of the task files and the session\'s active task', () => {
  const dir = project();
  assert.equal(line(notes(dir, 'check'), 'tasks:'), 'tasks: 0 unfinished');
  assert.equal(line(notes(dir, 'check'), 'task files:'), '', 'no task here: no size line');
  assert.equal(line(notes(dir, 'check'), 'active task:'), '', 'no session given: no active task line');
  for (let i = 1; i <= 10; i++) putTask(dir, `T-${String(i).padStart(2, '0')}`);
  let out = notes(dir, 'check', '--session', 's1');
  assert.match(line(out, 'tasks:'), /^tasks: 10 unfinished \((T-[\w-]+, ){7}T-[\w-]+, \.\.\.\)$/, 'long lists are cut');
  assert.equal(line(out, 'task files:'), 'task files: 10 in this working tree; over the limit of 150 lines: none');
  assert.equal(line(out, 'active task:'), 'active task: none');
  putTask(dir, 'T-03', {}, '- ⬜ x\n'.repeat(160));
  out = notes(dir, 'check');
  assert.match(line(out, 'task files:'), /over the limit of 150 lines: T-03 \(\d{3} lines\)$/);
});

test('check: the next session log is one past the highest number of the local day, never a log that exists', () => {
  const dir = project();
  // Far east and far west of UTC: at any hour one of them is on another day than UTC.
  for (const TZ of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    const day = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
    const next = () => line(spawnSync(process.execPath, [path.join(SCRIPTS, 'notes.js'), dir, 'check'], { encoding: 'utf8', env: { ...process.env, TZ } }).stdout.split('\n'), 'next session log:');
    fs.rmSync(path.join(dir, '.keel', 'sessions'), { recursive: true, force: true });
    assert.equal(next(), `next session log: .keel/sessions/${day}-001.md`, TZ);
    write(dir, `.keel/sessions/${day}-002.md`, 'x\n');
    assert.equal(next(), `next session log: .keel/sessions/${day}-003.md`, `${TZ}: a gap in the numbers`);
    write(dir, `.keel/sessions/${day}-010.md`, 'x\n');
    write(dir, `.keel/sessions/${day}-notes.md`, 'x\n');
    write(dir, '.keel/sessions/1999-01-01-050.md', 'x\n');
    assert.equal(next(), `next session log: .keel/sessions/${day}-011.md`, `${TZ}: other days and names do not count`);
    write(dir, `.keel/sessions/${day}-012-old-note.md`, 'x\n');
    assert.equal(next(), `next session log: .keel/sessions/${day}-013.md`, `${TZ}: a numbered name with a suffix counts`);
  }
});

gitTest('check: a session start recorded on another branch is named with its commit, not reported missing', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'feat');
  write(dir, 'src/app.js', 'two\n');
  commitAll(dir, 'feat work');
  const sha = git(dir, 'rev-parse', '--short=7', 'HEAD');
  assert.match(line(notes(dir, 'check', '--begin'), 'session start:'), /0 commits since/);
  git(dir, 'switch', '-q', 'main');
  const start = line(notes(dir, 'check'), 'session start:');
  assert.match(start, new RegExp(`^session start: ${sha} at \\S+, recorded on branch feat; not in the history of HEAD`));
  assert.doesNotMatch(start, /verify with --base/);
});

test('activate, active, deactivate: several sessions work on different tasks', () => {
  const dir = project();
  putTask(dir, 'A-1', { status: 'handed-off', updated: '2026-01-01' });
  putTask(dir, 'B-2');
  assert.deepEqual(notes(dir, 'task', 'activate', 'A-1', '--session', 's1'), ['active task: A-1', 'file: .keel/tasks/A-1/task.md']);
  notes(dir, 'task', 'activate', 'B-2', '--session', 's2');
  const text = fs.readFileSync(path.join(dir, taskPath('A-1')), 'utf8');
  assert.match(text, /^status: active$/m, 'resuming makes the task active again');
  assert.doesNotMatch(text, /updated: 2026-01-01/);
  assert.equal(notes(dir, 'task', 'active', '--session', 's1')[0], 'active task: A-1');
  assert.equal(notes(dir, 'task', 'active', '--session', 's2')[0], 'active task: B-2');
  assert.equal(notes(dir, 'task', 'active', '--session', 's3')[0], 'active task: none');
  assert.equal(line(notes(dir, 'check', '--session', 's2'), 'active task:'), 'active task: B-2');
  const list = notes(dir, 'tasks', '--session', 's1');
  assert.ok(has(list, 'A-1', 'State: active in this session'));
  assert.ok(has(list, 'B-2', 'State: active in another session'));
  // a marker of a session that has been idle for days is not worth a warning
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(dir, '.keel', 'local', 'active', 's2.json'), old, old);
  assert.ok(has(notes(dir, 'tasks', '--session', 's1'), 'B-2', 'State: active, updated'));
  assert.equal(notes(dir, 'task', 'deactivate', '--session', 's1')[0], 'active task: none');
  assert.equal(notes(dir, 'task', 'active', '--session', 's1')[0], 'active task: none');
  assert.ok(exists(dir, taskPath('A-1')), 'deactivate leaves the file');
  assert.match(notes(dir, 'task', 'activate', 'NOPE-1', '--session', 's1')[0], /no task "NOPE-1"/);
  assert.match(notes(dir, 'task', 'activate', 'A-1')[0], /needs --session/);
});

test('delete: only the finished task\'s folder goes, into keel\'s trash; out of the list, marker cleared; restore brings it back', () => {
  const dir = project(CONFIG({ cleanup: { trash_max_age_days: 10 } }));
  putTask(dir, 'A-1');
  write(dir, '.keel/tasks/A-1/plan.md', '# plan\n');
  putTask(dir, 'B-2');
  notes(dir, 'task', 'activate', 'A-1', '--session', 's1');
  const out = finish(dir, 'A-1', '--session', 's1');
  assert.equal(out[0], "deleted: .keel/tasks/A-1/ (moved to keel's trash)");
  assert.match(out[1], /^trash batch: \d{8}-\d{6}/);
  assert.equal(out[2], 'active task: none');
  assert.ok(!exists(dir, '.keel/tasks/A-1'));
  assert.ok(exists(dir, taskPath('B-2')), 'the other task stays');
  assert.ok(!exists(dir, '.keel/local/archive'), 'no archive');
  assert.equal(notes(dir, 'task', 'active', '--session', 's1')[0], 'active task: none');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 1 unfinished (B-2)');
  assert.match(notes(dir, 'task', 'delete', 'A-1')[0], /no task "A-1"/);
  assert.match(notes(dir, 'task', 'delete', '../B-2')[0], /^notes: task delete refused \(invalid id/);
  assert.match(notes(dir, 'task', 'delete', '.keel')[0], /invalid id/);
  assert.match(notes(dir, 'task', 'delete')[0], /invalid id/);
  // another task deleted the same way
  putTask(dir, 'L-1');
  assert.match(finish(dir, 'L-1')[0], /^deleted: \.keel\/tasks\/L-1\/ \(moved to keel's trash\)/);
  assert.ok(exists(dir, taskPath('B-2')));
  // a task that was never committed is not lost when git stops after the deletion
  assert.match(run('cleanup.js', dir, 'restore')[0], /restored 1 items/);
  assert.ok(exists(dir, taskPath('L-1')));
  const batches = fs.readdirSync(path.join(dir, '.keel', 'local', 'trash'));
  assert.equal(batches.length, 1);
  assert.match(run('cleanup.js', dir, 'restore', batches[0])[0], /restored 1 items/);
  assert.equal(fs.readFileSync(path.join(dir, '.keel/tasks/A-1/plan.md'), 'utf8'), '# plan\n');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 3 unfinished (A-1, B-2, L-1)');
  assert.match(notes(dir, 'lane', 'A-1')[0], /^lane: task/, 'a restored task leads its key again');
});

test('delete refuses links: a linked tasks folder, a linked task folder or a link inside never lead outside', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-outside-'));
  write(outside, 'X-1/task.md', TASK('X-1'));
  write(outside, 'keep.txt', 'precious\n');
  const link = (target, at) => fs.symlinkSync(target, at, 'junction');

  // .keel/tasks itself is a link to a folder outside the project
  const a = project();
  link(outside, path.join(a, '.keel', 'tasks'));
  assert.match(notes(a, 'task', 'delete', 'X-1')[0], /^notes: task delete refused \(a folder on its path is a link\)/);
  assert.match(notes(a, 'task', 'drop', 'X-1')[0], /refused \(a folder on its path is a link\)/);
  assert.ok(fs.existsSync(path.join(outside, 'X-1', 'task.md')));

  // a task folder that is a link is not a task at all
  const b = project();
  fs.mkdirSync(path.join(b, '.keel', 'tasks'), { recursive: true });
  link(path.join(outside, 'X-1'), path.join(b, '.keel', 'tasks', 'X-1'));
  assert.match(notes(b, 'task', 'delete', 'X-1')[0], /no task "X-1"/);
  assert.ok(fs.existsSync(path.join(outside, 'X-1', 'task.md')));

  // a link inside the task folder
  const c = project();
  putTask(c, 'C-1');
  link(outside, path.join(c, '.keel', 'tasks', 'C-1', 'more'));
  assert.match(notes(c, 'task', 'delete', 'C-1')[0], /refused \(the folder holds a link\)/);
  assert.ok(exists(c, taskPath('C-1')) && fs.existsSync(path.join(outside, 'keep.txt')));
});

test('drop: the task folder goes to keel\'s trash and /keel:cleanup restore brings it back', () => {
  const dir = project();
  putTask(dir, 'A-1');
  notes(dir, 'task', 'activate', 'A-1', '--session', 's1');
  const out = notes(dir, 'task', 'drop', 'A-1');
  assert.equal(out[0], 'dropped: A-1');
  assert.match(out[1], /^trash batch: \d{8}-\d{6}/);
  assert.ok(!exists(dir, '.keel/tasks/A-1'));
  assert.equal(notes(dir, 'task', 'active', '--session', 's1')[0], 'active task: none');
  assert.equal(line(notes(dir, 'tasks'), 'tasks:'), 'tasks: 0 unfinished');
  const trash = JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'trash', fs.readdirSync(path.join(dir, '.keel', 'local', 'trash'))[0], 'manifest.json'), 'utf8'));
  assert.equal(trash.by, 'task');
  assert.deepEqual(trash.items.map((i) => [i.path, i.kind]), [['.keel/tasks/A-1', 'folder']]);
  assert.match(run('cleanup.js', dir, 'restore')[0], /restored 1 items/);
  assert.ok(exists(dir, taskPath('A-1')));
  assert.equal(line(notes(dir, 'tasks'), 'tasks:'), 'tasks: 1 unfinished (A-1)');
  assert.match(notes(dir, 'task', 'drop', 'NOPE')[0], /no task "NOPE"/);
});

test('lane: an unfinished task belongs to start-task, a key in the note to start-session, else nobody', () => {
  const dir = project();
  putTask(dir, 'CAN-1');
  write(dir, '.keel/next-session.md', '---\nstatus: active\nkeys: CAN-9, CAN-10\n---\n\n# Next session\n');
  assert.match(notes(dir, 'lane', 'CAN-1')[0], /^lane: task \(CAN-1 is an unfinished keel task/);
  assert.match(notes(dir, 'lane', 'can-1')[0], /^lane: task/, 'keys compare without case');
  assert.match(notes(dir, 'lane', 'CAN-10')[0], /^lane: session \(the note \.keel\/next-session\.md names CAN-10/);
  assert.equal(notes(dir, 'lane', 'CAN-2')[0], 'lane: none');
  assert.match(notes(dir, 'lane')[0], /^notes: lane refused/);
  finish(dir, 'CAN-1');
  assert.equal(notes(dir, 'lane', 'CAN-1')[0], 'lane: none (task CAN-1 was finished or dropped earlier)');
  write(dir, '.keel/next-session.md', '---\nstatus: done\nkeys: CAN-9, CAN-10\n---\n');
  assert.equal(notes(dir, 'lane', 'CAN-10')[0], 'lane: none', 'a finished line owns nothing');
});

test('only task folders are tasks: a README.md in .keel/tasks is neither listed nor a lane', () => {
  const dir = project();
  write(dir, '.keel/tasks/README.md', '# Tasks\n\nOne folder per task.\n');
  assert.equal(line(notes(dir, 'tasks'), 'tasks:'), 'tasks: 0 unfinished');
  assert.doesNotMatch(notes(dir, 'lane', 'readme')[0], /^lane: task/);
  putTask(dir, 'A-1');
  const out = notes(dir, 'tasks');
  assert.equal(line(out, 'tasks:'), 'tasks: 1 unfinished (A-1)');
  assert.ok(!out.some((l) => /README/i.test(l)), 'the README is not in the list');
});

test('unknown commands are named, not guessed', () => {
  const dir = project();
  assert.match(notes(dir, 'clear-task')[0], /unknown command "clear-task" \(check, tasks, lane, task\)/);
  assert.match(notes(dir, 'task', 'finish', 'A-1')[0], /unknown task command "finish"/);
  assert.match(notes(dir, 'task', 'reopen', 'A-1')[0], /unknown task command "reopen"/);
});

// --- tasks that live on branches ---

gitTest('tasks: a handed-off task is listed from its branch, local or remote-tracking, newest update wins', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'PROJ-1-export');
  putTask(dir, 'PROJ-1', { branch: 'PROJ-1-export', updated: '2026-10-05' });
  write(dir, '.keel/tasks/PROJ-1/plan.md', '### Step 1: a\n- files: `a.js`\n- model: haiku\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ✅\n');
  commitAll(dir, 'handoff');
  git(dir, 'switch', '-q', 'main');
  assert.ok(!exists(dir, '.keel/tasks/PROJ-1'), 'the folder is not on the main branch');
  let out = notes(dir, 'tasks');
  assert.equal(out[0], 'tasks: 1 unfinished (PROJ-1)');
  assert.ok(has(out, 'PROJ-1', 'Files: .keel/tasks/PROJ-1/ (on branch PROJ-1-export)'));
  assert.ok(has(out, 'PROJ-1', 'steps 1/1'), 'the plan.md of the branch is read');
  assert.match(line(notes(dir, 'check'), 'tasks:'), /PROJ-1/);

  // another local branch holds an older copy of the same task: the newest one is shown
  git(dir, 'switch', '-q', '-c', 'old-copy', 'main');
  putTask(dir, 'PROJ-1', { updated: '2026-09-01' });
  commitAll(dir, 'older');
  git(dir, 'switch', '-q', 'main');
  out = notes(dir, 'tasks');
  assert.equal(out[0], 'tasks: 1 unfinished (PROJ-1)', 'deduplicated by id');
  assert.ok(has(out, 'PROJ-1', '(on branch PROJ-1-export)'));

  // a branch that exists only as a remote-tracking ref
  git(dir, 'switch', '-q', '-c', 'GH-9-x', 'main');
  putTask(dir, 'gh-9', { updated: '2026-10-06' });
  commitAll(dir, 'other machine');
  git(dir, 'update-ref', 'refs/remotes/origin/GH-9-x', 'GH-9-x');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'branch', '-q', '-D', 'GH-9-x');
  out = notes(dir, 'tasks');
  assert.equal(out[0], 'tasks: 2 unfinished (gh-9, PROJ-1)');
  assert.ok(has(out, 'gh-9', 'Files: .keel/tasks/gh-9/ (on branch origin/GH-9-x)'));

  // the working tree copy wins a tie, and changing a task needs it in this working tree
  assert.match(notes(dir, 'task', 'activate', 'PROJ-1', '--session', 's1')[0], /task PROJ-1 is on branch PROJ-1-export: switch to it first/);
  assert.match(notes(dir, 'task', 'delete', 'PROJ-1')[0], /switch to it first/);
  assert.match(notes(dir, 'task', 'drop', 'PROJ-1')[0], /switch to it first/);
  git(dir, 'switch', '-q', 'PROJ-1-export');
  assert.deepEqual(notes(dir, 'task', 'activate', 'PROJ-1', '--session', 's1'), ['active task: PROJ-1', 'file: .keel/tasks/PROJ-1/task.md']);
  assert.ok(has(notes(dir, 'tasks'), 'PROJ-1', 'Files: .keel/tasks/PROJ-1/'));
});

gitTest('tasks: a project in a sub-folder of the repository still lists the tasks of other branches', () => {
  const top = repo();
  const dir = path.join(top, 'app');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG()));
  write(dir, '.keel/.gitignore', 'local/\n');
  commitAll(top, 'app');
  git(top, 'switch', '-q', '-c', 'PROJ-2-x');
  putTask(dir, 'PROJ-2', { branch: 'PROJ-2-x' });
  commitAll(top, 'handoff');
  git(top, 'switch', '-q', 'main');
  const out = notes(dir, 'tasks');
  assert.equal(out[0], 'tasks: 1 unfinished (PROJ-2)');
  assert.ok(has(out, 'PROJ-2', 'Files: .keel/tasks/PROJ-2/ (on branch PROJ-2-x)'));
});

gitTest('tasks.in_git: false reads no branches', () => {
  const dir = repo(CONFIG({ tasks: { in_git: false } }));
  git(dir, 'switch', '-q', '-c', 'PROJ-1-export');
  putTask(dir, 'PROJ-1');
  commitAll(dir, 'handoff');
  git(dir, 'switch', '-q', 'main');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 0 unfinished');
});

gitTest('delete runs before the branch\'s final commit: the folder never lands on main', () => {
  const dir = repo();
  const flow = (...args) => run('git-flow.js', dir, ...args);
  assert.equal(flow('start', '--name', 'PROJ-2-feature')[0], 'git-flow: ok');
  notes(dir, 'task', 'new', 'PROJ-2', '--title', 'Feature', '--source', 'jira', '--session', 's1');
  write(dir, '.keel/tasks/PROJ-2/plan.md', '# plan\n');
  write(dir, 'src/app.js', 'two\n');
  write(dir, '.keel/local/tmp/commit-message.txt', 'feat: first\n');
  assert.equal(flow('commit', '--message-file', path.join(dir, '.keel/local/tmp/commit-message.txt'))[0], 'git-flow: ok');
  assert.equal(git(dir, 'ls-tree', '-r', '--name-only', 'HEAD', '.keel/tasks/'), '.keel/tasks/PROJ-2/plan.md\n.keel/tasks/PROJ-2/task.md', 'the task folder travels with the branch');
  assert.equal(git(dir, 'ls-tree', '--name-only', 'main', '.keel/tasks/'), '');

  // end-task, finish: the folder is deleted, then git commits and merges
  const out = finish(dir, 'PROJ-2', '--session', 's1');
  assert.match(out[0], /^deleted: \.keel\/tasks\/PROJ-2\/ \(moved to keel's trash\)/);
  assert.ok(out.includes('it was tracked in git: the removal is a change in the next commit'));
  write(dir, '.keel/local/tmp/commit-message.txt', 'feat: finish\n');
  assert.equal(flow('commit', '--message-file', path.join(dir, '.keel/local/tmp/commit-message.txt'))[0], 'git-flow: ok');
  assert.equal(git(dir, 'ls-tree', '--name-only', 'HEAD', '.keel/tasks/'), '', 'the final commit removes the folder');
  assert.equal(flow('merge')[0], 'git-flow: ok');
  assert.equal(git(dir, 'branch', '--show-current'), 'main');
  assert.equal(git(dir, 'ls-tree', '--name-only', 'main', '.keel/tasks/'), '', 'never on the main branch');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'nothing is left over after the merge');
  // the finished task is not listed again from the old commits of its branch
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 0 unfinished');
});

gitTest('delete: a stale copy on another branch is not listed again; a later update of it is', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'stale', 'main');
  putTask(dir, 'S-1', { updated: '2026-10-05' });
  commitAll(dir, 'stale copy');
  git(dir, 'switch', '-q', '-c', 'work', 'main');
  putTask(dir, 'S-1', { updated: '2026-10-05' });
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 1 unfinished (S-1)');
  finish(dir, 'S-1');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 0 unfinished');
  git(dir, 'switch', '-q', 'stale');
  putTask(dir, 'S-1', { updated: '2026-10-12' });
  commitAll(dir, 'continued elsewhere');
  git(dir, 'switch', '-q', 'main');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 1 unfinished (S-1)');
});

gitTest('tasks: the base branch moving on is reported for a handed-off task', () => {
  const dir = repo();
  const last = git(dir, 'rev-parse', '--short', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'PROJ-3-x');
  putTask(dir, 'PROJ-3', { status: 'handed-off', branch: 'PROJ-3-x', after_commit: last, updated: '2026-10-05' });
  commitAll(dir, 'handoff');
  git(dir, 'switch', '-q', 'main');
  assert.ok(!has(notes(dir, 'tasks'), 'PROJ-3', 'Base moved'), 'nothing moved yet');
  write(dir, 'src/app.js', 'two\n');
  commitAll(dir, 'main moves on');
  write(dir, 'src/app.js', 'three\n');
  commitAll(dir, 'and again');
  assert.ok(block(notes(dir, 'tasks'), 'PROJ-3').includes('  Base moved: 2 commits on main since the handoff (git-flow.js sync brings them in)'));
  // an active task is being worked on now: no handoff comparison
  git(dir, 'switch', '-q', 'PROJ-3-x');
  notes(dir, 'task', 'activate', 'PROJ-3', '--session', 's1');
  assert.ok(!has(notes(dir, 'tasks', '--session', 's1'), 'PROJ-3', 'Base moved'));
});

gitTest('inventory: the task files, branch, commits and changed files not in the base, docs among them', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'PROJ-6-x');
  putTask(dir, 'PROJ-6', { branch: 'PROJ-6-x', status: 'active' });
  write(dir, 'src/feature.js', 'x\n');
  write(dir, 'docs/feature.md', '# feature\n');
  commitAll(dir, 'feat: the feature');
  write(dir, 'src/app.js', 'dirty\n');
  const out = notes(dir, 'task', 'inventory', 'PROJ-6');
  assert.equal(out[0], 'task: PROJ-6 · Title of PROJ-6');
  assert.equal(out[1], 'task files: .keel/tasks/PROJ-6/ (task.md)');
  assert.equal(line(out, 'branch:'), 'branch: PROJ-6-x (local: yes; pushed: no); the current branch');
  assert.equal(line(out, 'commits not in main:'), 'commits not in main: 1');
  assert.ok(out.some((l) => /^ {2}[0-9a-f]{7,} feat: the feature$/.test(l)));
  assert.equal(line(out, 'changed files vs main:'), 'changed files vs main: 2');
  assert.ok(out.includes('  docs/feature.md') && out.includes('  src/feature.js') && !out.some((l) => l.startsWith('  .keel/')), 'keel\'s own files are not the task\'s code');
  assert.equal(line(out, 'docs among them:'), 'docs among them: 1 (docs/feature.md)');
  assert.equal(line(out, 'uncommitted changes:'), 'uncommitted changes: 1 files');
  assert.match(notes(dir, 'task', 'inventory', 'NOPE')[0], /no task "NOPE"/);
  const bare = project();
  putTask(bare, 'T-1');
  assert.deepEqual(notes(bare, 'task', 'inventory', 'T-1'), ['task: T-1 · Title of T-1', 'task files: .keel/tasks/T-1/ (task.md)', 'branch: none recorded']);
});

gitTest('changes.js does not count task folders as part of the code change', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'PROJ-4-x');
  putTask(dir, 'PROJ-4');
  commitAll(dir, 'task');
  putTask(dir, 'PROJ-4', { updated: '2026-10-09' }, '- ✅ x');
  write(dir, '.keel/tasks/PROJ-4/plan.md', '# plan\n');
  putTask(dir, 'PROJ-5');
  write(dir, 'src/app.js', 'one\ntwo\n');
  const out = run('changes.js', dir, '--base', 'main').join('\n');
  assert.match(out, /changes: 1 files/);
  assert.doesNotMatch(out, /\.keel\/tasks/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'changes.diff'), 'utf8'), /\.keel\/tasks/);
});

test('session-start hook tells the model its session id for --session', () => {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'session-start.js')], { input: JSON.stringify({ source: 'clear', session_id: 'abc-123' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: project() } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^keel session id \(for --session\): abc-123$/m);
  const bad = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'session-start.js')], { input: JSON.stringify({ session_id: '../x; rm' }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: project() } });
  assert.doesNotMatch(JSON.parse(bad.stdout).hookSpecificOutput.additionalContext, /keel session id/);
});

// --- edge cases from review ---

test('ids: Windows device names and a trailing dot are refused, so `git add -A` never breaks', () => {
  for (const id of ['CON', 'con', 'Nul', 'nul.txt', 'PRN', 'aux.a.b', 'COM1', 'com9.md', 'LPT1', 'lpt5.x', 'a.', 'PROJ-1.']) assert.equal(tasks.validId(id), false, id);
  for (const id of ['CONSOLE', 'com10', 'com0', 'nullable', 'aux-1', 'a.b']) assert.equal(tasks.validId(id), true, id);
  const dir = project();
  assert.match(notes(dir, 'task', 'new', 'NUL', '--title', 'x', '--source', 'text')[0], /invalid id "NUL".*Windows device name/);
  assert.ok(!exists(dir, '.keel/tasks'));
});

test('ids compare without case: a second task cannot take the folder of the first', () => {
  const dir = project();
  notes(dir, 'task', 'new', 'Foo', '--title', 'First', '--source', 'text');
  assert.match(notes(dir, 'task', 'new', 'foo', '--title', 'Second', '--source', 'text')[0], /^notes: task new refused \(task Foo already exists/);
  assert.match(fs.readFileSync(path.join(dir, taskPath('Foo')), 'utf8'), /^title: First$/m);
  fs.mkdirSync(path.join(dir, '.keel', 'tasks', 'BAR'));
  assert.match(notes(dir, 'task', 'new', 'bar', '--title', 'x', '--source', 'text')[0], /refused \(\.keel\/tasks\/BAR exists/, 'a folder without task.md too');
  assert.deepEqual(notes(dir, 'task', 'activate', 'FOO', '--session', 's1'), ['active task: Foo', 'file: .keel/tasks/Foo/task.md']);
  assert.ok(has(notes(dir, 'tasks', '--session', 's1'), 'Foo', 'active in this session'));
  assert.equal(notes(dir, 'task', 'active', '--session', 's1')[0], 'active task: Foo');
});

gitTest('ids compare without case across branches: one entry per task', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'other');
  putTask(dir, 'case-1', { updated: '2026-10-01' });
  commitAll(dir, 'lower');
  git(dir, 'switch', '-q', 'main');
  putTask(dir, 'CASE-1', { updated: '2026-10-02' });
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 1 unfinished (CASE-1)');
});

gitTest('a task made again after it was dropped or finished is listed from its branch, the same day too', () => {
  const dir = repo();
  notes(dir, 'task', 'new', 'R-1', '--title', 'First try', '--source', 'text');
  assert.equal(notes(dir, 'task', 'drop', 'R-1')[0], 'dropped: R-1');
  git(dir, 'switch', '-q', '-c', 'R-1-again');
  notes(dir, 'task', 'new', 'R-1', '--title', 'Second try', '--source', 'text');
  commitAll(dir, 'handoff');
  git(dir, 'switch', '-q', 'main');
  const out = notes(dir, 'tasks');
  assert.equal(out[0], 'tasks: 1 unfinished (R-1)');
  assert.ok(out.includes('R-1 · Second try'));
  // made again elsewhere (another clone) on the day it was closed here: a copy never seen is listed
  git(dir, 'switch', '-q', '-c', 'stale', 'main');
  putTask(dir, 'S-1', { updated: '2026-10-05' });
  commitAll(dir, 'stale copy');
  git(dir, 'switch', '-q', 'main');
  putTask(dir, 'S-1', { updated: '2026-10-05' });
  finish(dir, 'S-1');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 1 unfinished (R-1)', 'the copy seen at closing is stale');
  git(dir, 'switch', '-q', '-c', 'elsewhere', 'main');
  putTask(dir, 'S-1', { updated: '2026-10-05', title: 'Made again' });
  commitAll(dir, 'new S-1 from another clone');
  git(dir, 'switch', '-q', 'main');
  assert.ok(notes(dir, 'tasks').includes('S-1 · Made again'));
});

gitTest('ids like constructor or toString are plain ids', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'protos');
  putTask(dir, 'constructor');
  putTask(dir, 'toString');
  commitAll(dir, 'odd ids');
  git(dir, 'switch', '-q', 'main');
  assert.equal(notes(dir, 'tasks')[0], 'tasks: 2 unfinished (constructor, toString)');
  assert.match(notes(dir, 'lane', 'constructor')[0], /^lane: task/);
  assert.equal(notes(dir, 'lane', 'hasOwnProperty')[0], 'lane: none');
  notes(dir, 'task', 'new', 'valueOf', '--title', 'x', '--source', 'text');
  finish(dir, 'valueOf');
  assert.equal(notes(dir, 'lane', 'valueOf')[0], 'lane: none (task valueOf was finished or dropped earlier)');
});

test('a byte order mark does not hide the front matter; a task file without one is not activated', () => {
  const dir = project();
  write(dir, taskPath('B-1'), `﻿${TASK('B-1', { updated: '2026-10-03' })}`);
  assert.ok(notes(dir, 'tasks').includes('B-1 · Title of B-1'));
  assert.equal(notes(dir, 'task', 'activate', 'B-1', '--session', 's1')[0], 'active task: B-1');
  assert.match(fs.readFileSync(path.join(dir, taskPath('B-1')), 'utf8'), /^---\nid: B-1[\s\S]*^status: active$/m);
  write(dir, taskPath('N-1'), '# N-1\n\n## Goal\nno front matter\n');
  const before = fs.readFileSync(path.join(dir, taskPath('N-1')), 'utf8');
  assert.match(notes(dir, 'task', 'activate', 'N-1', '--session', 's2')[0], /^notes: task activate refused \(\.keel\/tasks\/N-1\/task\.md has no front matter/);
  assert.equal(fs.readFileSync(path.join(dir, taskPath('N-1')), 'utf8'), before);
  assert.equal(notes(dir, 'task', 'active', '--session', 's2')[0], 'active task: none');
});

test('a status line takes its first symbol: "⚠ broken, was ✅" is not done', () => {
  const { parseSteps } = require(path.join(SCRIPTS, 'plan-steps.js'));
  const step = (status) => `### Step 1: a\n- files: \`a.js\`\n- model: haiku\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ${status}\n`;
  for (const [status, want] of [['⚠ broken, was ✅', 'broken'], ['✅ done (was ⚠)', 'done'], ['◐ 40%, ✅ soon', 'partial 40%'], ['⬜ not done, ✅ next', 'not done'], ['broken ✅', 'broken']]) {
    const [s] = parseSteps(step(status));
    assert.equal(s.status, want, status);
    assert.equal(s.done, want === 'done', status);
  }
  const dir = project();
  putTask(dir, 'S-1', {}, step('⚠ broke after the merge, was ✅'));
  putTask(dir, 'S-2', {}, '- ⚠ x, was ✅\n- ✅ y');
  const out = notes(dir, 'tasks');
  assert.ok(has(out, 'S-1', 'steps 0/1'));
  assert.ok(has(out, 'S-2', 'steps 1/2'));
});

test('listed fields are one short line: control characters out, at most 160 characters', () => {
  const dir = project();
  const esc = '\u001b[31m';
  putTask(dir, 'L-1', { title: `Red ${esc}title ${'x'.repeat(300)}`, link: `https://t.example/${esc}${'y'.repeat(300)}`, branch: `b-${'z'.repeat(300)}`, source: `mail${esc}` });
  const out = notes(dir, 'tasks');
  assert.doesNotMatch(out.join('\n'), /\u001b/);
  const head = out.find((l) => l.startsWith('L-1 · '));
  assert.match(head, /^L-1 · Red \[31mtitle x+…$/);
  assert.equal(head.length, 'L-1 · '.length + 160);
  for (const l of block(out, 'L-1')) assert.ok(l.length < 400, l.slice(0, 40));
  assert.doesNotMatch(notes(dir, 'task', 'inventory', 'L-1').join('\n'), /\u001b/);
  assert.doesNotMatch(notes(dir, 'lane', `x${esc}`).join('\n'), /\u001b/);
});

gitTest('branches that share a commit or a tasks tree are read once', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'base-tasks');
  putTask(dir, 'P-1');
  commitAll(dir, 'task');
  for (let i = 0; i < 25; i++) git(dir, 'branch', `same-${i}`);
  for (let i = 0; i < 5; i++) {
    git(dir, 'switch', '-q', '-c', `own-${i}`, 'base-tasks');
    write(dir, `src/f${i}.js`, `${i}\n`);
    commitAll(dir, `code ${i}`);
  }
  git(dir, 'switch', '-q', 'main');
  const trace = path.join(project(), 'git-trace.txt');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'notes.js'), dir, 'tasks'], { encoding: 'utf8', env: { ...process.env, GIT_TRACE: trace } });
  assert.equal(r.stdout.split('\n')[0], 'tasks: 1 unfinished (P-1)');
  const calls = fs.readFileSync(trace, 'utf8').split('\n').filter((l) => /built-in: git .*ls-tree/.test(l)).length;
  assert.equal(calls, 1, 'one ls-tree for 31 branches with one tasks tree');
});

gitTest('the task files of many branches are read by one git process', () => {
  const dir = repo();
  for (let i = 0; i < 6; i++) {
    git(dir, 'switch', '-q', '-c', `t-${i}`, 'main');
    putTask(dir, `T-${i}`, { updated: `2026-10-0${i + 1}` });
    write(dir, `.keel/tasks/T-${i}/plan.md`, `# plan ${i}\n`);
    commitAll(dir, `task ${i}`);
  }
  git(dir, 'switch', '-q', 'main');
  const trace = path.join(project(), 'git-trace.txt');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'notes.js'), dir, 'tasks'], { encoding: 'utf8', env: { ...process.env, GIT_TRACE: trace } });
  assert.equal(r.stdout.split('\n')[0], 'tasks: 6 unfinished (T-5, T-4, T-3, T-2, T-1, T-0)');
  assert.match(r.stdout, /^T-3 · Title of T-3$/m);
  const lines = fs.readFileSync(trace, 'utf8').split('\n');
  assert.equal(lines.filter((l) => /built-in: git .*cat-file .*--batch(?![-=])/.test(l)).length, 1, 'one cat-file --batch for every blob');
  assert.equal(lines.filter((l) => /built-in: git .*cat-file blob/.test(l)).length, 0);
});

gitTest('after_commit: the commit a session note was written after', () => {
  for (const field of ['after_commit']) {
    const dir = repo();
    const at = git(dir, 'rev-parse', '--short', 'HEAD');
    write(dir, 'src/app.js', 'two\n');
    commitAll(dir, 'main moves on');
    write(dir, '.keel/next-session.md', `---\nstatus: active\nbranch: main\n${field}: ${at}\ndate: 2026-10-10\n---\n\n# Next session\n`);
    assert.match(line(notes(dir, 'check'), 'note behind:'), new RegExp(`main has 1 new commits; .*\\(since ${at}, ${field} in the note`), field);
  }
});

gitTest('after_commit: the handoff commit of a task file', () => {
  for (const field of ['after_commit']) {
    const dir = repo();
    const last = git(dir, 'rev-parse', '--short', 'HEAD');
    git(dir, 'switch', '-q', '-c', 'H-1-x');
    putTask(dir, 'H-1', { status: 'handed-off', branch: 'H-1-x', [field]: last, updated: '2026-10-05' });
    commitAll(dir, 'handoff');
    git(dir, 'switch', '-q', 'main');
    write(dir, 'src/app.js', 'two\n');
    commitAll(dir, 'main moves on');
    assert.ok(block(notes(dir, 'tasks'), 'H-1').includes('  Base moved: 1 commits on main since the handoff (git-flow.js sync brings them in)'), field);
  }
});

test('task new and activate never write through a link', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-outside-'));
  write(outside, 'X-1/task.md', TASK('X-1'));
  const before = fs.readFileSync(path.join(outside, 'X-1', 'task.md'), 'utf8');
  const dir = project();
  fs.symlinkSync(outside, path.join(dir, '.keel', 'tasks'), 'junction');
  assert.match(notes(dir, 'task', 'new', 'N-1', '--title', 'x', '--source', 'text')[0], /^notes: task new refused \(.*link/);
  assert.match(notes(dir, 'task', 'activate', 'X-1', '--session', 's1')[0], /^notes: task activate refused \(.*link/);
  assert.ok(!fs.existsSync(path.join(outside, 'N-1')));
  assert.equal(fs.readFileSync(path.join(outside, 'X-1', 'task.md'), 'utf8'), before);
});

gitTest('inventory: only real documentation counts as docs', () => {
  const dir = repo();
  git(dir, 'switch', '-q', '-c', 'D-1-x');
  putTask(dir, 'D-1', { branch: 'D-1-x' });
  for (const f of ['notes.txt', 'data/list.txt', 'README.txt', 'CHANGELOG', 'docs/a.txt', 'guide.adoc', 'api.rst', 'src/readme_parser.js', 'x.md']) write(dir, f, 'x\n');
  commitAll(dir, 'files');
  const out = notes(dir, 'task', 'inventory', 'D-1');
  assert.equal(line(out, 'docs among them:'), 'docs among them: 6 (CHANGELOG, README.txt, api.rst, docs/a.txt, guide.adoc, x.md)');
});

test('lane: a link counts with the key in it; a key both lanes name is a conflict; a done note names nothing', () => {
  const dir = project();
  putTask(dir, 'CAN-5', { link: 'https://tracker.example/browse/CAN-5' });
  putTask(dir, 'web-1', { link: 'https://docs.example.com/page/7' });
  write(dir, '.keel/next-session.md', '---\nstatus: active\nkeys: CAN-5, #12, ENG-3\n---\n');
  const conflict = notes(dir, 'lane', 'can-5');
  assert.match(conflict[0], /^lane: conflict/);
  assert.match(conflict[1], /^ {2}task: CAN-5 is an unfinished keel task/);
  assert.match(conflict[2], /^ {2}session: the note \.keel\/next-session\.md names CAN-5/);
  const viaLink = notes(dir, 'lane', 'https://acme.atlassian.net/browse/CAN-5');
  assert.match(viaLink[0], /^lane: conflict/);
  assert.ok(viaLink.includes('  key from the link: CAN-5'));
  assert.match(notes(dir, 'lane', 'https://github.com/o/r/issues/12')[0], /^lane: session \(the note .* names #12/);
  assert.match(notes(dir, 'lane', 'https://linear.app/acme/issue/ENG-3/fix-it')[0], /^lane: session/);
  assert.match(notes(dir, 'lane', 'https://docs.example.com/page/7/')[0], /^lane: task \(web-1/, 'a task whose link is the same page');
  assert.equal(notes(dir, 'lane', 'https://other.example/x')[0], 'lane: none');
  write(dir, '.keel/next-session.md', '---\nstatus: done\nkeys: CAN-5\n---\n');
  assert.match(notes(dir, 'lane', 'CAN-5')[0], /^lane: task/);
});

test('restore: a deleted task comes back by itself when the finish\'s git step did not complete', () => {
  const dir = project();
  putTask(dir, 'A-1');
  write(dir, '.keel/tasks/A-1/plan.md', '# plan\n');
  putTask(dir, 'B-2');
  finish(dir, 'B-2', '--session', 's1');
  notes(dir, 'task', 'activate', 'A-1', '--session', 's1');
  finish(dir, 'A-1', '--session', 's1');
  assert.match(notes(dir, 'lane', 'A-1')[0], /finished or dropped earlier/);
  const out = notes(dir, 'task', 'restore', 'a-1', '--session', 's2');
  assert.match(out[0], /^restored: \.keel[\/]tasks[\/]A-1 \(trash batch \d{8}-\d{6}/);
  assert.equal(out[1], 'active task: A-1');
  assert.equal(fs.readFileSync(path.join(dir, '.keel/tasks/A-1/plan.md'), 'utf8'), '# plan\n');
  assert.match(fs.readFileSync(path.join(dir, taskPath('A-1')), 'utf8'), /^status: active$/m);
  assert.equal(notes(dir, 'task', 'active', '--session', 's2')[0], 'active task: A-1');
  assert.match(notes(dir, 'lane', 'A-1')[0], /^lane: task/, 'no longer closed');
  assert.ok(!exists(dir, taskPath('B-2')), 'only the named task comes back');
  assert.match(notes(dir, 'task', 'restore', 'A-1', '--session', 's2')[0], /no trash batch holds A-1/);
  assert.match(notes(dir, 'task', 'restore', 'A-1')[0], /needs --session/);
  assert.match(notes(dir, 'task', 'restore', '../x', '--session', 's2')[0], /invalid id/);
});

test('a task\'s plan: field is read only where plan-steps.js reads plans: the project or Claude Code\'s plans folder', () => {
  const dir = project();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-plan-out-'));
  const plan = '### Step 1: SECRET-HEADING\n- files: a.js\n- model: sonnet\n- effort: low\n- do: x\n- done when: y\n- status: ⬜\n';
  write(elsewhere, 'plan.md', plan);
  write(dir, 'docs/plan.md', plan);
  const outsideRel = path.relative(dir, path.join(elsewhere, 'plan.md')).split(path.sep).join('/');
  for (const [id, p] of [['P-1', path.join(elsewhere, 'plan.md').split(path.sep).join('/')], ['P-2', outsideRel], ['P-3', 'docs/plan.md']]) putTask(dir, id, { plan: p });
  const byId = Object.fromEntries(tasks.treeTasks(dir).map((t) => [t.id, t]));
  assert.equal(tasks.planText(dir, byId['P-1']), null, 'an absolute path outside');
  assert.equal(tasks.planText(dir, byId['P-2']), null, 'a relative path that leaves the project');
  assert.match(tasks.planText(dir, byId['P-3']), /SECRET-HEADING/, 'a plan inside the project');
  assert.equal(tasks.stepCounts(dir, byId['P-1']), null);
});
