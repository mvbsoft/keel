'use strict';
// plans.js commit and push, and new in the repository, on throwaway projects: a bare repository plays
// the server, a second clone plays a colleague. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gitTest, LOCAL, git, write, readRel, exists, run, planning, setup, otherPush, ready, trashed } = require('./fixtures/plans-git.js');

// --- commit and push ---

gitTest('commit: refused on main, detached, during a merge, without a feature; the folder commits as it is and nothing is removed; other staged changes stay out', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (on the main branch main; planning files go to a feature branch first)']);
  git(work, 'checkout', '-q', '--detach');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (HEAD is detached; switch to a branch first)']);
  git(work, 'checkout', '-q', '-b', 's3-storage');
  fs.writeFileSync(path.join(work, '.git', 'MERGE_HEAD'), `${git(work, 'rev-parse', 'HEAD')}\n`);
  assert.match(run(work, 'commit', 's3-storage')[0], /^plans: commit refused \(a git operation is in progress \(MERGE_HEAD\)/);
  assert.match(run(work, 'push', 's3-storage')[0], /^plans: push refused \(a git operation is in progress/);
  fs.rmSync(path.join(work, '.git', 'MERGE_HEAD'));
  assert.deepEqual(run(work, 'commit', 'no-such-plan'), ['plans: commit refused (no feature "no-such-plan" in the repository)']);
  assert.deepEqual(run(work, 'commit', 's3-storage', '--repo', 'WEB'), ['plans: commit refused (--repo: a feature is committed and pushed in the repository that holds its folder; run it there)']);

  write(work, 'tickets/s3-storage/reviews/plan.md', '# Plan review\n\nNothing to fix.\n');
  write(work, 'src/other.js', 'module.exports = 3;\n');
  git(work, 'add', 'src/other.js');
  const plan = run(work, 'commit', 's3-storage');
  assert.match(plan[0], /^committed: [0-9a-f]{7,} Plan s3-storage$/);
  assert.deepEqual(git(work, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), [
    'tickets/s3-storage/plan.md', 'tickets/s3-storage/reviews/plan.md', 'tickets/s3-storage/tickets/T1-ticket-1.md', 'tickets/s3-storage/tickets/T2-ticket-2.md',
  ]);
  assert.equal(git(work, 'diff', '--cached', '--name-only'), 'src/other.js', 'a change staged before stays staged');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['commit: nothing to commit']);
  // A status change is committed as an update; every file stays where it is.
  run(work, 'status', 's3-storage', 'T1', 'in-progress');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Update the s3-storage plan$/);
  assert.ok(exists(work, 'tickets/s3-storage/tickets/T1-ticket-1.md') && exists(work, 'tickets/s3-storage/plan.md'));
  assert.deepEqual(trashed(work), [], 'nothing goes to keel\'s trash');
});

gitTest('commit: a feature on this machine never goes into git', () => {
  const { work } = setup({ remote: false });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (s3-storage is on this machine only (place pc): none of it goes into git)']);
  assert.deepEqual(run(work, 'push', 's3-storage'), ['plans: push refused (s3-storage is on this machine only (place pc): none of it goes into git)']);
  assert.ok(exists(work, `${LOCAL}/s3-storage/plan.md`));
});

gitTest('commit: a path of this machine in a file it would commit refuses it with the file and the line; nothing is staged or committed', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  const plan = 'tickets/s3-storage/plan.md';
  const at = `${work.split(path.sep).join('/')}/src/app.js`;
  write(work, plan, readRel(work, plan).replace('Files go to S3.', `Files go to S3, as ${at} does.`));
  const head = git(work, 'rev-parse', 'HEAD');
  const lineNo = readRel(work, plan).split('\n').findIndex((l) => l.includes(at)) + 1;
  assert.deepEqual(run(work, 'commit', 's3-storage'), [
    'plans: commit refused (1 paths of this machine in the files to commit; write them from the repository\'s root)',
    `- ${plan}: local path ${at} (line ${lineNo})`,
  ]);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head, 'nothing committed');
  assert.equal(git(work, 'diff', '--cached', '--name-only'), '', 'nothing staged');
  write(work, plan, readRel(work, plan).replace(at, 'src/app.js'));
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Plan s3-storage$/);
});

gitTest('new in the repository: refused while a branch of that name (local or on the remote) may hold the feature; allowed on that branch', () => {
  const { tmp, work, server } = setup();
  planning(work, { place: 'repo' });
  const refused = (f) => [`plans: new refused (branch ${f} exists and may hold this feature: switch to it, or pick another name)`];
  git(work, 'branch', 's3-storage');
  assert.deepEqual(run(work, 'new', 's3-storage'), refused('s3-storage'));
  assert.ok(!exists(work, 'tickets/s3-storage'));
  otherPush(server, tmp, 'csv-export', 'tickets/csv-export/plan.md', '---\ntype: plan\nstatus: draft\n---\n');
  git(work, 'fetch', '-q', 'origin');
  assert.deepEqual(run(work, 'new', 'csv-export'), refused('csv-export'));
  git(work, 'checkout', '-q', 's3-storage');
  assert.equal(run(work, 'new', 's3-storage')[0], 'created: tickets/s3-storage/plan.md');
  // A feature on this machine is not in git: no branch check.
  assert.equal(run(work, 'new', 'csv-export', '--place', 'pc')[0], `created: ${LOCAL}/csv-export/plan.md`);
});

gitTest('push: the branch goes to the remote; a remote ahead of the branch is refused and explained; on main refused', () => {
  const { tmp, work, server } = setup();
  planning(work, { place: 'repo' });
  assert.deepEqual(run(work, 'push', 'whatever-thing'), ['plans: push refused (on the main branch main; planning files go to a feature branch first)']);
  git(work, 'checkout', '-q', '-b', 'plan-s3');
  run(work, 'new', 's3-storage');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: .* Plan s3-storage$/);
  assert.deepEqual(run(work, 'push', 's3-storage'), ['pushed: plan-s3 -> origin/plan-s3']);
  git(work, 'checkout', '-q', '-b', 'plan-csv', 'main');
  run(work, 'new', 'csv-export');
  run(work, 'commit', 'csv-export');
  otherPush(server, tmp, 'plan-csv', 'notes.txt', 'theirs\n');
  assert.match(run(work, 'push', 'csv-export')[0], /^plans: push refused \(origin\/plan-csv has commits this branch does not have; look at them before pushing: /);
});

gitTest('commit: a feature folder HEAD has and the working tree no longer has (drop) is committed as its removal', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: /);
  write(work, 'tickets/payments/plan.md', '---\ntype: plan\nstatus: draft\n---\n# payments\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'payments');
  for (const n of [1, 2]) run(work, 'status', 's3-storage', `T${n}`, 'done');
  const head = git(work, 'rev-parse', 'HEAD');
  assert.match(run(work, 'drop', 's3-storage')[0], /^drop: tickets\/s3-storage\/? -> trash /);
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Remove the s3-storage plan$/);
  assert.equal(git(work, 'rev-parse', 'HEAD~1'), head);
  assert.ok(git(work, 'show', '--name-status', '--format=', 'HEAD').split('\n').every((l) => l.startsWith('D\ttickets/s3-storage/')));
  assert.ok(exists(work, 'tickets/payments/plan.md'), 'another feature\'s folder stays');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (no feature "s3-storage" in the repository)']);
});
