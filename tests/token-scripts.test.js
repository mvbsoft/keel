'use strict';
// Fewer model requests: git-flow.js `save`, changes.js --start with the comment check, notes.js check
// (head, today, size in characters) and notes.js task new with its front-matter options.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');
const { PLUGIN, SCRIPTS, gitTest, CONFIG, write, exists, git, line } = require('./fixtures/keel-project.js');
const { notes, project, repo, putTask, taskPath } = require('./fixtures/tasks.js');

const script = (name, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, name), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const flow = (dir, ...args) => script('git-flow.js', dir, ...args);
const marker = (dir, sid = 's1') => { try { return JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'finish', `${sid}.json`), 'utf8')); } catch { return null; } };
const message = (dir, text = 'Do the work') => { write(dir, '.keel/local/tmp/commit-message.txt', `${text}\n`); return path.join(dir, '.keel', 'local', 'tmp', 'commit-message.txt'); };

// A working clone with a keel config and one commit on main, pushed to a bare server.
function setup() {
  const tmp = tempDir('keel-save-');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG()));
  write(work, '.keel/.gitignore', 'local/\n');
  write(work, 'src/app.js', 'one\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  const server = path.join(tmp, 'server.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', server]);
  git(work, 'remote', 'add', 'origin', server);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return { tmp, work, server };
}

function otherPush(server, tmp, rel, text) {
  const other = path.join(tmp, `other-${Math.random().toString(16).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-b', 'main', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  write(other, rel, text);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', 'main moves on');
  git(other, 'push', '-q', 'origin', 'main');
}

const remoteHas = (server, branch) => spawnSync('git', ['-C', server, 'rev-parse', '-q', '--verify', `refs/heads/${branch}`]).status === 0;

// A finish: a task on its own branch, committed there, verified, its folder moved to the trash.
function finishing(work, id) {
  git(work, 'switch', '-q', '-c', `${id}-work`);
  assert.match(notes(work, 'task', 'new', id, '--title', 'Do it', '--source', 'text', '--session', 's1')[0], /^created: /);
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', `task ${id}`);
  script('fingerprint.js', work, 'save', '--tier', 'none');
  assert.match(notes(work, 'task', 'delete', id, '--session', 's1')[0], /^deleted: /);
}

// --- git-flow.js save ---

gitTest('save: a task handoff commits, pushes and goes back to the base in one call', () => {
  const { work, server } = setup();
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--back-to', 'main');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.match(out[1], /^commit: [0-9a-f]+ Do the work$/);
  assert.match(out[2], /^files: 1$/);
  assert.equal(out[3], 'push: t-work -> origin/t-work');
  assert.equal(out[4], 'branch: main');
  assert.match(out[5], /^updated from origin\/main: [0-9a-f]+$/);
  assert.equal(out.length, 6);
  assert.ok(remoteHas(server, 't-work'));
  assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 'main');
});

gitTest('save: a handoff whose push is refused is still ok, says so, and goes on to the base', () => {
  const { work, server } = setup();
  const hook = path.join(server, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/t-work" ]; then\n    echo "GH006: Protected branch update failed for $ref." >&2\n    exit 1\n  fi\ndone\nexit 0\n');
  fs.chmodSync(hook, 0o755);
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--back-to', 'main');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.ok(out.includes('push: refused (push of t-work was refused (protected)); the work is on this machine only'), out.join('\n'));
  assert.ok(out.includes('branch: main'), out.join('\n'));
  assert.ok(!remoteHas(server, 't-work'));
  assert.equal(git(work, 'log', '-1', '--format=%s', 't-work'), 'Do the work');
});

gitTest('save: a finish runs commit, sync and push in order and a completed push ends the finish', () => {
  const { work, server } = setup();
  finishing(work, 'T-1');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main', '--finish', 'T-1', '--session', 's1');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  const order = out.map((l) => l.split(':')[0]).filter((k) => ['commit', 'sync', 'push'].includes(k));
  assert.deepEqual(order, ['commit', 'sync', 'push']);
  assert.ok(out.includes('sync: up to date with origin/main'), out.join('\n'));
  assert.equal(marker(work), null, 'the push ended the finish');
  assert.ok(remoteHas(server, 'T-1-work'));
});

gitTest('save: a finish whose commit stops puts the task back and runs nothing after it', () => {
  const { work, server } = setup();
  assert.match(notes(work, 'task', 'new', 'T-2', '--title', 'On main', '--source', 'text', '--session', 's1')[0], /^created: /);
  script('fingerprint.js', work, 'save', '--tier', 'none');
  notes(work, 'task', 'delete', 'T-2', '--session', 's1');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main', '--finish', 'T-2', '--session', 's1');
  assert.equal(out[0], 'git-flow: stopped');
  assert.match(out[1], /^reason: on the main branch main/);
  assert.ok(out.includes('done: (nothing)'), out.join('\n'));
  assert.ok(out.includes('left: commit, sync, push'), out.join('\n'));
  assert.ok(out.some((l) => /^restored: \.keel\/tasks\/T-2/.test(l)), out.join('\n'));
  assert.ok(exists(work, '.keel/tasks/T-2/task.md'));
  assert.equal(marker(work), null);
  assert.ok(!out.some((l) => l.startsWith('push:') || l.startsWith('sync:')));
  assert.ok(!remoteHas(server, 'main-work'));
});

gitTest('save: a finish whose sync conflicts after the commit says the task is not put back', () => {
  const { work, tmp, server } = setup();
  finishing(work, 'T-3');
  write(work, 'src/app.js', 'local\n');
  otherPush(server, tmp, 'src/app.js', 'remote\n');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main', '--finish', 'T-3', '--session', 's1');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.match(out[1], /^reason: conflict while merging origin\/main into T-3-work/);
  assert.ok(out.includes('conflicts: src/app.js'), out.join('\n'));
  assert.ok(out.some((l) => /^commit: [0-9a-f]+ Do the work$/.test(l)), 'the commit lines stay in the output');
  assert.ok(out.includes('done: commit'), out.join('\n'));
  assert.ok(out.includes('left: sync, push'), out.join('\n'));
  assert.ok(out.some((l) => /^restore: not needed \(the removal of task T-3 is committed/.test(l)), out.join('\n'));
  assert.equal(marker(work).state, 'committed');
  assert.ok(!remoteHas(server, 'T-3-work'));
});

gitTest('save: a sync that merged new commits stops before the push: the gates run again first', () => {
  const { work, tmp, server } = setup();
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/mine.js', 'mine\n');
  otherPush(server, tmp, 'src/theirs.js', 'theirs\n');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.equal(out[1], 'reason: sync merged 1 new commits from origin/main; run the gates again before the push');
  assert.ok(out.some((l) => /^sync: merged 1 new commits from origin\/main into t-work/.test(l)));
  assert.ok(out.includes('done: commit, sync'), out.join('\n'));
  assert.ok(out.includes('left: push'), out.join('\n'));
  assert.ok(!remoteHas(server, 't-work'), 'nothing was pushed');
});

gitTest('save: with --sync a refused push stops it', () => {
  const { work, server } = setup();
  const hook = path.join(server, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "GH006: Protected branch update failed." >&2\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main', '--back-to', 'main');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.equal(out[1], 'reason: push of t-work was refused (protected)');
  assert.ok(out.includes('done: commit, sync'), out.join('\n'));
  assert.ok(out.includes('left: push, switch'), out.join('\n'));
  assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 't-work', 'no switch after a stop');
});

gitTest('save: a missing message file or a base without a name stops before anything runs; the unknown-command text lists save', () => {
  const { work } = setup();
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/app.js', 'one\ntwo\n');
  assert.equal(flow(work, 'save')[1], 'reason: --message-file is required');
  const out = flow(work, 'save', '--message-file', message(work), '--sync');
  assert.deepEqual(out.slice(0, 2), ['git-flow: stopped', 'reason: --sync needs a base branch: --sync <base>']);
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'init', 'nothing was committed');
  assert.match(flow(work, 'nope')[1], /\(status, start, switch, commit, sync, push, save, merge, trust, delete-branch\)$/);
});

gitTest('save: --finish without --sync is refused and nothing runs', () => {
  const { work, server } = setup();
  finishing(work, 'T-4');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--finish', 'T-4', '--session', 's1');
  assert.deepEqual(out.slice(0, 2), ['git-flow: stopped', 'reason: --finish needs --sync <base> in save (a finish always updates from its base before the push)']);
  assert.equal(git(work, 'log', '-1', '--format=%s'), 'task T-4', 'nothing was committed');
  assert.ok(!remoteHas(server, 'T-4-work'));
  assert.equal(marker(work).state, 'deleted', 'the finish is untouched');
});

gitTest('save: --tickets lets the named ticket file into the commit', () => {
  const { work } = setup();
  const ticket = (key, status) => `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: f\nbranch: f\nmerge_into: main\ndepends_on: []\n---\n# [${key}] Part\n`;
  write(work, 'tickets/f/K-1-part.md', ticket('K-1', 'todo'));
  write(work, 'tickets/f/K-2-part.md', ticket('K-2', 'todo'));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'tickets');
  git(work, 'switch', '-q', '-c', 'f');
  write(work, 'tickets/f/K-1-part.md', ticket('K-1', 'done'));
  write(work, 'tickets/f/K-2-part.md', ticket('K-2', 'done'));
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--tickets', 'k-1');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.deepEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['src/app.js', 'tickets/f/K-1-part.md']);
});

gitTest('save: with nothing to commit it still syncs and pushes', () => {
  const { work, server } = setup();
  git(work, 'switch', '-q', '-c', 't-work');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.ok(out.some((l) => l.startsWith('sync:')), out.join('\n'));
  assert.ok(out.includes('push: t-work -> origin/t-work'), out.join('\n'));
  assert.ok(remoteHas(server, 't-work'));
});

gitTest('save: a --back-to branch that does not exist stops at the switch after the push', () => {
  const { work, server } = setup();
  git(work, 'switch', '-q', '-c', 't-work');
  write(work, 'src/app.js', 'one\ntwo\n');
  const out = flow(work, 'save', '--message-file', message(work), '--back-to', 'no-such-branch');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.ok(out.includes('done: commit, push'), out.join('\n'));
  assert.ok(out.includes('left: switch'), out.join('\n'));
  assert.ok(remoteHas(server, 't-work'));
  assert.equal(git(work, 'symbolic-ref', '--short', 'HEAD'), 't-work');
});

gitTest('save: a finish whose sync merged commits stops before the push and the committed removal stays', () => {
  const { work, tmp, server } = setup();
  finishing(work, 'T-5');
  write(work, 'src/app.js', 'one\ntwo\n');
  otherPush(server, tmp, 'src/theirs.js', 'theirs\n');
  const out = flow(work, 'save', '--message-file', message(work), '--sync', 'main', '--finish', 'T-5', '--session', 's1');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.match(out[1], /^reason: sync merged 1 new commits from origin\/main; run the gates again/);
  assert.ok(out.includes('done: commit, sync'), out.join('\n'));
  assert.ok(out.includes('left: push'), out.join('\n'));
  assert.ok(!out.some((l) => l.startsWith('restore')), 'no restore lines after a merge stop');
  assert.ok(!exists(work, '.keel/tasks/T-5'), 'the task stays removed');
  assert.equal(marker(work).state, 'committed');
  assert.ok(!remoteHas(server, 'T-5-work'));
});

// --- own-files.js: save is a git step ---

function hookDecision(proj, command, env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_') && k !== 'KEEL_USAGE_DIR'));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    env: { ...clean, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: proj, ...env },
    encoding: 'utf8',
  });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
}

gitTest('own-files: save is allowed in trusted autonomous mode on a task branch, left to Claude Code on the main line, and not without trust', () => {
  const proj = tempDir('keel-save-hook-').split(path.sep).join('/');
  write(proj, '.keel/config.json', JSON.stringify(CONFIG()));
  git(proj, 'init', '-q', '-b', 'feat');
  const usage = tempDir('keel-usage-');
  const cmd = `node "${SCRIPTS.split(path.sep).join('/')}/git-flow.js" "${proj}" save --message-file "${proj}/.keel/local/tmp/commit-message.txt" --sync main`;
  const env = { KEEL_USAGE_DIR: usage };
  assert.equal(hookDecision(proj, cmd, env), null, 'not confirmed on this machine: no decision');
  require(path.join(SCRIPTS, 'lib', 'trust.js')).trust(proj, env);
  assert.equal(hookDecision(proj, cmd, env), 'allow');
  git(proj, 'checkout', '-q', '-b', 'main');
  assert.equal(hookDecision(proj, cmd, env), null, 'on the main line a save is left to the prompt');
});

// --- changes.js --start checks the comments first ---

function changesRepo() {
  const dir = repo(CONFIG({ comments: { level: 'short', ticket_prefixes: ['ABC'] } }));
  return dir;
}
const changes = (dir, ...args) => script('changes.js', dir, ...args);

gitTest('changes --start: comment notes are printed first and the run starts anyway', () => {
  const dir = changesRepo();
  write(dir, 'src/a.js', "'use strict';\n// Retries twice, see ABC-12.\nconst x = 1;\n");
  const out = changes(dir, '--start');
  assert.match(out[0], /^comments: level short; \d+ of \d+ new lines are comments \(\d+ %\); 1 note\(s\):$/, out.join('\n'));
  assert.match(out[1], /^- src\/a\.js:2: ABC-12 points at a ticket/);
  assert.ok(out.some((l) => l.startsWith('changes: 1 files')), out.join('\n'));
  assert.ok(out.some((l) => l.startsWith('proposal:')));
  assert.ok(!out.some((l) => l.startsWith('changes: not started')));
  for (const f of ['changes.json', 'changes.diff', 'verify-run.json']) assert.ok(exists(dir, `.keel/local/tmp/${f}`), f);
});

gitTest('changes --start: a kept long comment block does not stop the second run either', () => {
  const dir = changesRepo();
  write(dir, 'src/a.js', "'use strict';\nconst x = 1;\n// one\n// two\n// three\n// four\n// five\nconst y = 2;\n");
  for (const round of [1, 2]) {
    fs.rmSync(path.join(dir, '.keel/local/tmp/changes.json'), { force: true });
    const out = changes(dir, '--start');
    assert.match(out[0], /^comments: level short;.*note\(s\):$/, `run ${round}: ${out.join('\n')}`);
    assert.ok(exists(dir, '.keel/local/tmp/changes.json'), `run ${round}: the run starts`);
  }
});

gitTest('changes --start: a clean change prints the ok line first, then the usual summary and files', () => {
  const dir = changesRepo();
  write(dir, 'src/a.js', "'use strict';\nconst x = 1;\n");
  const out = changes(dir, '--start');
  assert.match(out[0], /^comments: level short; 0 of \d+ new lines are comments \(0 %\); ok$/, out.join('\n'));
  assert.match(out[1], /^changes: 1 files, \+\d+ -\d+ against /);
  assert.ok(out.some((l) => l.startsWith('proposal:')));
  for (const f of ['changes.json', 'changes.diff', 'verify-run.json']) assert.ok(exists(dir, `.keel/local/tmp/${f}`), f);
});

gitTest('changes without --start does not run the comment check', () => {
  const dir = changesRepo();
  write(dir, 'src/a.js', "'use strict';\n// Retries twice, see ABC-12.\nconst x = 1;\n");
  const out = changes(dir);
  assert.match(out[0], /^changes: 1 files/);
  assert.ok(!out.some((l) => l.startsWith('comments:')));
  assert.ok(exists(dir, '.keel/local/tmp/changes.json'));
});

gitTest('changes --start: a comment check that throws is reported and the run goes on', () => {
  const dir = changesRepo();
  write(dir, 'src/a.js', "'use strict';\nconst x = 1;\n");
  const comments = require(path.join(SCRIPTS, 'comments.js'));
  const real = comments.run;
  comments.run = () => { throw new Error('boom'); };
  let out;
  try { out = require(path.join(SCRIPTS, 'changes.js')).run(dir, { start: true }).split('\n'); } finally { comments.run = real; }
  assert.equal(out[0], 'comments: not measured (boom)');
  assert.match(out[1], /^changes: 1 files/);
  assert.ok(exists(dir, '.keel/local/tmp/changes.json'));
});

// --- notes.js check: head, today, size in characters ---

gitTest('check prints the short HEAD and today, so the note needs no extra git or date call', () => {
  const dir = repo();
  const out = notes(dir, 'check');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  assert.equal(line(out, 'head:'), `head: ${git(dir, 'rev-parse', '--short', 'HEAD')}`);
  git(dir, 'config', 'core.abbrev', '12');
  assert.equal(line(notes(dir, 'check'), 'head:'), `head: ${git(dir, 'rev-parse', '--short', 'HEAD')}`, "git's own short form, not a 7-character cut");
  assert.equal(line(notes(dir, 'check'), 'head:').length, 'head: '.length + 12);
  assert.equal(line(out, 'today:'), `today: ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  const bare = project();
  assert.equal(line(notes(bare, 'check'), 'head:'), '', 'no repository: no head line');
  assert.match(line(notes(bare, 'check'), 'today:'), /^today: \d{4}-\d\d-\d\d$/);
});

test('check: the note, the memory and every task.md are limited in characters too', () => {
  const dir = project();
  const fm = '---\nstatus: active\nbranch: -\nbase: main\nafter_commit: -\ndate: 2026-10-10\n---\n';
  write(dir, '.keel/next-session.md', `${fm}${`${'x'.repeat(79)}\n`.repeat(100)}`);
  write(dir, '.keel/memory/project-memory.md', `${'y'.repeat(79)}\n`.repeat(20));
  let out = notes(dir, 'check');
  assert.match(line(out, 'note:'), /; \d+ \/ 150 lines, \d+ \/ 12000 characters$/, 'under both limits');
  write(dir, '.keel/next-session.md', `${fm}${`${'x'.repeat(799)}\n`.repeat(20)}`);
  out = notes(dir, 'check');
  assert.match(line(out, 'note:'), /; 27 \/ 150 lines, 16\d{3} \/ 12000 characters - over the limit$/, line(out, 'note:'));
  write(dir, '.keel/memory/project-memory.md', `${'y'.repeat(799)}\n`.repeat(16));
  assert.match(line(notes(dir, 'check'), 'memory:'), /; 16 \/ 150 lines, 12\d{3} \/ 12000 characters - over the limit$/);
  putTask(dir, 'T-01');
  putTask(dir, 'T-02', {}, `${'z'.repeat(799)}\n`.repeat(16));
  putTask(dir, 'T-03', {}, '- x\n'.repeat(160));
  putTask(dir, 'T-04', {}, `${'z'.repeat(99)}\n`.repeat(160));
  const task = line(notes(dir, 'check'), 'task files:');
  assert.match(task, /^task files: 4 in this working tree; over the limit of 150 lines or 12000 characters: /);
  assert.match(task, /T-02 \(1\d{4} characters\)/);
  assert.match(task, /T-03 \(\d{3} lines\)/);
  assert.match(task, /T-04 \(\d{3} lines, 1\d{4} characters\)/);
  assert.doesNotMatch(task, /T-01/);
});

// --- notes.js task new: front matter from options ---

const front = (dir, id) => Object.fromEntries(/^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(path.join(dir, taskPath(id)), 'utf8'))[1].split('\n').map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
const newTask = (dir, id, ...args) => notes(dir, 'task', 'new', id, '--title', 'T', '--source', 'text', ...args);

test('task new: --branch, --base, --merge-into and --execution fill the front matter', () => {
  const dir = project();
  const out = newTask(dir, 'A-1', '--branch', 'feat/a-1', '--base', 'develop', '--merge-into', 'release/1', '--execution', 'delegate');
  assert.match(out[0], /^created: /);
  const f = front(dir, 'A-1');
  assert.deepEqual([f.branch, f.base, f.merge_into, f.execution, f.plan], ['feat/a-1', 'develop', 'release/1', 'delegate', 'inline']);
  const plain = front((newTask(dir, 'A-2'), dir), 'A-2');
  assert.deepEqual([plain.branch, plain.base, plain.merge_into, plain.execution, plain.plan], ['-', 'main', 'main', 'here', 'inline'], 'without options: as before');
  for (const w of ['here', 'delegate', 'fresh']) assert.match(newTask(dir, `E-${w}`, '--execution', w)[0], /^created: /, w);
});

test('task new: a bad branch name or execution is refused and nothing is made', () => {
  const dir = project();
  for (const [opt, value, why] of [['--branch', 'a b', /--branch "a b" is not a valid branch name/], ['--base', 'x..y', /--base "x\.\.y" is not a valid branch name/],
    ['--merge-into', '-rf', /--merge-into "-rf" is not a valid branch name/], ['--branch', 'one\ntwo', /not a valid branch name/], ['--branch', '@{-1}', /not a valid branch name/],
    ['--execution', 'parallel', /--execution must be one of here, delegate, fresh/]]) {
    const out = newTask(dir, 'B-1', opt, value);
    assert.match(out[0], /^notes: task new refused \(/, `${opt} ${value}`);
    assert.match(out[0], why, `${opt} ${value}`);
    assert.ok(!exists(dir, '.keel/tasks/B-1'), `${opt} ${value}`);
  }
  assert.match(newTask(dir, 'B-1', '--branch')[0], /--branch needs a value/);
  assert.match(newTask(dir, 'B-1', '--execution')[0], /--execution must be one of/);
});

test('task new: --plan-file copies the plan into the task folder as plan.md', () => {
  const dir = project();
  write(dir, '.keel/local/tmp/plan.src.md', '# Plan\n\n- [ ] step one\n- [ ] step two\n');
  const out = newTask(dir, 'P-1', '--plan-file', '.keel/local/tmp/plan.src.md');
  assert.match(out[0], /^created: /);
  assert.equal(fs.readFileSync(path.join(dir, '.keel/tasks/P-1/plan.md'), 'utf8'), '# Plan\n\n- [ ] step one\n- [ ] step two\n');
  assert.equal(front(dir, 'P-1').plan, 'plan.md');
  assert.ok(out.includes('plan: plan.md (copied from .keel/local/tmp/plan.src.md)'), out.join('\n'));
});

test('task new: --plan-file refuses a missing file, a folder, a big file and a link, and leaves nothing behind', () => {
  const dir = project();
  write(dir, '.keel/local/tmp/big.md', 'x'.repeat(200 * 1024 + 1));
  write(dir, '.keel/local/tmp/ok.md', 'plan\n');
  write(dir, '.keel/local/tmp/limit.md', 'x'.repeat(200 * 1024));
  const refused = (rel, why) => {
    const out = newTask(dir, 'Q-1', '--plan-file', rel);
    assert.match(out[0], /^notes: task new refused \(/, rel);
    assert.match(out[0], why, rel);
    assert.ok(!exists(dir, '.keel/tasks/Q-1'), `${rel}: no folder`);
  };
  refused('.keel/local/tmp/missing.md', /--plan-file .* does not exist/);
  refused('.keel/local/tmp', /--plan-file .* is not a file/);
  refused('.keel/local/tmp/big.md', /--plan-file .* is over 200 KB/);
  assert.match(notes(dir, 'task', 'new', 'Q-2', '--title', 'T', '--source', 'text', '--plan-file')[0], /--plan-file needs a path/);
  let linked = false;
  try { fs.symlinkSync(path.join(dir, '.keel/local/tmp/ok.md'), path.join(dir, '.keel/local/tmp/link.md')); linked = true; } catch { /* no permission to link here */ }
  if (linked) {
    refused('.keel/local/tmp/link.md', /is a link/);
    fs.symlinkSync(path.join(dir, '.keel/local/tmp'), path.join(dir, 'tmp-link'), 'junction');
    refused('tmp-link/ok.md', /link/);
  }
  assert.match(newTask(dir, 'Q-3', '--plan-file', '.keel/local/tmp/limit.md')[0], /^created: /, 'exactly 200 KB is fine');
});

test('task new: --plan-file refuses a secret name, a file outside the project, text that is not UTF-8 and a NUL byte', () => {
  const dir = project();
  const outside = tempDir('keel-plan-outside-');
  write(dir, '.env', 'TOKEN=abc\n');
  write(dir, 'docs/plan.md', '- [ ] one\n');
  write(outside, 'plan.md', '- [ ] elsewhere\n');
  fs.writeFileSync(path.join(dir, 'latin.md'), Buffer.from([0x70, 0x6c, 0xe1, 0x6e, 0xff, 0x0a]));
  fs.writeFileSync(path.join(dir, 'nul.md'), Buffer.from('a\0b\n'));
  const refused = (file, why) => {
    const out = newTask(dir, 'R-1', '--plan-file', file);
    assert.match(out[0], /^notes: task new refused \(--plan-file /, file);
    assert.match(out[0], why, file);
    assert.ok(!exists(dir, '.keel/tasks/R-1'), `${file}: no folder`);
  };
  refused('.env', /secret/);
  refused(path.join(outside, 'plan.md'), /inside the project or in Claude Code's plans folder/);
  refused('latin.md', /is not UTF-8 text/);
  refused('nul.md', /is not a text file/);
  refused('docs/../.env', /secret/);
  assert.match(newTask(dir, 'R-1', '--plan-file', 'docs/plan.md')[0], /^created: /, 'a plan inside the project still copies');
  assert.equal(fs.readFileSync(path.join(dir, '.keel/tasks/R-1/plan.md'), 'utf8'), '- [ ] one\n');
});

test("task new: --plan-file takes a plan from Claude Code's plans folder but not a secret there", () => {
  const dir = project();
  const claude = tempDir('keel-claude-config-');
  write(claude, 'plans/p.md', '- [ ] from plan mode\n');
  write(claude, 'plans/.env', 'TOKEN=abc\n');
  const { taskNew } = require(path.join(SCRIPTS, 'lib', 'tasks.js'));
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claude;
  try {
    assert.match(taskNew(dir, 'U-1', { title: 'T', source: 'text', planFile: path.join(claude, 'plans', 'p.md') })[0], /^created: /);
    assert.equal(fs.readFileSync(path.join(dir, '.keel/tasks/U-1/plan.md'), 'utf8'), '- [ ] from plan mode\n');
    assert.match(taskNew(dir, 'U-2', { title: 'T', source: 'text', planFile: path.join(claude, 'plans', '.env') })[0], /is a secret file/);
    assert.ok(!exists(dir, '.keel/tasks/U-2'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('task new: one branch rule: @ and @{-1} are refused, fix+1 and - are fine', () => {
  const dir = project();
  for (const bad of ['@', '@{-1}']) {
    const out = newTask(dir, 'S-1', '--branch', bad);
    assert.match(out[0], /--branch ".*" is not a valid branch name/, bad);
    assert.ok(!exists(dir, '.keel/tasks/S-1'), bad);
  }
  assert.match(newTask(dir, 'S-2', '--branch', 'fix+1', '--base', '-')[0], /^created: /);
  assert.equal(front(dir, 'S-2').branch, 'fix+1');
});

test('task new: a failed write removes only the folder it made', () => {
  const dir = project();
  const { taskNew } = require(path.join(SCRIPTS, 'lib', 'tasks.js'));
  assert.match(taskNew(dir, 'W-1', { title: 'T', source: 'text' })[0], /^created: /);
  const real = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).endsWith('task.md')) throw new Error('disk full');
    return real(file, ...rest);
  };
  let out;
  try { out = taskNew(dir, 'W-2', { title: 'T', source: 'text' }); } finally { fs.writeFileSync = real; }
  assert.match(out[0], /^notes: task new refused \(could not write the task folder: disk full\)$/);
  assert.ok(!exists(dir, '.keel/tasks/W-2'), 'its own folder is gone');
  assert.ok(exists(dir, '.keel/tasks/W-1/task.md'), 'the other task is untouched');
});
