'use strict';
// plans.js commit and push, and new in the repository, on throwaway projects: a bare repository plays
// the server, a second clone plays a colleague. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gitTest, LOCAL, git, write, readRel, exists, run, line, planning, setup, otherPush, ready, trashed } = require('./fixtures/plans-export.js');

// --- commit and push ---

gitTest('commit: refused on main, detached, during a merge, without a draft; a draft commits as "Plan"; an export commits its tickets and the draft leaves in the same commit; other staged changes stay out', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (on the main branch main; planning files go to a feature branch first)']);
  git(work, 'checkout', '-q', '--detach');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (HEAD is detached; switch to a branch first)']);
  git(work, 'checkout', '-q', '-b', 's3-storage');
  fs.writeFileSync(path.join(work, '.git', 'MERGE_HEAD'), `${git(work, 'rev-parse', 'HEAD')}\n`);
  assert.match(run(work, 'commit', 's3-storage')[0], /^plans: commit refused \(a git operation is in progress \(MERGE_HEAD\)/);
  assert.match(run(work, 'push', 's3-storage')[0], /^plans: push refused \(a git operation is in progress/);
  fs.rmSync(path.join(work, '.git', 'MERGE_HEAD'));
  assert.match(run(work, 'commit', 'no-such-plan')[0], /refused \(no draft or exported tickets "no-such-plan" in the repository\)/);

  const plan = run(work, 'commit', 's3-storage');
  assert.match(plan[0], /^committed: [0-9a-f]{7,} Plan s3-storage$/);
  assert.match(git(work, 'show', '--name-only', '--format=', 'HEAD'), /tickets\/s3-storage\/plan\.md/);
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['commit: nothing to commit']);

  run(work, 'export', 's3-storage');
  write(work, 'src/app.js', 'staged change\n');
  git(work, 'add', 'src/app.js');
  const out = run(work, 'commit', 's3-storage');
  assert.match(out[0], /^committed: [0-9a-f]{7,} Add the s3-storage tickets$/);
  assert.equal(out[1], 'fetch: no remote, skipped; keys from this clone only');
  const files = git(work, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').split('\n').sort();
  assert.deepEqual(files, [
    'A\ttickets/s3-storage/PROJ-1-ticket-1.md', 'A\ttickets/s3-storage/PROJ-2-ticket-2.md', 'A\ttickets/s3-storage/README.md',
    'D\ttickets/s3-storage/plan.md', 'D\ttickets/s3-storage/tickets/T1-ticket-1.md', 'D\ttickets/s3-storage/tickets/T2-ticket-2.md',
  ]);
  assert.equal(git(work, 'diff', '--cached', '--name-only'), 'src/app.js', 'the staged change stays staged, outside the commit');
  assert.equal(git(work, 'log', '-1', '--format=%B'), 'Add the s3-storage tickets');
  assert.ok(trashed(work).length === 1, 'the draft files are in keel\'s trash');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['commit: nothing to commit', 'fetch: no remote, skipped; keys from this clone only'], 'an export checks its keys before every commit');
  assert.deepEqual(run(work, 'push', 's3-storage'), ['push: no remote, nothing pushed']);
});

gitTest('commit and push: a key taken on another branch since the export is renumbered (files and references); one already on the remote is refused', () => {
  const { tmp, work, server } = setup();
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage');
  assert.equal(run(work, 'export', 's3-storage')[1], '- T1 -> PROJ-1: tickets/s3-storage/PROJ-1-ticket-1.md');
  // A colleague took PROJ-2 meanwhile; PROJ-10 is another key, not PROJ-1.
  otherPush(server, tmp, 'other-work', 'tickets/payments/PROJ-2-pay.md', '---\ntype: ticket\nkey: PROJ-2\n---\n');
  otherPush(server, tmp, 'more-work', 'tickets/payments/PROJ-10-refund.md', '---\ntype: ticket\nkey: PROJ-10\n---\n');
  // A project hook stops the commit: the renumbering is still reported, its files are renamed.
  const hook = path.join(work, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  assert.deepEqual(run(work, 'push', 's3-storage'), ['plans: push refused (PROJ-2 is also tickets/payments/PROJ-2-pay.md on origin/other-work: commit again (plans.js commit s3-storage gives it a new number), then push)']);
  const stopped = run(work, 'commit', 's3-storage');
  assert.match(stopped[0], /^plans: commit refused \(git commit failed \(a project hook\?\)/, 'the result comes first');
  assert.equal(stopped[1], 'renumbered: PROJ-2 -> PROJ-11');
  fs.rmSync(hook);
  const out = run(work, 'commit', 's3-storage');
  assert.match(out[0], /^committed: [0-9a-f]{7,} Add the s3-storage tickets$/);
  assert.ok(!exists(work, 'tickets/s3-storage/PROJ-2-ticket-2.md'));
  const t = readRel(work, 'tickets/s3-storage/PROJ-11-ticket-2.md');
  assert.match(t, /^key: PROJ-11$/m);
  assert.match(t, /^# \[PROJ-11\] Title of PROJ-11$/m);
  assert.match(t, /^depends_on: \[PROJ-1\]$/m);
  assert.match(readRel(work, 'tickets/s3-storage/README.md'), /\(PROJ-11 builds on PROJ-1\)/);
  assert.deepEqual(run(work, 'push', 's3-storage'), ['pushed: s3-storage -> origin/s3-storage']);
  assert.equal(git(server, 'rev-parse', 'refs/heads/s3-storage'), git(work, 'rev-parse', 'HEAD'));
  assert.equal(git(work, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/s3-storage');

  // Now PROJ-1 turns up elsewhere, but ours is already on the remote: no renumbering.
  otherPush(server, tmp, 'late-work', 'docs/PROJ-1.md', 'x\n');
  write(work, 'tickets/s3-storage/PROJ-1-ticket-1.md', `${readRel(work, 'tickets/s3-storage/PROJ-1-ticket-1.md')}\nMore.\n`);
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (PROJ-1 is also docs/PROJ-1.md on origin/late-work, and this feature\'s PROJ-1 is already on origin/s3-storage: a published key is not renumbered; settle the duplicate by hand)']);
  assert.deepEqual(run(work, 'push', 's3-storage'), ['plans: push refused (PROJ-1 is also docs/PROJ-1.md on origin/late-work, and this feature\'s PROJ-1 is already on origin/s3-storage: a published key is not renumbered; settle the duplicate by hand)']);
});

gitTest('commit: when part of an exported draft cannot go to keel\'s trash, what went comes back and nothing is committed', () => {
  const { tmp, work } = setup({ remote: false });
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  run(work, 'settings', 'set', '--draft', 'repo');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  write(work, 'tickets/s3-storage/reviews/T1.md', 'decided\n');
  run(work, 'export', 's3-storage');
  // The draft's tickets/ folder becomes a link: keel's trash refuses the T-files below it.
  const elsewhere = path.join(tmp, 'elsewhere');
  fs.cpSync(path.join(work, 'tickets', 's3-storage', 'tickets'), elsewhere, { recursive: true });
  fs.rmSync(path.join(work, 'tickets', 's3-storage', 'tickets'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(work, 'tickets', 's3-storage', 'tickets'), 'junction');
  const head = git(work, 'rev-parse', 'HEAD');
  const out = run(work, 'commit', 's3-storage');
  assert.match(out[0], /^plans: commit refused \(the draft's files did not go to keel's trash: tickets\/s3-storage\/tickets\/T1-ticket-1\.md: .*is a link/);
  assert.ok(exists(work, 'tickets/s3-storage/plan.md'), 'plan.md is back');
  assert.ok(exists(work, 'tickets/s3-storage/reviews/T1.md'), 'reviews/ is back');
  assert.deepEqual(trashed(work), []);
  assert.equal(git(work, 'rev-parse', 'HEAD'), head);
  assert.match(line(run(work, 'list'), '- s3-storage'), /^- s3-storage: exported · /, 'the next commit still sees the exported draft');
});

gitTest('commit: a draft in its own repository folder; "Plan" leaves other files of the ticket folder alone; after export the committed draft leaves with the tickets; a draft on this machine is refused', () => {
  const { work } = setup({ remote: false, config: { planning: { tickets: 'repo', ticket_prefix: 'PROJ' } } });
  run(work, 'new', 'local-thing');
  run(work, 'settings', 'set', '--draft', 'repo', '--draft-dir', 'plans');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  assert.deepEqual(run(work, 'commit', 'local-thing'), ['plans: commit refused (the draft of local-thing is on this machine: none of it goes into git)']);
  ready(work, 's3-storage', 2, 'plans/s3-storage');
  write(work, 'tickets/s3-storage/notes.md', 'mine\n');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Plan s3-storage$/);
  assert.doesNotMatch(git(work, 'show', '--name-only', '--format=', 'HEAD'), /notes\.md/);
  assert.equal(git(work, 'status', '--porcelain', '--', 'tickets'), '?? tickets/');
  fs.rmSync(path.join(work, 'tickets'), { recursive: true });
  assert.equal(run(work, 'export', 's3-storage')[0], 'exported: tickets/s3-storage/ (2 tickets)');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Add the s3-storage tickets$/);
  assert.deepEqual(git(work, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').split('\n').sort(), [
    'A\ttickets/s3-storage/PROJ-1-ticket-1.md', 'A\ttickets/s3-storage/PROJ-2-ticket-2.md', 'A\ttickets/s3-storage/README.md',
    'D\tplans/s3-storage/plan.md', 'D\tplans/s3-storage/tickets/T1-ticket-1.md', 'D\tplans/s3-storage/tickets/T2-ticket-2.md',
  ]);
  assert.ok(!exists(work, 'plans/s3-storage'));
  assert.equal(git(work, 'status', '--porcelain'), '');
});

gitTest('new in the repository: refused while a branch of that name (local or on the remote) may hold the draft; allowed on that branch', () => {
  const { tmp, work, server } = setup();
  run(work, 'settings', 'set', '--draft', 'repo');
  const refused = (f) => [`plans: new refused (branch ${f} exists and may hold this draft: switch to it, or pick another name)`];
  git(work, 'branch', 's3-storage');
  assert.deepEqual(run(work, 'new', 's3-storage'), refused('s3-storage'));
  assert.ok(!exists(work, 'tickets/s3-storage'));
  otherPush(server, tmp, 'csv-export', 'tickets/csv-export/plan.md', '---\ntype: plan\nstatus: draft\n---\n');
  git(work, 'fetch', '-q', 'origin');
  assert.deepEqual(run(work, 'new', 'csv-export'), refused('csv-export'));
  git(work, 'checkout', '-q', 's3-storage');
  assert.equal(run(work, 'new', 's3-storage')[0], 'created: tickets/s3-storage/plan.md');
  // A draft on this machine is not in git: no branch check.
  run(work, 'settings', 'set', '--draft', 'pc');
  assert.equal(run(work, 'new', 'csv-export')[0], `created: ${LOCAL}/csv-export/plan.md`);
});

gitTest('push: a remote ahead of the branch is refused and explained; on main refused', () => {
  const { tmp, work, server } = setup();
  run(work, 'settings', 'set', '--draft', 'repo');
  assert.deepEqual(run(work, 'push', 'whatever-thing'), ['plans: push refused (on the main branch main; planning files go to a feature branch first)']);
  git(work, 'checkout', '-q', '-b', 'plan-s3');
  run(work, 'new', 's3-storage');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: .* Plan s3-storage$/);
  otherPush(server, tmp, 'plan-s3', 'notes.txt', 'theirs\n');
  assert.match(run(work, 'push', 's3-storage')[0], /^plans: push refused \(origin\/plan-s3 has commits this branch does not have; look at them before pushing: /);
});

gitTest('commit: a ticket folder HEAD has and the working tree no longer has is committed as its removal on the feature branch; refused on main', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage');
  run(work, 'export', 's3-storage');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: /);
  write(work, 'tickets/payments/PROJ-9-pay.md', '---\ntype: ticket\nkey: PROJ-9\n---\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'payments');
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--ff-only', 's3-storage');
  fs.rmSync(path.join(work, 'tickets', 's3-storage'), { recursive: true });
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (on the main branch main; planning files go to a feature branch first)']);
  git(work, 'checkout', '-q', '--', 'tickets');
  git(work, 'checkout', '-q', 's3-storage');
  const head = git(work, 'rev-parse', 'HEAD');
  fs.rmSync(path.join(work, 'tickets', 's3-storage'), { recursive: true });
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Remove the s3-storage tickets$/);
  assert.equal(git(work, 'rev-parse', 'HEAD~1'), head);
  assert.deepEqual(git(work, 'show', '--name-status', '--format=', 'HEAD').split('\n').sort(), [
    'D\ttickets/s3-storage/PROJ-1-ticket-1.md', 'D\ttickets/s3-storage/PROJ-2-ticket-2.md', 'D\ttickets/s3-storage/README.md',
  ]);
  assert.ok(exists(work, 'tickets/payments/PROJ-9-pay.md'), 'another feature\'s folder stays');
  assert.equal(git(work, 'status', '--porcelain'), '');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (no draft or exported tickets "s3-storage" in the repository)']);
});
