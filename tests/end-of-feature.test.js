'use strict';
// The script steps of End of feature (skills/_shared/git-end-of-feature.md) on a throwaway project with a
// bare repository as the server: the plan marked done outside a task's finish is committed and pushed on
// the feature branch before the merge, and `plans.js list` says when a done feature's branch is merged or
// gone, so End of feature is no longer offered for it. No network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { SCRIPTS, gitTest, git, run, planning, setup, ready } = require('./fixtures/plans-git.js');

const flow = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'git-flow.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const listed = (dir, feature) => run(dir, 'list').find((l) => l.startsWith(`- ${feature}: `)) || '';

gitTest('End of feature: the plan marked done is committed and pushed on the feature branch, then the merge carries it; a merged or deleted branch is named in plans.js list', () => {
  const { work } = setup();
  planning(work, { place: 'repo' });
  git(work, 'commit', '-q', '-am', 'Plan in the repository');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 1, 'tickets/s3-storage');
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  run(work, 'status', 's3-storage', 'T1', 'done');
  // The finish of the last ticket committed and pushed it; the plan is marked done afterwards
  // (/keel:tasks, or a start-task that found every ticket closed).
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: /);
  assert.match(run(work, 'push', 's3-storage')[0], /^pushed: s3-storage -> origin\/s3-storage$/);
  assert.deepEqual(run(work, 'state', 's3-storage', 'done'), ['status: done']);
  assert.doesNotMatch(listed(work, 's3-storage'), /merged into|not found/, 'its branch can still merge: End of feature is offered');

  // Uncommitted, the plan blocks the merge: git cannot leave the branch with it changed.
  const blocked = flow(work, 'merge', '--into', 'main');
  assert.equal(blocked[0], 'git-flow: stopped', blocked.join('\n'));
  assert.match(blocked[1], /^reason: could not switch to main: /, blocked.join('\n'));
  assert.equal(git(work, 'branch', '--show-current'), 's3-storage');

  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Update the s3-storage plan$/);
  assert.match(run(work, 'push', 's3-storage')[0], /^pushed: /);
  const merged = flow(work, 'merge', '--into', 'main');
  assert.equal(merged[0], 'git-flow: ok', merged.join('\n'));
  assert.ok(merged.some((l) => /^merge: s3-storage -> main \([0-9a-f]+\)$/.test(l)), merged.join('\n'));
  assert.match(git(work, 'show', 'origin/main:tickets/s3-storage/plan.md'), /^status: done$/m, 'main gets the plan as done');
  assert.equal(git(work, 'status', '--porcelain'), '');

  assert.match(listed(work, 's3-storage'), / · branch s3-storage merged into main$/);
  const deleted = flow(work, 'delete-branch', '--name', 's3-storage', '--remote');
  assert.equal(deleted[0], 'git-flow: ok', deleted.join('\n'));
  assert.match(listed(work, 's3-storage'), / · branch s3-storage not found$/);

  // Its tickets may still go, on a branch of their own: never on main.
  assert.match(run(work, 'drop', 's3-storage')[0], /^plans: drop refused \(on main, where the feature merges; .* on a branch of its own \(then plans\.js commit s3-storage there\)\)$/);
  git(work, 'checkout', '-q', '-b', 'remove-s3-storage-plan');
  assert.match(run(work, 'drop', 's3-storage')[0], /^drop: tickets\/s3-storage\/? -> trash /);
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Remove the s3-storage plan$/);
  assert.equal(listed(work, 's3-storage'), '', 'the feature is gone from the list');
});

gitTest('plans.js list: a branch merged on the server counts before main is pulled', () => {
  const { tmp, work, server } = setup();
  planning(work, { place: 'repo' });
  git(work, 'commit', '-q', '-am', 'Plan in the repository');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 1, 'tickets/s3-storage');
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  run(work, 'status', 's3-storage', 'T1', 'done');
  run(work, 'state', 's3-storage', 'done');
  run(work, 'commit', 's3-storage');
  run(work, 'push', 's3-storage');
  // A pull request merged on the server: a colleague's clone plays it.
  const other = path.join(tmp, 'merger');
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'merge', '-q', '--no-ff', '--no-edit', 'origin/s3-storage');
  git(other, 'push', '-q', 'origin', 'main');
  git(work, 'fetch', '-q', 'origin');
  assert.notEqual(git(work, 'rev-parse', 'main'), git(work, 'rev-parse', 'origin/main'), 'local main is behind');
  assert.match(listed(work, 's3-storage'), / · branch s3-storage merged into main$/);
});

gitTest('plans.js list: no branch mark for an open feature or a branch not merged yet; a done feature on this machine is kept there', () => {
  const { work } = setup({ remote: false });
  ready(work, 'csv-export', 1);
  run(work, 'status', 'csv-export', 'T1', 'in-progress');
  run(work, 'status', 'csv-export', 'T1', 'done');
  assert.match(listed(work, 'csv-export'), /^- csv-export: in-progress · .* \(this machine only\)$/);
  run(work, 'state', 'csv-export', 'done');
  // A feature on this machine has no feature branch; its keep or delete was asked when it was marked done.
  assert.match(listed(work, 'csv-export'), /^- csv-export: done · .* \(this machine only\) · kept on this machine$/);
  planning(work, { place: 'repo' });
  // A branch made from main with no commit of its own is not taken for merged.
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 1, 'tickets/s3-storage');
  assert.match(listed(work, 's3-storage'), /^- s3-storage: ready · .* · tickets\/s3-storage\/$/);
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  run(work, 'status', 's3-storage', 'T1', 'done');
  run(work, 'state', 's3-storage', 'done');
  assert.match(listed(work, 's3-storage'), /^- s3-storage: done · .* · tickets\/s3-storage\/$/);
});
