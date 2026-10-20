'use strict';
// git-flow.js and notes.js on throwaway local repositories: a bare repository plays the server, a
// pre-receive hook in it plays a protected branch. No network, no GitHub.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const { pushRefusal } = require(path.join(SCRIPTS, 'git-flow.js'));
const { stripAttribution, hasAttribution } = require(path.join(SCRIPTS, 'lib', 'attribution.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (mode = 'autonomous') => ({
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
});

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const flow = (dir, ...args) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'git-flow.js'), dir, ...args], { encoding: 'utf8' });
  return r.stdout.trim().split('\n');
};
const notes = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'notes.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';

// A server (bare) and a working clone with a keel config and one commit on main, pushed.
function setup({ mode = 'autonomous', remote = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-git-'));
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG(mode)));
  write(work, '.keel/.gitignore', 'local/\n');
  write(work, 'src/app.js', 'one\ntwo\nthree\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  let server = null;
  if (remote) {
    server = path.join(tmp, 'server.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', server]);
    git(work, 'remote', 'add', 'origin', server);
    git(work, 'push', '-q', '-u', 'origin', 'main');
  }
  return { tmp, work, server };
}

// A second clone that pushes to main behind our back.
function otherPush(server, tmp, rel, text, message) {
  const other = path.join(tmp, `other-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'config', 'core.autocrlf', 'false');
  write(other, rel, text);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', message);
  git(other, 'push', '-q', 'origin', 'main');
}

function protectMain(server) {
  const hook = path.join(server, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/main" ]; then\n    echo "GH006: Protected branch update failed for refs/heads/main." >&2\n    exit 1\n  fi\ndone\nexit 0\n');
  fs.chmodSync(hook, 0o755);
}

function commitWork(work, message = 'feat: change\n') {
  write(work, '.keel/local/tmp/commit-message.txt', message);
  return flow(work, 'commit', '--message-file', path.join(work, '.keel/local/tmp/commit-message.txt'));
}

test('AI trailers and "generated with" lines are dropped; people stay', () => {
  const msg = 'feat: add export\n\nWhy it matters.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nCo-authored-by: Kai Smith <kai@example.com>\nCo-authored-by: GitHub Copilot <copilot@github.com>\n';
  assert.equal(stripAttribution(msg), 'feat: add export\n\nWhy it matters.\n\nCo-authored-by: Kai Smith <kai@example.com>');
});

test('the commit step and the attribution hook judge the same lines: tools are caught, people and prose stay', () => {
  for (const l of ['Co-authored-by: Aider <a@b.c>', 'Co-authored-by: Grok <a@b.c>', 'Co-authored-by: Windsurf <a@b.c>',
    'Co-authored-by: devin-ai-integration[bot] <a@b.c>', 'Generated with Aider', '🤖 Generated with [Claude Code](https://claude.com/claude-code)']) {
    assert.ok(hasAttribution(l), l);
    assert.equal(stripAttribution(`fix: x\n\n${l}`), 'fix: x', l);
  }
  for (const l of ['Co-authored-by: Devin Smith <d@example.com>', 'Co-authored-by: Cody Brown <c@example.com>',
    'rows created by the previous cursor are kept', 'this report is written by an AI model']) {
    assert.ok(!hasAttribution(l), l);
    assert.equal(stripAttribution(`fix: x\n\n${l}`), `fix: x\n\n${l}`, l);
  }
});

test('refused pushes are classified', () => {
  assert.equal(pushRefusal('remote: error: GH006: Protected branch update failed for refs/heads/main.'), 'protected');
  assert.equal(pushRefusal('remote: GitLab: You are not allowed to push code to protected branches on this project.'), 'protected');
  assert.equal(pushRefusal('! [remote rejected] main -> main (pre-receive hook declined)'), 'protected');
  assert.equal(pushRefusal('! [rejected] x -> x (fetch first)'), 'behind');
  assert.equal(pushRefusal('fatal: Authentication failed'), 'failed');
});

gitTest('status works in both modes; without a config it is unavailable', () => {
  const { work } = setup({ mode: 'manual' });
  const out = flow(work, 'status');
  assert.equal(out[0], 'git-flow: ok');
  assert.match(line(out, 'branch:'), /main/);
  assert.match(line(out, 'mode:'), /manual/);
  fs.rmSync(path.join(work, '.keel', 'config.json'));
  assert.equal(flow(work, 'status')[0], 'git-flow: unavailable');
});

gitTest('start: clean tree → from the updated main; changed tree → carries the changes; bad and taken names stop', () => {
  const { tmp, work, server } = setup();
  otherPush(server, tmp, 'src/new.js', 'x\n', 'other work');
  let out = flow(work, 'start', '--name', 'CAN-1-button');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.match(line(out, 'branch:'), /from origin\/main/);
  assert.ok(fs.existsSync(path.join(work, 'src', 'new.js')), 'the branch starts from the fresh main');
  assert.equal(flow(work, 'start', '--name', 'CAN-1-button')[0], 'git-flow: stopped');
  assert.equal(flow(work, 'start', '--name', 'bad..name')[0], 'git-flow: stopped');

  git(work, 'checkout', '-q', 'main');
  write(work, 'src/app.js', 'one\nTWO\nthree\n');
  out = flow(work, 'start', '--name', 'CAN-2-carry');
  assert.equal(out[0], 'git-flow: ok');
  assert.match(line(out, 'carried:'), /1 changed/);
  assert.equal(git(work, 'branch', '--show-current'), 'CAN-2-carry');
  assert.match(fs.readFileSync(path.join(work, 'src/app.js'), 'utf8'), /TWO/);
});

gitTest('commit: never on main, secret files stay out, AI lines are dropped, ignored files are not added', () => {
  const { work } = setup();
  write(work, 'src/app.js', 'one\nTWO\nthree\n');
  let out = commitWork(work);
  assert.equal(out[0], 'git-flow: stopped');
  assert.match(line(out, 'reason:'), /main branch/);

  flow(work, 'start', '--name', 'CAN-3-secret');
  write(work, '.env', 'API_KEY=not-a-real-key\n');
  write(work, 'src/added.js', 'new\n');
  git(work, 'add', '.env'); // staged by hand earlier: must come out again
  out = commitWork(work, 'feat: CAN-3 change\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.match(line(out, 'not committed'), /\.env/);
  const files = git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.deepEqual(files.sort(), ['src/added.js', 'src/app.js']);
  assert.equal(git(work, 'log', '-1', '--format=%B').trim(), 'feat: CAN-3 change');
  assert.equal(commitWork(work)[1], 'commit: nothing to commit');
  write(work, 'src/added.js', 'newer\n');
  assert.equal(commitWork(work, '#42 Fix login\n\n#43 details\n')[0], 'git-flow: ok');
  assert.equal(git(work, 'log', '-1', '--format=%B').trim(), '#42 Fix login\n\n#43 details', 'lines starting with # are kept');
});

gitTest('commit: changes already staged by hand (git mv, git rm) are committed as they are', () => {
  const { work } = setup();
  const doc = Array.from({ length: 10 }, (_, i) => `line ${i}\n`).join('');
  write(work, 'docs/old.md', doc);
  write(work, 'src/gone.js', 'gone\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'more files');
  git(work, 'push', '-q', 'origin', 'main');
  flow(work, 'start', '--name', 'CAN-9-move');
  git(work, 'mv', 'src/app.js', 'src/main.js'); // R: the source is gone from the tree and the index
  git(work, 'mv', 'docs/old.md', 'docs/new.md');
  write(work, 'docs/new.md', doc.replace('line 3', 'line three')); // RM: edited after the move
  git(work, 'rm', '-q', 'src/gone.js'); // D: staged deletion
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  const status = git(work, 'show', '-M', '--name-status', '--format=', 'HEAD');
  assert.match(status, /^R100\tsrc\/app\.js\tsrc\/main\.js$/m, status);
  assert.match(status, /^R\d+\tdocs\/old\.md\tdocs\/new\.md$/m, status);
  assert.match(status, /^D\tsrc\/gone\.js$/m, status);
  assert.match(git(work, 'show', 'HEAD:docs/new.md'), /line three/, 'the edit after the move is in');
  assert.equal(git(work, 'status', '--porcelain'), '');
});

gitTest('commit: a tracked secret moved with git mv stays out on both sides of the move', () => {
  const { work } = setup();
  write(work, '.env', 'TOKEN=old\n');
  git(work, 'add', '.env');
  git(work, 'commit', '-q', '-m', 'tracked env');
  git(work, 'push', '-q', 'origin', 'main');
  flow(work, 'start', '--name', 'CAN-10-env-move');
  fs.mkdirSync(path.join(work, 'config'));
  git(work, 'mv', '.env', 'config/.env');
  write(work, 'src/app.js', 'one\nmoved\nthree\n');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.match(line(out, 'not committed'), /\.env/);
  assert.deepEqual(git(work, 'show', '--name-only', '--no-renames', '--format=', 'HEAD').split('\n'), ['src/app.js'], 'neither the removal of .env nor config/.env');
  assert.equal(git(work, 'show', 'HEAD:.env'), 'TOKEN=old');
});

gitTest('a project in a sub-folder of its repository: the git steps stop with the reason, nothing is staged', () => {
  const { work } = setup({ remote: false });
  const sub = path.join(work, 'proj');
  write(sub, '.keel/config.json', JSON.stringify(CONFIG()));
  write(sub, 'a.js', 'a\n');
  for (const args of [['start', '--name', 'x'], ['commit', '--message-file', 'm.txt'], ['push']]) {
    const out = flow(sub, ...args);
    assert.equal(out[0], 'git-flow: stopped', args[0]);
    assert.match(line(out, 'reason:'), /not the top folder/, args[0]);
  }
  assert.equal(flow(sub, 'status')[0], 'git-flow: ok', 'status still reads');
  assert.equal(git(work, 'diff', '--cached', '--name-only'), '');
});

gitTest('sync: up to date, merges new main commits, and stops cleanly on a conflict', () => {
  const { tmp, work, server } = setup();
  flow(work, 'start', '--name', 'CAN-4-sync');
  write(work, 'src/app.js', 'one\nmine\nthree\n');
  commitWork(work);
  assert.match(flow(work, 'sync')[1], /up to date/);

  otherPush(server, tmp, 'docs/a.md', 'a\n', 'docs');
  let out = flow(work, 'sync');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.match(out[1], /merged 1 new commits/);

  otherPush(server, tmp, 'src/app.js', 'one\ntheirs\nthree\n', 'conflicting');
  const before = git(work, 'rev-parse', 'HEAD');
  out = flow(work, 'sync');
  assert.equal(out[0], 'git-flow: stopped');
  assert.match(line(out, 'reason:'), /conflict/);
  assert.match(line(out, 'conflicts:'), /src\/app\.js/);
  assert.equal(git(work, 'rev-parse', 'HEAD'), before, 'nothing merged');
  assert.equal(git(work, 'status', '--porcelain'), '', 'the tree is clean again');

  write(work, 'src/app.js', 'dirty\n');
  assert.match(line(flow(work, 'sync'), 'reason:'), /uncommitted/);
});

gitTest('push and merge --no-ff into main; the merge question is the last step', () => {
  const { work, server } = setup();
  flow(work, 'start', '--name', 'CAN-5-merge');
  write(work, 'src/app.js', 'one\nmerged\nthree\n');
  commitWork(work);
  let out = flow(work, 'merge');
  assert.equal(out[0], 'git-flow: stopped', 'an unpushed branch is not merged');
  assert.match(line(out, 'reason:'), /not pushed/);
  out = flow(work, 'push');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  out = flow(work, 'merge', '--into', 'main');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.equal(git(work, 'branch', '--show-current'), 'main');
  assert.equal(git(work, 'log', '-1', '--format=%P').split(' ').length, 2, 'a merge commit (--no-ff)');
  assert.equal(execFileSync('git', ['--git-dir', server, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), git(work, 'rev-parse', 'HEAD'));
});

gitTest('merge stops when local main has commits that were never pushed: they are not published with it', () => {
  const { work, server } = setup();
  write(work, 'local.txt', 'mine\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'local only');
  const serverMain = execFileSync('git', ['--git-dir', server, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  flow(work, 'start', '--name', 'CAN-6-feat');
  write(work, 'src/app.js', 'one\nfeat\nthree\n');
  commitWork(work);
  flow(work, 'push');
  const out = flow(work, 'merge');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.match(line(out, 'reason:'), /local main has commits/);
  assert.equal(git(work, 'branch', '--show-current'), 'CAN-6-feat');
  assert.equal(execFileSync('git', ['--git-dir', server, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), serverMain, 'nothing published');
});

gitTest('protected main: the merge is undone locally and a pull request is proposed, not created', () => {
  const { work, server } = setup();
  protectMain(server);
  flow(work, 'start', '--name', 'CAN-6-protected');
  write(work, 'src/app.js', 'one\nprotected\nthree\n');
  commitWork(work);
  assert.equal(flow(work, 'push')[0], 'git-flow: ok');
  const mainBefore = git(work, 'rev-parse', 'main');
  const out = flow(work, 'merge');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.match(line(out, 'reason:'), /protected/);
  assert.equal(line(out, 'pull request:'), 'pull request: gh pr create --base main --head CAN-6-protected --fill');
  assert.equal(git(work, 'rev-parse', 'main'), mainBefore, 'local main is back where it was');
  assert.equal(git(work, 'branch', '--show-current'), 'CAN-6-protected');
  assert.equal(git(work, 'status', '--porcelain'), '');
});

gitTest('protected main: undoing the merge keeps a modified secret file the commit left out', () => {
  const { work, server } = setup();
  write(work, '.env', 'TOKEN=old\n');
  git(work, 'add', '.env');
  git(work, 'commit', '-q', '-m', 'tracked env');
  git(work, 'push', '-q', 'origin', 'main');
  protectMain(server);
  flow(work, 'start', '--name', 'CAN-7-env');
  write(work, 'src/app.js', 'one\nenv\nthree\n');
  commitWork(work);
  assert.equal(flow(work, 'push')[0], 'git-flow: ok');
  write(work, '.env', 'TOKEN=new-local\n');
  const out = flow(work, 'merge');
  assert.equal(out[0], 'git-flow: stopped', out.join('\n'));
  assert.equal(git(work, 'branch', '--show-current'), 'CAN-7-env');
  assert.equal(fs.readFileSync(path.join(work, '.env'), 'utf8'), 'TOKEN=new-local\n', 'the local change survives');
});

gitTest('commit leaves out untracked files that were there before the task and did not change', () => {
  const { work } = setup();
  const { fileStamp } = require(path.join(SCRIPTS, 'lib', 'diff.js'));
  write(work, 'dump.sql', 'INSERT INTO customers VALUES (1);\n');
  write(work, 'notes-old.txt', 'old\n');
  write(work, '.keel/local/session-start.json', JSON.stringify({ untracked: { 'dump.sql': fileStamp(work, 'dump.sql'), 'notes-old.txt': fileStamp(work, 'notes-old.txt') } }));
  flow(work, 'start', '--name', 'CAN-8-stray');
  write(work, 'src/app.js', 'one\nstray\nthree\n');
  write(work, 'src/new.js', 'new\n');
  write(work, 'notes-old.txt', 'old, edited by the task\n');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  const committed = git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(!committed.includes('dump.sql'), 'there before the task, unchanged: left out');
  assert.ok(committed.includes('src/new.js') && committed.includes('notes-old.txt'), 'new and changed files go in');
  assert.match(line(out, 'not committed (untracked before the task'), /dump\.sql/);
  assert.match(git(work, 'status', '--porcelain'), /\?\? dump\.sql/, 'it stays where it was');
  assert.equal(flow(work, 'push')[0], 'git-flow: ok');
  const merged = flow(work, 'merge');
  assert.equal(merged[0], 'git-flow: ok', `a file that is not this task's work does not stop the finish: ${merged.join('\n')}`);
  assert.ok(fs.existsSync(path.join(work, 'dump.sql')));
});

gitTest('without a remote: push is skipped, merge is local', () => {
  const { work } = setup({ remote: false });
  flow(work, 'start', '--name', 'local-only');
  write(work, 'src/app.js', 'one\nlocal\nthree\n');
  commitWork(work);
  assert.match(flow(work, 'push')[1], /no remote/);
  const out = flow(work, 'merge');
  assert.equal(out[0], 'git-flow: ok');
  assert.match(out[1], /local only/);
});

gitTest('notes: sizes, the note behind main, the unfinished tasks and the session start', () => {
  const { tmp, work, server } = setup();
  assert.deepEqual(notes(work, 'check').slice(0, 3), ['note: missing', 'memory: missing', 'tasks: 0 unfinished']);

  flow(work, 'start', '--name', 'CAN-7-line');
  write(work, '.keel/next-session.md', `---\nstatus: active\nbranch: CAN-7-line\nbase: main\nafter_commit: -\ndate: 2026-10-10\n---\n\n# Next session\n${'x\n'.repeat(160)}`);
  write(work, '.keel/memory/project-memory.md', '# Project memory\n');
  commitWork(work, 'docs: note\n');
  write(work, '.keel/tasks/CAN-7/task.md', '---\nid: CAN-7\ntitle: Export button\nstatus: active\nplan: inline\nupdated: 2026-10-10\n---\n\n# CAN-7: Export button\n\n## Goal\nAdd the export button\n');
  otherPush(server, tmp, 'b.txt', 'b\n', 'main moves on');
  git(work, 'fetch', '-q');

  let out = notes(work, 'check', '--begin', '--session', 's1');
  assert.match(line(out, 'note:'), /status active, branch CAN-7-line/);
  assert.match(line(out, 'note:'), /over the limit/);
  assert.match(line(out, 'note behind:'), /origin\/main has 1 new commits/);
  assert.match(line(out, 'memory:'), /1 \/ 150/);
  assert.equal(line(out, 'tasks:'), 'tasks: 1 unfinished (CAN-7)');
  assert.equal(line(out, 'active task:'), 'active task: none');
  assert.match(line(out, 'session start:'), /0 commits since/);
  assert.match(line(out, 'next session log:'), /\.keel\/sessions\/\d{4}-\d\d-\d\d-001\.md/);

  write(work, 'src/app.js', 'later\n');
  commitWork(work, 'feat: later\n');
  assert.match(line(notes(work, 'check'), 'session start:'), /1 commits since \(verify with --base [0-9a-f]{7}\)/);
});

gitTest('commit: the message file must be inside .keel/local/tmp/; .keel/local/ is never committed', () => {
  const { tmp, work } = setup();
  flow(work, 'start', '--name', 'CAN-9-local');
  write(work, 'src/app.js', 'one\nTWO\nthree\n');
  fs.writeFileSync(path.join(tmp, 'outside.txt'), 'SECRET_FROM_OUTSIDE\n');
  for (const file of [path.join(tmp, 'outside.txt'), '../outside.txt', '.keel/local/tmp/../../../../outside.txt']) {
    const out = flow(work, 'commit', '--message-file', file);
    assert.equal(out[0], 'git-flow: stopped', file);
    assert.match(line(out, 'reason:'), /inside \.keel\/local\/tmp/);
  }
  fs.rmSync(path.join(work, '.keel', '.gitignore'));
  write(work, '.keel/local/usage/out/day.json', '{"prompt":"private"}\n');
  git(work, 'add', '-f', '.keel/local/usage/out/day.json');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  const committed = git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.ok(!committed.some((p) => p.startsWith('.keel/local/')), committed.join(', '));
});

gitTest('trust: only for the autonomous mode; status says whether this machine confirmed it', () => {
  const usageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-trust-'));
  const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'git-flow.js'), dir, ...args], { encoding: 'utf8', env: { ...process.env, KEEL_USAGE_DIR: usageDir } }).stdout.trim().split('\n');
  const manual = setup({ mode: 'manual', remote: false }).work;
  assert.equal(run(manual, 'trust')[0], 'git-flow: stopped');
  const { work } = setup({ remote: false });
  assert.match(line(run(work, 'status'), 'autonomous on this machine:'), /not confirmed/);
  assert.deepEqual(run(work, 'trust').slice(0, 2), ['git-flow: ok', 'autonomous git confirmed for this project on this machine']);
  assert.match(line(run(work, 'status'), 'autonomous on this machine:'), /: confirmed/);
  assert.ok(!fs.existsSync(path.join(work, '.keel', 'local', 'trusted-git.json')), 'the confirmation lives outside the repository');
});

gitTest('trust covers the git settings it was given: a branch that changes them gets no silent step; a push on main is never silent', () => {
  const usageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-trust-'));
  const env = { ...process.env, KEEL_USAGE_DIR: usageDir };
  const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'git-flow.js'), dir, ...args], { encoding: 'utf8', env }).stdout.trim().split('\n');
  const PLUGIN = path.join(SCRIPTS, '..');
  const s = SCRIPTS.split(path.sep).join('/');
  const hook = (dir, step) => {
    const p = dir.split(path.sep).join('/');
    const clean = Object.fromEntries(Object.entries(env).filter(([k]) => !k.startsWith('CLAUDE_')));
    const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `node "${s}/git-flow.js" "${p}" ${step}` } }),
      env: { ...clean, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: p },
      encoding: 'utf8',
    });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null;
  };
  const { work } = setup();
  const config = JSON.parse(fs.readFileSync(path.join(work, '.keel', 'config.json'), 'utf8'));
  config.git.ask_before_merge = false;
  write(work, '.keel/config.json', JSON.stringify(config));
  assert.equal(run(work, 'trust')[1], 'autonomous git confirmed for this project on this machine');
  assert.equal(hook(work, 'push'), null, 'on the main branch a push is never silent');
  git(work, 'switch', '-q', '-c', 'CAN-1-x');
  for (const step of ['push', 'merge', 'commit --message-file x']) assert.equal(hook(work, step), 'allow', step);
  // A branch edits the git section (keys reordered alone change nothing).
  write(work, '.keel/config.json', JSON.stringify({ ...config, git: Object.fromEntries(Object.entries(config.git).reverse()) }));
  assert.equal(hook(work, 'push'), 'allow', 'the same settings in another order');
  write(work, '.keel/config.json', JSON.stringify({ ...config, git: { ...config.git, main_branch: 'x' } }));
  for (const step of ['push', 'commit --message-file x', 'start --name y']) assert.equal(hook(work, step), null, `changed settings: ${step}`);
  assert.equal(hook(work, 'merge'), 'ask', 'changed settings: the merge asks again');
  assert.equal(line(run(work, 'status'), 'autonomous on this machine:'), 'autonomous on this machine: settings changed since you confirmed — run trust again (Claude Code asks before each git step until then)');
  assert.equal(run(work, 'trust')[1], 'autonomous git confirmed again for this project on this machine, with its current git settings');
  assert.equal(hook(work, 'push'), 'allow');
  // The remote's default branch counts as the main line too, whatever main_branch says.
  git(work, 'remote', 'set-head', 'origin', 'main');
  git(work, 'switch', '-q', 'main');
  assert.equal(hook(work, 'push'), null);
  // An entry that is not { path, git } is not a confirmation.
  const bare = path.resolve(work).replace(/\\/g, '/');
  fs.writeFileSync(path.join(usageDir, 'trusted-git.json'), JSON.stringify({ projects: [process.platform === 'win32' ? bare.toLowerCase() : bare] }));
  assert.doesNotMatch(line(run(work, 'status'), 'autonomous on this machine:'), /: confirmed/);
});
