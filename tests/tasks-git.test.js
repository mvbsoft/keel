'use strict';
// Task files and git: tasks listed from other branches, inventory, the start and handoff commits, and
// how many git processes a listing takes, on throwaway repositories.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SCRIPTS, gitTest, CONFIG, write, exists, git, run, notes, finish, line, block, has, taskPath, project, repo, commitAll, putTask } = require('./fixtures/tasks.js');

const tasks = require(path.join(SCRIPTS, 'lib', 'tasks.js'));

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

// --- edge cases from review ---

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

gitTest('started: task new records HEAD; check, activate and a handoff edit keep it', () => {
  const dir = repo();
  const head = git(dir, 'rev-parse', 'HEAD');
  assert.equal(notes(dir, 'task', 'new', 'S-1', '--title', 'Start', '--source', 'text', '--session', 's1')[0], 'created: .keel/tasks/S-1/task.md');
  const file = path.join(dir, taskPath('S-1'));
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^started: ${head}$`, 'm'));
  write(dir, 'src/app.js', 'two\n');
  commitAll(dir, 'work');
  const out = notes(dir, 'check', '--session', 's1');
  assert.equal(line(out, 'task files:'), 'task files: 1 in this working tree; over the limit of 150 lines: none', out.join('\n'));
  assert.equal(line(out, 'active task:'), 'active task: S-1');
  // A handoff edits its own fields; resuming activates the task again.
  fs.writeFileSync(file, tasks.setFront(fs.readFileSync(file, 'utf8'), { status: 'handed-off', after_commit: git(dir, 'rev-parse', '--short', 'HEAD') }));
  assert.equal(notes(dir, 'task', 'activate', 'S-1', '--session', 's2')[0], 'active task: S-1');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, new RegExp(`^started: ${head}$`, 'm'), 'the start commit stays');
  assert.match(text, /^status: active$/m);
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
