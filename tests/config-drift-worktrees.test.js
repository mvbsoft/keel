'use strict';
// Rebuilding the configure record uses a temporary worktree; the user's own worktrees are left alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir, tempPath } = require('./fixtures/tmp.js');

const { ensureSnapshot } = require('../plugins/keel/scripts/lib/config-drift.js');

const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x.y', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x.y' };
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const listed = (dir) => git(dir, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));

function committedProject() {
  const dir = tempDir('keel-drift-wt-');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{}');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.keel/local/\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'set up keel');
  return dir;
}

test('a rebuild keeps the registration of the user\'s worktree whose folder was moved away', () => {
  const dir = committedProject();
  const moved = path.join(tempDir('keel-drift-wt-moved-'), 'feature');
  git(dir, 'worktree', 'add', '-q', '--detach', moved);
  fs.rmSync(moved, { recursive: true, force: true });
  assert.ok(ensureSnapshot(dir), 'the record is rebuilt');
  const entries = listed(dir).map((p) => path.resolve(p));
  assert.ok(entries.includes(path.resolve(moved)), 'the moved worktree is still registered');
  assert.equal(entries.length, 2, 'the temporary worktree is gone');
});

test('a rebuild keeps a leftover whose folder is in a temp folder without keel\'s prefix', () => {
  const dir = committedProject();
  const base = tempDir('keel-other-');
  git(dir, 'worktree', 'add', '-q', '--detach', path.join(base, 'tree'));
  fs.rmSync(path.join(base, 'tree'), { recursive: true, force: true });
  assert.ok(ensureSnapshot(dir));
  assert.ok(listed(dir).map((p) => path.resolve(p)).includes(path.resolve(path.join(base, 'tree'))), 'the registration is kept');
});

test('a rebuild clears the registration a killed rebuild left behind', () => {
  const dir = committedProject();
  const base = tempPath(fs.mkdtempSync(path.join(os.tmpdir(), 'keel-configure-')));
  git(dir, 'worktree', 'add', '-q', '--detach', path.join(base, 'tree'));
  fs.rmSync(base, { recursive: true, force: true });
  assert.equal(listed(dir).length, 2, 'the leftover is registered');
  assert.ok(ensureSnapshot(dir));
  assert.equal(listed(dir).length, 1, 'only the project itself is left');
});
