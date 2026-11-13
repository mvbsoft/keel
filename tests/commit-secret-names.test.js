'use strict';
// git-flow commit: a new file named like a secret is left out even when it is a source file; a tracked one is code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const flow = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'git-flow.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';
const commitWork = (work, message = 'feat: change\n') => {
  write(work, '.keel/local/tmp/commit-message.txt', message);
  return flow(work, 'commit', '--message-file', path.join(work, '.keel/local/tmp/commit-message.txt'));
};

const NEW_LINE = 'not committed (new files named like a secret; if one is code, commit it by hand once): ';

// A repository with a keel config, a tracked src/secrets.py and a task branch; no remote.
function setup() {
  const work = path.join(tempDir('keel-secret-commit-'), 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG));
  write(work, '.keel/.gitignore', 'local/\n');
  write(work, 'src/app.js', 'one\n');
  write(work, 'src/secrets.py', 'KEY = 1\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'checkout', '-q', '-b', 'task-1');
  return work;
}

gitTest('commit: new files named like a secret are left out and listed, a tracked one is committed as code', () => {
  const work = setup();
  write(work, 'src/credentials.js', 'module.exports = "k";\n');
  write(work, 'config/secrets.py', 'KEY = 2\n');
  write(work, 'config/credentials.json', '{}\n');
  write(work, 'src/secrets.py', 'KEY = 3\n');
  write(work, 'src/app.js', 'two\n');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.equal(line(out, 'not committed (secret'), 'not committed (secret files, by path only): config/credentials.json');
  const listed = line(out, 'not committed (new files').slice(NEW_LINE.length).split(', ').sort();
  assert.deepEqual(listed, ['config/secrets.py', 'src/credentials.js']);
  assert.ok(out.indexOf(line(out, 'not committed (secret')) < out.indexOf(line(out, 'not committed (new files')), 'after the secret line');
  assert.deepEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['src/app.js', 'src/secrets.py']);
});

gitTest('commit: a new secret-named file staged by hand comes out of the index', () => {
  const work = setup();
  write(work, 'src/credentials.js', 'module.exports = "k";\n');
  git(work, 'add', 'src/credentials.js');
  write(work, 'src/app.js', 'two\n');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.equal(line(out, 'not committed (new files'), `${NEW_LINE}src/credentials.js`);
  assert.deepEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['src/app.js']);
});

gitTest('commit: only a new secret-named file changed: nothing to commit, and the next step is not stopped', () => {
  const work = setup();
  write(work, 'src/credentials.js', 'module.exports = "k";\n');
  let out = commitWork(work);
  assert.equal(out[1], 'commit: nothing to commit', out.join('\n'));
  assert.equal(line(out, 'not committed (new files'), `${NEW_LINE}src/credentials.js`);
  out = flow(work, 'sync');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  out = flow(work, 'switch', '--name', 'main');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
});

gitTest('commit: a new file committed by hand once is code from then on', () => {
  const work = setup();
  write(work, 'src/credentials.js', 'module.exports = "k";\n');
  git(work, 'add', 'src/credentials.js');
  git(work, 'commit', '-q', '-m', 'by hand');
  write(work, 'src/credentials.js', 'module.exports = "other";\n');
  const out = commitWork(work);
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.equal(line(out, 'not committed (new files'), '');
  assert.deepEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n'), ['src/credentials.js']);
});
