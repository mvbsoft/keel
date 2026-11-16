'use strict';
// plans.js tickets and drop: the states come from the status fields; git adds one warning (a ticket's
// branch merged into merge_into while the ticket is not done). Throwaway projects, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { gitTest, LOCAL, git, write, readRel, exists, run, front, planning, setup, ready, trashed } = require('./fixtures/plans-git.js');

const T = (n, folder = `${LOCAL}/s3-storage`) => `${folder}/tickets/T${n}-ticket-${n}.md`;

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

gitTest('drop: refused while a ticket is open and on the branch the feature merges into; then the folder goes to keel\'s trash', () => {
  const { work } = setup({ remote: false });
  planning(work, { place: 'repo' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  run(work, 'mark', 'set', 's3-storage', '--session', 'chat-1');
  assert.deepEqual(run(work, 'drop', 's3-storage'), ['plans: drop refused (not every ticket of s3-storage is done or abandoned: T1 ready, T2 ready)']);
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
  run(work, 'status', 's3-storage', 'T1', 'done');
  assert.match(run(work, 'drop', 's3-storage')[0], /^drop: \.keel\/local\/plans\/keel\/s3-storage\/? -> trash /);
  assert.ok(!exists(work, `${LOCAL}/s3-storage`));
});
