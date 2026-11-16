'use strict';
// plans.js tickets, status and drop, and the task of a planned ticket: the states come from the status
// fields; git adds one warning (a ticket's branch merged into merge_into while the ticket is not done).
// Throwaway projects, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gitTest, PLUGIN, SCRIPTS, LOCAL, git, write, readRel, exists, run, front, planning, setup, ready, trashed } = require('./fixtures/plans-git.js');

const T = (n, folder = `${LOCAL}/s3-storage`) => `${folder}/tickets/T${n}-ticket-${n}.md`;
const script = (name, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, name), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
// keel's own-files hook on a shell command in the project `dir`: its decision, or null.
function hookDecision(dir, command) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), env: { ...env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
}

gitTest('tickets: states from the fields; next is the first ready, reviewed ticket whose dependencies are done', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage', 3);
  assert.deepEqual(run(work, 'tickets'), [
    'tickets: 1 feature, 3 tickets',
    's3-storage (ready; 0 of 3 done)',
    '  T1 Title of T1 — next',
    '  T2 Title of T2 — ready',
    '  T3 Title of T3 — ready',
    'next: s3-storage/T1',
  ]);
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  front(work, T(1), 'status', 'in-progress\nbranch: s3-storage-T1');
  assert.equal(run(work, 'tickets')[2], '  T1 Title of T1 — in-progress · on s3-storage-T1');
  assert.equal(run(work, 'tickets').at(-1), 'next: none', 'T2 waits for T1');
  run(work, 'status', 's3-storage', 'T1', 'done');
  assert.equal(run(work, 'tickets').at(-1), 'next: s3-storage/T2');
  // A ticket that needs review is never next; its line says so.
  write(work, T(2), readRel(work, T(2)).replace('Do one thing after T1', 'Do two things after T1'));
  const out = run(work, 'tickets');
  assert.equal(out[3], '  T2 Title of T2 — ready · needs review');
  assert.equal(out.at(-1), 'next: none');
});

gitTest('tickets: a draft is never next; a ticket that depends on an abandoned one waits for the user; one ticket shows its file and dependencies', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage', 3);
  run(work, 'ticket', 's3-storage', '--title', 'Later');
  run(work, 'status', 's3-storage', 'T1', 'abandoned', '--reason', 'not needed');
  const out = run(work, 'tickets', 's3-storage');
  assert.deepEqual(out, [
    'tickets: 1 feature, 4 tickets',
    's3-storage (ready; 0 of 4 done)',
    '  branch: s3-storage -> main',
    '  T1 Title of T1 — abandoned',
    '  T2 Title of T2 — ready',
    '  T3 Title of T3 — ready',
    '  T4 Later — draft · needs review',
    'note: T2 depends on T1, which is abandoned: remove the dependency or abandon T2 too',
    'next: none',
  ]);
  assert.deepEqual(run(work, 'tickets', 's3-storage/t2'), [
    'tickets: 1 feature, 1 ticket',
    's3-storage (ready; 0 of 4 done)',
    '  branch: s3-storage -> main',
    '  T2 Title of T2 — ready',
    `  file: ${T(2)}`,
    '  depends: T1 abandoned',
    'note: T2 depends on T1, which is abandoned: remove the dependency or abandon T2 too',
    'next: none',
  ]);
  assert.deepEqual(run(work, 'tickets', 's3-storage/T9'), ['tickets: none (no ticket s3-storage/T9)']);
  assert.deepEqual(run(work, 'tickets', 'no-such-thing'), ['tickets: none (no feature no-such-thing)']);
  // Without an argument: only ready or in-progress features with an open ticket.
  run(work, 'new', 'csv-export');
  assert.deepEqual(run(work, 'tickets').slice(0, 2), ['tickets: 1 feature, 4 tickets', 's3-storage (ready; 0 of 4 done)']);
  for (const n of [2, 3, 4]) run(work, 'status', 's3-storage', `T${n}`, 'abandoned', '--reason', 'x');
  assert.deepEqual(run(work, 'tickets'), ['tickets: none']);
  assert.equal(run(work, 'tickets', 's3-storage').at(-2), 'plan: every ticket is done or abandoned: plans.js state s3-storage done');
});

gitTest('the one git warning: a ticket whose branch is merged into merge_into while it is not done; a new branch or a done ticket is no warning', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  const t1 = T(1, 'tickets/s3-storage');
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  front(work, t1, 'status', 'in-progress\nbranch: s3-storage-T1');
  git(work, 'branch', 's3-storage-T1');
  assert.ok(!run(work, 'check', 's3-storage').some((l) => l.startsWith('warn:')), 'a branch with no commit of its own is not merged');
  git(work, 'checkout', '-q', 's3-storage-T1');
  write(work, 'src/app.js', 'module.exports = 5;\n');
  git(work, 'commit', '-qam', 'upload');
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'merge T1', 's3-storage-T1');
  const warn = 'warn: T1: its branch s3-storage-T1 is merged into main, but the ticket is in-progress: plans.js status s3-storage T1 done once its work is finished';
  assert.ok(run(work, 'check', 's3-storage').includes(warn), run(work, 'check', 's3-storage').join('\n'));
  assert.ok(run(work, 'tickets', 's3-storage').includes(warn));
  run(work, 'status', 's3-storage', 'T1', 'done');
  assert.ok(!run(work, 'tickets', 's3-storage').some((l) => l.startsWith('warn:')));
  // --fetch first: without a remote it says so and reads the files all the same.
  assert.equal(run(work, 'tickets', '--fetch', 's3-storage').at(-1), 'fetch: no remote, skipped');
});

gitTest('status in-progress: --branch names the task\'s branch, a draft is refused; one ticket shows its status on the remote\'s plan branch', () => {
  const { work } = setup();
  planning(work, { place: 'repo' });
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  run(work, 'ticket', 's3-storage', '--title', 'Later');
  const t1 = T(1, 'tickets/s3-storage');
  assert.deepEqual(run(work, 'status', 's3-storage', 'T3', 'in-progress'), ['plans: status refused (T3 is a draft: plans.js status s3-storage T3 ready after its review)']);
  assert.deepEqual(run(work, 'status', 's3-storage', 'T1', 'done', '--branch', 'x'), ['plans: status refused (--branch goes with in-progress and takes a valid branch name)']);
  git(work, 'checkout', '-q', '-b', 's3-storage');
  assert.deepEqual(run(work, 'status', 's3-storage', 'T1', 'in-progress', '--branch', 'other-T1'), ['status: T1 in-progress on other-T1', 'plan: in-progress']);
  assert.match(readRel(work, t1), /^branch: other-T1$/m);
  assert.deepEqual(run(work, 'status', 's3-storage', 'T1', 'in-progress', '--branch', 'other-T1'), ['status: T1 in-progress (already)']);
  run(work, 'commit', 's3-storage');
  run(work, 'push', 's3-storage');
  // Here the ticket looks free again; the remote's plan branch shows who took it.
  front(work, t1, 'status', 'ready');
  const out = run(work, 'tickets', 's3-storage/T1', '--fetch');
  assert.equal(out[3], '  T1 Title of T1 — next', out.join('\n'));
  assert.deepEqual(out.slice(4, 6), [`  file: ${t1}`, '  remote: in-progress on other-T1 (origin/s3-storage)']);
  assert.deepEqual(run(work, 'status', 's3-storage', 'T1', 'in-progress', '--branch', 's3-storage-T1'), ['status: T1 in-progress on s3-storage-T1']);
  run(work, 'ticket', 's3-storage', '--title', 'Newer');
  assert.ok(!run(work, 'tickets', 's3-storage/T4').some((l) => l.startsWith('  remote:')), 'a ticket the remote does not have yet: no line');
});

gitTest('drop: refused while a ticket is open and on the branch the feature merges into; then the folder goes to keel\'s trash', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  run(work, 'mark', 'set', 's3-storage', '--session', 'chat-1');
  assert.deepEqual(run(work, 'drop', 's3-storage'), ['plans: drop refused (not every ticket of s3-storage is done or abandoned: T1 ready, T2 ready)']);
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  run(work, 'status', 's3-storage', 'T1', 'done');
  run(work, 'status', 's3-storage', 'T2', 'abandoned', '--reason', 'later');
  git(work, 'checkout', '-q', 'main');
  assert.deepEqual(run(work, 'drop', 's3-storage'), ['plans: drop refused (on main, where the feature merges; the folder is removed on the feature branch before its merge)']);
  git(work, 'checkout', '-q', 's3-storage');
  assert.match(run(work, 'drop', 's3-storage')[0], /^drop: tickets\/s3-storage\/? -> trash \d{8}-\d{6}/);
  assert.ok(!exists(work, 'tickets/s3-storage'));
  assert.equal(trashed(work).length, 1);
  assert.deepEqual(run(work, 'mark', 'get', '--session', 'chat-1'), ['planning: none']);
  assert.match(run(work, 'drop', 's3-storage')[0], /refused \(no feature "s3-storage"/);
});

test('drop: a feature on this machine goes to keel\'s trash once its tickets are closed, on any branch', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage', 1);
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  run(work, 'status', 's3-storage', 'T1', 'done');
  assert.match(run(work, 'drop', 's3-storage')[0], /^drop: \.keel\/local\/plans\/keel\/s3-storage\/? -> trash /);
  assert.ok(!exists(work, `${LOCAL}/s3-storage`));
});

gitTest('task new --ticket: the task <feature>-T<n> with ticket:, on this machine for a feature kept here or a ticket of another repository, which is verified there', () => {
  const { tmp, work } = setup({ remote: false });
  const notes = (...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'notes.js'), work, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
  const task = (id, ...args) => notes('task', 'new', id, '--title', 'Upload', '--source', 'file', ...args);
  ready(work, 's3-storage', 2);
  assert.deepEqual(task('upload', '--ticket', 's3-storage/T1'), ['notes: task new refused (the task of s3-storage/T1 is s3-storage-T1)']);
  assert.deepEqual(task('s3-storage-T9', '--ticket', 's3-storage/T9'), ['notes: task new refused (no ticket T9 in s3-storage)']);
  assert.deepEqual(task('x-T1', '--ticket', 'PROJ-1'), ['notes: task new refused (--ticket takes <feature>/T<n>, not "PROJ-1")']);
  // A feature on this machine: its task too, whatever tasks.in_git says.
  assert.equal(task('s3-storage-T1', '--ticket', 's3-storage/T1')[0], 'created: .keel/local/tasks/s3-storage-T1/task.md');
  assert.match(readRel(work, '.keel/local/tasks/s3-storage-T1/task.md'), /^ticket: s3-storage\/T1$/m);
  assert.equal(notes('lane', 's3-storage/T1')[0], 'lane: task (s3-storage-T1 is an unfinished keel task, on this machine only: /keel:start-task leads it)');
  // A feature in the repository: the task where tasks.in_git puts it.
  planning(work, { place: 'repo' });
  ready(work, 'csv-export', 1, 'tickets/csv-export');
  assert.equal(task('csv-export-T1', '--ticket', 'csv-export/T1')[0], 'created: .keel/tasks/csv-export-T1/task.md');
  // A ticket of another repository: repo: and that repository's start commit, on this machine.
  const web = path.join(tmp, 'web');
  fs.mkdirSync(web);
  git(web, 'init', '-q', '-b', 'main');
  git(web, 'config', 'user.name', 'Test');
  git(web, 'config', 'user.email', 'test@example.com');
  write(web, 'index.js', 'x\n');
  git(web, 'add', '-A');
  git(web, 'commit', '-q', '-m', 'init');
  run(work, 'settings', 'set', '--repo', `web=${web.split(path.sep).join('/')}`);
  run(work, 'ticket', 'csv-export', '--title', 'Badge', '--repo', 'web');
  assert.equal(task('csv-export-T2', '--ticket', 'csv-export/T2')[0], 'created: .keel/local/tasks/csv-export-T2/task.md');
  const text = readRel(work, '.keel/local/tasks/csv-export-T2/task.md');
  assert.match(text, /^repo: web$/m);
  assert.match(text, new RegExp(`^started: ${git(web, 'rev-parse', 'HEAD')}$`, 'm'));
  // Its verification looks at that repository, which has no keel: its diff, its record, and task delete
  // here (and keel's hook) reads that record.
  write(web, 'index.js', 'x\ny\n');
  assert.match(script('changes.js', web)[0], /^changes: 1 files, \+1 -0/);
  assert.ok(fs.readFileSync(path.join(web, '.keel', 'local', 'tmp', 'changes.diff'), 'utf8').includes('+y'));
  const del = `node "${SCRIPTS}/notes.js" "${work.split(path.sep).join('/')}" task delete csv-export-T2`;
  assert.equal(hookDecision(work, del), 'deny');
  assert.match(notes('task', 'delete', 'csv-export-T2')[0], /^notes: task delete refused \(no verification is recorded for this change/);
  assert.match(script('fingerprint.js', web, 'save', '--tier', 'basic')[0], /^saved: verification at /);
  assert.ok(!exists(work, '.keel/local/last-verify.json'), 'nothing is recorded here');
  assert.equal(hookDecision(work, del), 'ask');
  assert.equal(notes('task', 'delete', 'csv-export-T2')[0], 'deleted: .keel/local/tasks/csv-export-T2/ (moved to keel\'s trash)');
});

gitTest('tickets: a feature name in another case is the same feature, as in a task ticket', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage', 1);
  assert.deepEqual(run(work, 'tickets', 'S3-Storage'), run(work, 'tickets', 's3-storage'));
  assert.deepEqual(run(work, 'tickets', 'S3-Storage/t1'), run(work, 'tickets', 's3-storage/T1'));
});
