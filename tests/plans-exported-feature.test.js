'use strict';
// An exported feature reopened (mark set, ticket, check, commit on a teammate's clone) and the write
// guard for its folder, on throwaway projects. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');
const { PLUGIN, SCRIPTS, gitTest, CONFIG, LOCAL, git, write, readRel, exists, run, body, front, planning, TICKET_BODY, setup, otherPush, ready } = require('./fixtures/plans-export.js');

const plans = require(path.join(SCRIPTS, 'lib', 'plans.js'));

// --- an exported feature, reopened ---

// The write guard's answer for a Write of `file` in the chat `sid`.
const guard = (dir, sid, file) => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'planning-guard.js')], { input: JSON.stringify({ session_id: sid, tool_name: 'Write', tool_input: { file_path: path.join(dir, file) }, cwd: dir }), env: { ...clean, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
};

gitTest('mark set on an exported feature: its folder in the working tree, also while plan.md says exported; one only a branch has is refused naming that branch', () => {
  const { work } = setup();
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  run(work, 'settings', 'set', '--draft', 'repo');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  run(work, 'export', 's3-storage');
  const marked = ['planning: s3-storage (exported: tickets/s3-storage/)'];
  assert.match(readRel(work, 'tickets/s3-storage/plan.md'), /^status: exported$/m);
  assert.deepEqual(run(work, 'mark', 'set', 's3-storage', '--session', 'chat-1'), marked, 'plan.md still says exported');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: /);
  assert.ok(!exists(work, 'tickets/s3-storage/plan.md'));
  assert.deepEqual(run(work, 'mark', 'set', 's3-storage', '--session', 'chat-2'), marked, 'no draft any more');
  assert.deepEqual(run(work, 'mark', 'get', '--session', 'chat-2'), ['planning: s3-storage']);
  run(work, 'push', 's3-storage');
  git(work, 'checkout', '-q', 'main');
  assert.ok(!exists(work, 'tickets/s3-storage'));
  assert.deepEqual(run(work, 'mark', 'set', 's3-storage', '--session', 'chat-3'), ['plans: mark set refused (the tickets of s3-storage are not in this working tree; branch s3-storage has them: switch to it first)']);
  git(work, 'branch', '-q', '-D', 's3-storage');
  assert.deepEqual(run(work, 'mark', 'set', 's3-storage', '--session', 'chat-3'), ['plans: mark set refused (the tickets of s3-storage are not in this working tree; branch origin/s3-storage has them: switch to it first)']);
  assert.equal(plans.planningMark(work, 'chat-3'), null);
  assert.match(run(work, 'mark', 'set', 'csv-export', '--session', 'chat-3')[0], /refused \(no draft "csv-export"/, 'no branch has it');
});

gitTest('ticket on an exported feature: the next key after a fetch, beside the others with the feature\'s front matter; check reads keys; the exported feature alone commits ("Update" once HEAD has its tickets) and pushes', () => {
  const { tmp, work, server } = setup();
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage');
  run(work, 'export', 's3-storage');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Add the s3-storage tickets$/, 'the first commit of the tickets');
  assert.deepEqual(run(work, 'push', 's3-storage'), ['pushed: s3-storage -> origin/s3-storage']);
  // A colleague took PROJ-7 on a branch this clone has not fetched yet.
  otherPush(server, tmp, 'payments', 'tickets/payments/PROJ-7-pay.md', '---\ntype: ticket\nkey: PROJ-7\n---\n');
  assert.deepEqual(run(work, 'ticket', 's3-storage', '--title', 'Delete files', '--depends', 'proj-2,PROJ-7'), ['created: tickets/s3-storage/PROJ-8-delete-files.md', 'ticket: PROJ-8', 'overview: tickets/s3-storage/README.md']);
  assert.match(readRel(work, 'tickets/s3-storage/README.md'), /^- PROJ-8 Delete files \(\S+\)$/m, 'the overview names the later ticket');
  const t = readRel(work, 'tickets/s3-storage/PROJ-8-delete-files.md');
  // The feature's page code from the tickets beside it.
  const code = /^page: ([0-9a-f]{8})$/m.exec(readRel(work, 'tickets/s3-storage/PROJ-2-ticket-2.md'))[1];
  assert.ok(t.startsWith(`---\ntype: ticket\nkey: PROJ-8\nstatus: todo\nfeature: s3-storage\npage: ${code}\nbranch: s3-storage\nmerge_into: main\ndepends_on: [PROJ-2, PROJ-7]\n---\n\n# [PROJ-8] Delete files\n`), t);
  assert.deepEqual(run(work, 'ticket', 's3-storage', '--title', 'X', '--depends', 'PROJ-70'), ['plans: ticket refused (--depends: no ticket PROJ-70)']);
  assert.ok(run(work, 'check', 's3-storage').some((l) => /^- PROJ-8: placeholder /.test(l)));
  body(work, 'tickets/s3-storage/PROJ-8-delete-files.md', TICKET_BODY('PROJ-8'));
  assert.deepEqual(run(work, 'check', 's3-storage'), ['check: clean (3 tickets in tickets/s3-storage/)'], 'PROJ-7 of another feature is a key that exists');
  front(work, 'tickets/s3-storage/PROJ-8-delete-files.md', 'depends_on', '[PROJ-8, PROJ-70]');
  assert.deepEqual(run(work, 'check', 's3-storage'), ['check: 2 problems', '- PROJ-8: depends on itself', '- PROJ-8: depends on PROJ-70, which does not exist']);
  front(work, 'tickets/s3-storage/PROJ-8-delete-files.md', 'depends_on', '[PROJ-2]');
  const out = run(work, 'commit', 's3-storage');
  assert.match(out[0], /^committed: [0-9a-f]{7,} Update the s3-storage tickets$/, 'HEAD already has the feature\'s tickets');
  assert.equal(git(work, 'show', '--name-status', '--format=', 'HEAD'), 'A\ttickets/s3-storage/PROJ-8-delete-files.md\nM\ttickets/s3-storage/README.md');
  assert.deepEqual(run(work, 'push', 's3-storage'), ['pushed: s3-storage -> origin/s3-storage']);
  assert.equal(git(server, 'rev-parse', 'refs/heads/s3-storage'), git(work, 'rev-parse', 'HEAD'));
});

gitTest('a teammate\'s clone with no planning settings finds the exported feature by its folder: mark set, the write guard, ticket, check, commit; a branch at HEAD is never named', () => {
  const { tmp, work, server } = setup();
  planning(work, { tickets: 'repo', tickets_dir: 'features', ticket_prefix: 'PROJ' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  ready(work, 's3-storage');
  run(work, 'export', 's3-storage');
  run(work, 'commit', 's3-storage');
  run(work, 'push', 's3-storage');
  const mate = path.join(tmp, 'mate');
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, mate]);
  git(mate, 'config', 'user.name', 'Mate');
  git(mate, 'config', 'user.email', 'mate@example.com');
  git(mate, 'checkout', '-q', 's3-storage');
  assert.ok(!exists(mate, `${LOCAL}/settings.json`), 'no planning settings on this machine');

  assert.deepEqual(run(mate, 'mark', 'set', 's3-storage', '--session', 'chat-1'), ['planning: s3-storage (exported: features/s3-storage/)']);
  assert.deepEqual(JSON.parse(readRel(mate, `${LOCAL}/sessions/chat-1.json`)), { feature: 's3-storage', folder: 'features/s3-storage' });
  assert.equal(guard(mate, 'chat-1', 'features/s3-storage/PROJ-3-x.md'), 'allow', 'the folder recorded in the mark');
  assert.equal(guard(mate, 'chat-1', 'features/payments/PROJ-9-x.md'), 'deny');
  assert.equal(guard(mate, 'chat-1', 'src/app.js'), 'deny');
  assert.deepEqual(run(mate, 'ticket', 's3-storage', '--title', 'Delete files'), ['created: features/s3-storage/PROJ-3-delete-files.md', 'ticket: PROJ-3', 'overview: features/s3-storage/README.md'], 'the feature\'s own prefix; none is set here');
  assert.deepEqual(run(mate, 'ticket', 's3-storage', '--title', 'Rename files'), ['created: features/s3-storage/PROJ-4-rename-files.md', 'ticket: PROJ-4', 'overview: features/s3-storage/README.md'], 'the folder\'s uncommitted PROJ-3 counts');
  body(mate, 'features/s3-storage/PROJ-3-delete-files.md', TICKET_BODY('PROJ-3'));
  body(mate, 'features/s3-storage/PROJ-4-rename-files.md', TICKET_BODY('PROJ-4'));
  assert.deepEqual(run(mate, 'check', 's3-storage'), ['check: clean (4 tickets in features/s3-storage/)']);
  write(mate, 'features/s3-storage/PROJ-4-copy.md', readRel(mate, 'features/s3-storage/PROJ-4-rename-files.md'));
  assert.deepEqual(run(mate, 'check', 's3-storage'), ['check: 1 problems', '- PROJ-4: duplicate key (2 files: PROJ-4-copy.md, PROJ-4-rename-files.md)']);
  fs.rmSync(path.join(mate, 'features', 's3-storage', 'PROJ-4-copy.md'));
  assert.match(run(mate, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Update the s3-storage tickets$/);
  assert.deepEqual(git(mate, 'show', '--name-status', '--format=', 'HEAD').split('\n'), ['A\tfeatures/s3-storage/PROJ-3-delete-files.md', 'A\tfeatures/s3-storage/PROJ-4-rename-files.md', 'M\tfeatures/s3-storage/README.md']);
  assert.deepEqual(run(mate, 'push', 's3-storage'), ['pushed: s3-storage -> origin/s3-storage']);

  // The folder removed by hand: only HEAD's commit has it, so no branch is named.
  fs.rmSync(path.join(mate, 'features', 's3-storage'), { recursive: true });
  assert.match(run(mate, 'mark', 'set', 's3-storage', '--session', 'chat-2')[0], /^plans: mark set refused \(no draft "s3-storage"/);
  assert.match(run(mate, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Remove the s3-storage tickets$/);
  assert.deepEqual(git(mate, 'show', '--name-status', '--format=', 'HEAD').split('\n').sort(), [
    'D\tfeatures/s3-storage/PROJ-1-ticket-1.md', 'D\tfeatures/s3-storage/PROJ-2-ticket-2.md', 'D\tfeatures/s3-storage/PROJ-3-delete-files.md',
    'D\tfeatures/s3-storage/PROJ-4-rename-files.md', 'D\tfeatures/s3-storage/README.md',
  ]);
  assert.deepEqual(run(mate, 'mark', 'set', 's3-storage', '--session', 'chat-2'), ['plans: mark set refused (the tickets of s3-storage are not in this working tree; branch origin/s3-storage has them: switch to it first)']);
});

gitTest('a feature folder under a non-ASCII folder commits as "Update" once HEAD has its tickets; a branch with the feature folder at the top is named', () => {
  const { work } = setup({ remote: false });
  const ticket = (key) => `---\ntype: ticket\nkey: ${key}\nstatus: todo\nfeature: s3-storage\nbranch: s3-storage\nmerge_into: main\ndepends_on: []\n---\n\n${TICKET_BODY(key)}`;
  write(work, 'плани/s3-storage/PROJ-1-client.md', ticket('PROJ-1'));
  git(work, 'checkout', '-q', '-b', 's3-storage');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'tickets');
  assert.deepEqual(run(work, 'ticket', 's3-storage', '--title', 'Second one'), ['created: плани/s3-storage/PROJ-2-second-one.md', 'ticket: PROJ-2', 'fetch: no remote, skipped; keys from this clone only']);
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Update the s3-storage tickets$/);
  // Another branch has csv-export/ at the top of the project.
  git(work, 'checkout', '-q', '-b', 'csv-work', 'main');
  write(work, 'csv-export/PROJ-5-rows.md', ticket('PROJ-5'));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'csv');
  git(work, 'checkout', '-q', 's3-storage');
  assert.deepEqual(run(work, 'mark', 'set', 'csv-export', '--session', 'chat-1'), ['plans: mark set refused (the tickets of csv-export are not in this working tree; branch csv-work has them: switch to it first)']);
  // A branch without a commit for 30 days is read only when it is named after the feature.
  const old = (branch) => {
    git(work, 'checkout', '-q', '-b', branch, 'main');
    write(work, 'plans/pay-flow/PROJ-6-pay.md', ticket('PROJ-6'));
    git(work, 'add', '-A');
    execFileSync('git', ['-C', work, 'commit', '-q', '-m', 'old'], { env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' }, stdio: 'ignore' });
    git(work, 'checkout', '-q', 's3-storage');
  };
  old('old-work');
  assert.match(run(work, 'mark', 'set', 'pay-flow', '--session', 'chat-1')[0], /^plans: mark set refused \(no draft "pay-flow"/);
  old('pay-flow');
  assert.deepEqual(run(work, 'mark', 'set', 'pay-flow', '--session', 'chat-1'), ['plans: mark set refused (the tickets of pay-flow are not in this working tree; branch pay-flow has them: switch to it first)']);
});

// --- the write guard ---

test('planning-guard: the exported feature folder in the repository is writable for the chat that plans it; other project files stay blocked', () => {
  const dir = tempDir('keel-export-guard-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG()));
  planning(dir, { tickets: 'repo', tickets_dir: 'features', ticket_prefix: 'PROJ' });
  run(dir, 'new', 's3-storage');
  run(dir, 'mark', 'set', 's3-storage', '--session', 'chat-plan');
  assert.equal(guard(dir, 'chat-plan', 'features/s3-storage/PROJ-1-client.md'), 'allow');
  assert.equal(guard(dir, 'chat-plan', 'features/s3-storage/README.md'), 'allow');
  assert.equal(guard(dir, 'chat-plan', 'features/payments/PROJ-9-pay.md'), 'deny');
  assert.equal(guard(dir, 'chat-plan', 'features/README.md'), 'deny');
  assert.equal(guard(dir, 'chat-plan', 'src/app.js'), 'deny');
});

test('planning-guard: without the planning section the default tickets/ folder of the planned feature is writable; other project files stay blocked', () => {
  const dir = tempDir('keel-export-guard-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG()));
  run(dir, 'new', 's3-storage');
  run(dir, 'mark', 'set', 's3-storage', '--session', 'chat-plan');
  assert.equal(guard(dir, 'chat-plan', 'tickets/s3-storage/PROJ-1-client.md'), 'allow');
  assert.equal(guard(dir, 'chat-plan', 'tickets/payments/PROJ-9-pay.md'), 'deny');
  assert.equal(guard(dir, 'chat-plan', 'src/app.js'), 'deny');
});

test('planning-guard: an exported feature reopened with mark set (no draft) is writable in its folder, in the repository and on this machine', () => {
  const dir = tempDir('keel-export-guard-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG()));
  planning(dir, { tickets: 'repo', tickets_dir: 'features', ticket_prefix: 'PROJ' });
  const ticket = (key, feature) => `---\ntype: ticket\nkey: ${key}\nstatus: todo\nfeature: ${feature}\n---\n`;
  write(dir, 'features/s3-storage/PROJ-1-client.md', ticket('PROJ-1', 's3-storage'));
  write(dir, `${LOCAL}/csv-export/tickets/PROJ-3-rows.md`, ticket('PROJ-3', 'csv-export'));
  assert.deepEqual(run(dir, 'mark', 'set', 's3-storage', '--session', 'chat-repo'), ['planning: s3-storage (exported: features/s3-storage/)']);
  assert.deepEqual(run(dir, 'mark', 'set', 'csv-export', '--session', 'chat-pc'), [`planning: csv-export (exported: ${LOCAL}/csv-export/tickets/)`]);
  assert.equal(guard(dir, 'chat-repo', 'features/s3-storage/PROJ-2-upload.md'), 'allow');
  assert.equal(guard(dir, 'chat-repo', `${LOCAL}/csv-export/tickets/PROJ-4-x.md`), 'deny');
  assert.equal(guard(dir, 'chat-pc', `${LOCAL}/csv-export/tickets/PROJ-4-x.md`), 'allow');
  assert.equal(guard(dir, 'chat-pc', 'features/s3-storage/PROJ-2-upload.md'), 'deny');
  assert.equal(guard(dir, 'chat-pc', 'src/app.js'), 'deny');
});

gitTest('featureFolder: the feature name is matched as written, not as a pattern', () => {
  const dir = tempDir('keel-export-name-');
  git(dir, 'init', '-q');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG()));
  write(dir, 'work/axc/PROJ-1-client.md', '---\ntype: ticket\nkey: PROJ-1\nstatus: todo\n---\n# [PROJ-1] Client\n');
  const { featureFolder } = require(path.join(SCRIPTS, 'lib', 'plans-export.js'));
  assert.equal(featureFolder(dir, 'axc')?.folder, path.join(dir, 'work', 'axc'), 'the control: the name itself');
  assert.equal(featureFolder(dir, 'a.c'), null);
});
