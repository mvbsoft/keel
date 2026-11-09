'use strict';
// plans.js set, stale, report, keys and export on throwaway projects. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');
const { SCRIPTS, gitTest, LOCAL, git, write, readRel, exists, run, line, body, front, planning, TICKET_BODY, setup, ready, trashed } = require('./fixtures/plans-export.js');

const { highestKey } = require(path.join(SCRIPTS, 'lib', 'plans-export.js'));
const { exportFeature } = require(path.join(SCRIPTS, 'lib', 'plans-export-repos.js'));
const { repoName } = require(path.join(SCRIPTS, 'lib', 'plans-format.js'));

// --- set ---

gitTest('set: new writes branch (the feature) and merge_into (the main branch); set changes them while draft; a ready plan becomes a draft', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  const plan = `${LOCAL}/s3-storage/plan.md`;
  assert.match(readRel(work, plan), /^branch: s3-storage$/m);
  assert.match(readRel(work, plan), /^merge_into: main$/m);
  assert.deepEqual(run(work, 'set', 's3-storage', '--branch', 'feat/s3', '--merge-into', 'develop'), ['branch: feat/s3', 'merge_into: develop', 'status: draft (the plan changed after ready)']);
  assert.match(readRel(work, plan), /^status: draft$/m);
  assert.match(readRel(work, plan), /^branch: feat\/s3$/m);
  assert.deepEqual(run(work, 'set', 's3-storage', '--branch', 'feat/s3'), ['branch: feat/s3', 'merge_into: develop'], 'the same value changes nothing');
  for (const bad of ['-x', 'a b', 'a..b', '@{-1}']) assert.match(run(work, 'set', 's3-storage', '--branch', bad)[0], /^plans: set refused \(--branch: .* is not a valid branch name\)$/, bad);
  assert.match(run(work, 'set', 's3-storage', '--merge-into')[0], /refused \(--merge-into: "true" is not a valid branch name\)/);
  assert.match(run(work, 'set', 's3-storage')[0], /refused \(nothing to set: --branch, --merge-into, --repos, --after-commit\)/);
  assert.match(run(work, 'set', 'no-such-plan', '--branch', 'x')[0], /refused \(no draft "no-such-plan"/);
  run(work, 'state', 's3-storage', 'abandoned');
  run(work, 'settings', 'set', '--draft', 'repo');
  run(work, 'new', 'csv-export');
  run(work, 'state', 'csv-export', 'abandoned');
  assert.match(run(work, 'set', 'csv-export', '--branch', 'x')[0], /refused \(the plan is abandoned\)/);
});

// --- stale ---

gitTest('stale: only the files the tickets name, compared with after_commit: commits since and uncommitted changes', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  const t2 = `${LOCAL}/s3-storage/tickets/T2-ticket-2.md`;
  body(work, t2, TICKET_BODY('T2', '`src/app.js:1`, src/other.js:1'));
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: none of 2 named files changed since ${git(work, 'rev-parse', '--short', 'HEAD')}`]);
  const after = git(work, 'rev-parse', '--short', 'HEAD');
  write(work, 'src/app.js', 'changed\n');
  write(work, 'src/unnamed.js', 'x\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'change');
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: 1 of 2 named files changed since ${after}: src/app.js`]);
  write(work, 'src/other.js', 'uncommitted\n');
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: 2 of 2 named files changed since ${after}: src/app.js, src/other.js`]);
  const plan = `${LOCAL}/s3-storage/plan.md`;
  front(work, plan, 'after_commit', 'deadbee');
  assert.deepEqual(run(work, 'stale', 's3-storage'), ['stale: unknown (after_commit deadbee not found)']);
  front(work, plan, 'after_commit', '-');
  assert.deepEqual(run(work, 'stale', 's3-storage'), ['stale: unknown (no after_commit)']);
});

gitTest('stale: a project below its repository\'s top folder compares its own paths', () => {
  const { work } = setup({ remote: false });
  const proj = path.join(work, 'apps', 'web');
  write(proj, '.keel/config.json', readRel(work, '.keel/config.json'));
  write(proj, '.keel/.gitignore', 'local/\n');
  write(proj, 'src/app.js', 'web\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'web');
  run(proj, 'new', 's3-storage');
  run(proj, 'ticket', 's3-storage', '--title', 'One');
  body(proj, `${LOCAL}/s3-storage/tickets/T1-one.md`, TICKET_BODY('T1'));
  const after = git(work, 'rev-parse', '--short', 'HEAD');
  write(proj, 'src/app.js', 'changed\n');
  git(work, 'commit', '-q', '-a', '-m', 'change');
  assert.deepEqual(run(proj, 'stale', 's3-storage'), [`stale: 1 of 1 named files changed since ${after}: src/app.js`]);
});

gitTest('stale: a named folder counts by every file in it, committed or not', () => {
  const { work } = setup({ remote: false });
  write(work, 'src/lib/a.js', 'a\n');
  write(work, 'src/lib/b.js', 'b\n');
  write(work, 'src/library.js', 'not in the folder\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'lib');
  run(work, 'new', 's3-storage');
  run(work, 'ticket', 's3-storage', '--title', 'One');
  body(work, `${LOCAL}/s3-storage/tickets/T1-one.md`, TICKET_BODY('T1', '`src/lib/`'));
  const after = git(work, 'rev-parse', '--short', 'HEAD');
  write(work, 'src/library.js', 'changed\n');
  git(work, 'commit', '-q', '-a', '-m', 'library');
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: none of 1 named files changed since ${after}`], 'src/library.js is not in src/lib/');
  write(work, 'src/lib/a.js', 'changed\n');
  git(work, 'commit', '-q', '-a', '-m', 'a');
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: 1 of 1 named files changed since ${after}: src/lib`]);
  git(work, 'reset', '-q', '--hard', after);
  write(work, 'src/lib/b.js', 'uncommitted\n');
  assert.deepEqual(run(work, 'stale', 's3-storage'), [`stale: 1 of 1 named files changed since ${after}: src/lib`]);
});

// --- report ---

const FINDING = (id, place, o = {}) => ({ id, place, check: 'testable-criteria', severity: 'important', what: `What of ${id}`, problem: 'p', fix: 'f', evidence: 'e', ...o });
const CHECK = (place, check = 'one-goal') => ({ place, check, answer: 'yes' });

test('report: a valid reply lists its findings; each rule the schema cannot hold fails the report, never "no findings"', () => {
  const dir = tempDir('keel-report-');
  const put = (name, json) => { const rel = `.keel/local/tmp/planning/s1/${name}`; write(dir, rel, typeof json === 'string' ? json : `Done.\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n`); return rel; };
  const ticket = { agent: 'ticket-reviewer', status: 'complete', checks: [CHECK('T1'), CHECK('T2')], findings: [FINDING('ticket-reviewer-1', 'T1'), FINDING('ticket-reviewer-2', 'T2', { severity: 'minor', check: 'size' })] };
  assert.deepEqual(run(dir, 'report', put('ticket-reviewer-a1.md', ticket)), [
    'report: ok · ticket-reviewer · complete · findings 2',
    '- ticket-reviewer-1 T1 important testable-criteria: What of ticket-reviewer-1',
    '- ticket-reviewer-2 T2 minor size: What of ticket-reviewer-2',
  ]);
  // A reopened exported feature: its tickets are named by their keys.
  const exported = { ...ticket, checks: [CHECK('KEEL-4')], findings: [FINDING('ticket-reviewer-1', 'KEEL-4')] };
  assert.deepEqual(run(dir, 'report', put('ticket-reviewer-a5.md', exported)).slice(0, 2), [
    'report: ok · ticket-reviewer · complete · findings 1',
    '- ticket-reviewer-1 KEEL-4 important testable-criteria: What of ticket-reviewer-1',
  ]);
  // The path the skill passes: absolute, inside the planning folder.
  assert.equal(run(dir, 'report', path.join(dir, put('ticket-reviewer-a2.md', ticket)))[0], 'report: ok · ticket-reviewer · complete · findings 2');
  const plan = { agent: 'plan-reviewer', status: 'incomplete', note: 'premortem not done', checks: [CHECK('plan', 'coverage')], findings: [FINDING('plan-reviewer-1', 'Decisions')] };
  assert.deepEqual(run(dir, 'report', put('plan-reviewer-a3.md', plan)), ['report: ok · plan-reviewer · incomplete · findings 1', 'note: premortem not done', '- plan-reviewer-1 Decisions important testable-criteria: What of plan-reviewer-1']);
  assert.equal(run(dir, 'report', put('plan-reviewer-a4.md', { ...plan, status: 'complete', note: undefined, findings: [] }))[0], 'report: ok · plan-reviewer · complete · findings 0');

  const fails = (json, reason) => {
    const out = run(dir, 'report', put('x.md', json));
    assert.equal(out[0], 'report: failed', JSON.stringify(json));
    assert.ok(out.slice(1).some((l) => reason.test(l)), `${reason}\n${out.join('\n')}`);
  };
  fails({ ...plan, findings: Array.from({ length: 11 }, (_, i) => FINDING(`plan-reviewer-${i + 1}`, 'plan')) }, /^- plan-reviewer has 11 findings; at most 10$/);
  fails({ ...plan, checks: [CHECK('T1', 'coverage')] }, /^- checks\[0\] \(coverage\) is about T1; plan-reviewer answers its checks for the plan$/);
  fails({ ...ticket, findings: Array.from({ length: 6 }, (_, i) => FINDING(`ticket-reviewer-${i + 1}`, 'T1')) }, /^- T1 has 6 findings; at most 5 per ticket$/);
  fails({ ...ticket, findings: Array.from({ length: 6 }, (_, i) => FINDING(`ticket-reviewer-${i + 1}`, 'KEEL-4')) }, /^- KEEL-4 has 6 findings; at most 5 per ticket$/);
  fails({ ...ticket, checks: [CHECK('plan')] }, /^- checks\[0\] \(one-goal\) is about plan; ticket-reviewer speaks only of tickets/);
  fails({ ...ticket, findings: [FINDING('ticket-reviewer-1', 'Decisions')] }, /^- finding ticket-reviewer-1 is about Decisions; ticket-reviewer speaks only of tickets/);
  fails({ ...ticket, findings: [FINDING('plan-reviewer-1', 'T1')] }, /^- finding plan-reviewer-1 does not start with ticket-reviewer$/);
  fails({ ...plan, note: undefined }, /^- status incomplete without a note of what is left$/);
  fails({ ...ticket, findings: [{ ...FINDING('ticket-reviewer-1', 'T1'), evidence: undefined }] }, /missing "evidence"/);
  fails('I reviewed everything and found nothing.', /^- no JSON object in the reply$/);
  assert.deepEqual(run(dir, 'report', '.keel/local/tmp/planning/s1/gone.md'), ['report: failed', '- the file cannot be read']);
  for (const outside of ['.keel/local/tmp/agents/reviewer-a1.md', path.join(dir, 'src', 'x.md'), '.keel/local/tmp/planning', '../x.md']) {
    assert.deepEqual(run(dir, 'report', outside), ['plans: report refused (only a file under .keel/local/tmp/planning/)'], outside);
  }
  assert.deepEqual(run(dir, 'report'), ['plans: report refused (only a file under .keel/local/tmp/planning/)']);
});

// --- keys ---

gitTest('keys: the highest of the prefix in commit messages, ticket file names on other branches, branch names, the working tree and this machine\'s feature folders; exact keys', () => {
  const { work } = setup({ remote: false });
  const s = require(path.join(SCRIPTS, 'lib', 'plans-settings.js')).settings(work);
  const top = () => highestKey(work, 'PROJ', s, true);
  assert.equal(top(), 0);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'PROJ-7: fix the upload\n\nAlso XPROJ-900, PROJECT-950, PRO-500 and proj-8.');
  assert.equal(top(), 8, 'messages count, in any case; XPROJ-900, PROJECT-950 and PRO-500 are other prefixes');
  git(work, 'checkout', '-q', '-b', 'other');
  write(work, 'docs/old/PROJ-12-something.md', 'x\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'docs');
  git(work, 'checkout', '-q', 'main');
  assert.equal(top(), 12, 'a ticket file name on another branch');
  git(work, 'branch', 'proj-15-thing');
  assert.equal(top(), 15, 'a branch name');
  write(work, 'tickets/a-feature/PROJ-20-y.md', 'x\n');
  assert.equal(top(), 20, 'an untracked file in the ticket folder');
  write(work, `${LOCAL}/b-feature/tickets/PROJ-25-z.md`, 'x\n');
  assert.equal(top(), 25, 'a feature folder on this machine');
  write(work, `${LOCAL}/b-feature.export-tmp/tickets/PROJ-99-z.md`, 'x\n');
  assert.equal(top(), 25, 'a temporary export folder never counts');
  write(work, 'tickets/c-feature.export-tmp/PROJ-98-z.md', 'x\n');
  assert.equal(top(), 25, 'nor one in the repository\'s ticket folder');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'PROJ-101 done');
  assert.equal(top(), 101);
  assert.equal(highestKey(work, 'PROJ', s, false), 25, 'without git only the files count');
  assert.equal(highestKey(work, 'XPROJ', s, true), 900);
  const notes = [];
  assert.equal(highestKey(work, 'PROJ', s, true, notes), 101);
  assert.deepEqual(notes, [], 'every git source was read');
  // A source git cannot read is said, never skipped in silence; export shows it.
  write(work, '.git/refs/heads/broken', `${'0123456789'.repeat(4)}\n`);
  assert.equal(highestKey(work, 'PROJ', s, true, notes), 25);
  assert.deepEqual(notes, ['keys: may be incomplete (git could not read the commit messages, ticket file names); check that the new keys are free']);
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  ready(work, 's3-storage', 1);
  assert.ok(run(work, 'export', 's3-storage').includes(notes[0]));
});

// --- export ---

gitTest('export on this machine: keys after the highest, tickets and README in the feature folder, T-numbers replaced exactly, the draft in keel\'s trash', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  run(work, 'set', 's3-storage', '--branch', 'feat/s3');
  run(work, 'state', 's3-storage', 'ready');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'PROJ-100: earlier work');
  const notSetUp = ['plans: export refused (planning is not set up in .keel/config.json: /keel:configure planning)'];
  assert.deepEqual(run(work, 'export', 's3-storage'), notSetUp);
  // Without a prefix the config is invalid, so nothing of the section counts, and the refusal says why.
  planning(work, { tickets: 'pc' });
  assert.deepEqual(run(work, 'export', 's3-storage'), ['plans: export refused (.keel/config.json is invalid ($.planning: missing "ticket_prefix"), so its planning section is not used: /keel:configure)']);
  planning(work, { ticket_prefix: 'PROJ' });
  const folder = `${LOCAL}/s3-storage/tickets`;
  const code = /^page: ([0-9a-f]{8})$/m.exec(readRel(work, `${LOCAL}/s3-storage/plan.md`))[1];
  const out = run(work, 'export', 's3-storage');
  assert.deepEqual(out, [
    `exported: ${folder}/ (2 tickets)`,
    `- T1 -> PROJ-101: ${folder}/PROJ-101-ticket-1.md`,
    `- T2 -> PROJ-102: ${folder}/PROJ-102-ticket-2.md`,
    `readme: ${folder}/README.md`,
    line(out, 'draft: '),
    'fetch: no remote, skipped; keys from this clone only',
    'note: these tickets are seen on this machine only',
  ]);
  assert.match(line(out, 'draft: '), /^draft: moved to keel's trash: batch \d{8}-\d{6}/);
  const t2 = readRel(work, `${folder}/PROJ-102-ticket-2.md`);
  assert.ok(t2.startsWith(`---\ntype: ticket\nkey: PROJ-102\nstatus: todo\nfeature: s3-storage\npage: ${code}\nbranch: feat/s3\nmerge_into: main\ndepends_on: [PROJ-101]\n---\n\n# [PROJ-102] Title of PROJ-102\n`), t2);
  assert.match(t2, /^Do one thing after PROJ-101; not T10, T20 or xT1\.$/m, 'only the draft\'s T-numbers, whole words');
  assert.doesNotMatch(t2, /review_hash|^id:/m);
  const readme = readRel(work, `${folder}/README.md`);
  // The plan's sections with text, in the overview's order, T-numbers swapped for keys; Tickets: key,
  // title and the repository (no remote: the project folder's name), no states. Design sketch, What
  // was gathered and Next action stay in the plan.
  assert.equal(readme, [
    '---', 'type: feature', '---', '',
    '# S3 storage', '',
    '## In plain words', 'Upload and download files on S3; PROJ-101 comes first.', '',
    '## Level', 'Tickets for one repository.', '',
    '## Decisions', 'D1. Use the SDK (PROJ-102 builds on PROJ-101).', '',
    '## Contract', 'PUT /files/{name} stores a file.', '',
    '## Out of scope', 'Deleting files.', '',
    '## Terms', 'Bucket: the S3 folder of the project.', '',
    '## Tickets', '- PROJ-101 Title of PROJ-101 (work)', '- PROJ-102 Title of PROJ-102 (work)', '',
  ].join('\n'));
  // The draft left the folder for keel's trash, marked exported; the folder holds only the tickets.
  assert.deepEqual(fs.readdirSync(path.join(work, LOCAL, 's3-storage')), ['tickets']);
  const batch = trashed(work)[0];
  assert.match(readRel(work, `.keel/local/trash/${batch}/files/${LOCAL}/s3-storage/plan.md`), /^status: exported$/m);
  assert.match(readRel(work, `.keel/local/trash/${batch}/files/${LOCAL}/s3-storage/plan.md`), /^export: pc$/m);
  // Nothing of it goes into git.
  git(work, 'checkout', '-q', '-b', 's3');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (the tickets of s3-storage are on this machine (tickets pc): none of it goes into git)']);
  assert.match(run(work, 'push', 's3-storage')[0], /^plans: push refused \(the tickets of s3-storage are on this machine/);
  // The next feature's keys follow these on this machine.
  ready(work, 'csv-export', 1);
  const one = run(work, 'export', 'csv-export');
  assert.equal(one[1], `- T1 -> PROJ-103: ${LOCAL}/csv-export/tickets/PROJ-103-ticket-1.md`);
  assert.equal(one[2], 'readme: none (1 ticket)');
  assert.ok(!exists(work, `${LOCAL}/csv-export/tickets/README.md`));
});

gitTest('export refusals: not ready, a check problem, a repository draft to this machine, a taken target; the prefix is the planning one, not comments.ticket_prefixes', () => {
  const { work } = setup({ remote: false, config: { comments: { level: 'short', ticket_prefixes: ['X', 'SHOP'] } } });
  planning(work, { tickets: 'pc', ticket_prefix: 'INV' });
  run(work, 'new', 'draft-only');
  assert.match(run(work, 'export', 'draft-only')[0], /refused \(the plan is draft; only a ready plan is exported/);
  ready(work, 's3-storage', 1);
  fs.rmSync(path.join(work, 'src', 'app.js'));
  assert.match(run(work, 'export', 's3-storage')[0], /refused \(check finds 1 problems \(plans\.js check s3-storage\)\)/);
  write(work, 'src/app.js', 'module.exports = 1;\n');
  assert.equal(run(work, 'export', 's3-storage')[1], `- T1 -> INV-1: ${LOCAL}/s3-storage/tickets/INV-1-ticket-1.md`);

  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 'csv-export', 1, 'tickets/csv-export');
  assert.match(run(work, 'export', 'csv-export')[0], /refused \(the draft is in the repository, so its tickets go there too, but planning\.tickets in \.keel\/config\.json is pc: plans\.js settings set --draft pc for this machine, or \/keel:configure planning for the team\)/);
  // A committed tickets_dir keel does not use: refused, nothing written.
  const { exportDir } = require(path.join(SCRIPTS, 'lib', 'plans-settings.js'));
  for (const d of ['../out', '.hidden', 'handoffs', 'docs/plans/x', 'docs//plans', 'docs\\plans']) {
    planning(work, { tickets: 'repo', tickets_dir: d });
    assert.equal(exportDir(work), null, d);
    assert.deepEqual(run(work, 'export', 'csv-export'), ['plans: export refused (planning.tickets_dir in .keel/config.json is not a folder keel uses: /keel:configure planning)'], d);
  }
  assert.ok(!exists(work, '../out') && !exists(work, '.hidden') && !exists(work, 'docs'));
  planning(work, { tickets: 'repo', tickets_dir: 'features' });
  write(work, 'features/csv-export/keep.md', 'x\n');
  assert.match(run(work, 'export', 'csv-export')[0], /refused \(features\/csv-export\/ exists and is not this draft's folder/);
  assert.match(readRel(work, 'tickets/csv-export/plan.md'), /^status: ready$/m);
});

gitTest('export is all or nothing on this machine: an interrupted run leaves no feature folder and a ready plan; the next run takes the same keys', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  ready(work, 's3-storage');
  const plan = `${LOCAL}/s3-storage/plan.md`;
  for (const step of ['written', 'moved']) {
    const out = exportFeature(work, 's3-storage', { stop: (at) => { if (at === step) throw new Error(`interrupted at ${at}`); } });
    assert.deepEqual(out, [`plans: export refused (interrupted at ${step}; nothing exported, the plan stays ready)`]);
    assert.ok(!exists(work, `${LOCAL}/s3-storage.export-tmp`), step);
    assert.ok(!exists(work, `${LOCAL}/s3-storage/tickets/PROJ-1-ticket-1.md`), step);
    assert.match(readRel(work, plan), /^status: ready$/m, step);
    assert.ok(exists(work, `${LOCAL}/s3-storage/tickets/T1-ticket-1.md`), `${step}: the draft is back`);
    assert.match(line(run(work, 'list'), '- s3-storage'), /^- s3-storage: ready · /, step);
  }
  assert.equal(trashed(work).length, 0, 'the draft came back out of keel\'s trash');
  // What a killed run left: a temporary folder with a high key in it. It is removed and never counted.
  write(work, `${LOCAL}/s3-storage.export-tmp/tickets/PROJ-50-old.md`, '---\ntype: ticket\nkey: PROJ-50\n---\n');
  const out = run(work, 'export', 's3-storage');
  assert.equal(out[1], `- T1 -> PROJ-1: ${LOCAL}/s3-storage/tickets/PROJ-1-ticket-1.md`);
  assert.equal(out[2], `- T2 -> PROJ-2: ${LOCAL}/s3-storage/tickets/PROJ-2-ticket-2.md`);
  assert.deepEqual(fs.readdirSync(path.join(work, LOCAL, 's3-storage', 'tickets')).sort(), ['PROJ-1-ticket-1.md', 'PROJ-2-ticket-2.md', 'README.md']);
  assert.ok(!exists(work, `${LOCAL}/s3-storage.export-tmp`));
});

gitTest('the overview names the repository by the last part of its remote URL, the same on every machine', () => {
  const { work } = setup();
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  ready(work, 's3-storage');
  run(work, 'export', 's3-storage');
  const readme = readRel(work, `${LOCAL}/s3-storage/tickets/README.md`);
  assert.match(readme, /^## Tickets\n- PROJ-1 Title of PROJ-1 \(server\)\n- PROJ-2 Title of PROJ-2 \(server\)\n$/m, readme);
  for (const [url, name] of [['git@github.com:team/web.git', 'web'], ['https://user:token@github.com/team/web-app/', 'web-app'], ['C:\\repos\\api.git', 'api'], ['ssh://host/srv/mobile', 'mobile']]) {
    git(work, 'remote', 'set-url', 'origin', url);
    assert.equal(repoName(work), name, url);
  }
});

gitTest('export into the repository: the draft\'s own folder gets the new files (an earlier run\'s are removed first); a draft on this machine goes through a temporary folder', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  // A failed run's ticket and overview in the draft's folder.
  write(work, 'tickets/s3-storage/PROJ-40-ticket-1.md', '---\ntype: ticket\nkey: PROJ-40\nfeature: s3-storage\n---\n');
  write(work, 'tickets/s3-storage/README.md', '---\ntype: feature\n---\n# old\n');
  const cut = exportFeature(work, 's3-storage', { stop: (at) => { if (at === 'written') throw new Error('interrupted'); } });
  assert.match(cut[0], /refused \(interrupted; nothing exported, the plan stays ready\)/);
  assert.deepEqual(fs.readdirSync(path.join(work, 'tickets', 's3-storage')).sort(), ['plan.md', 'tickets'], 'the leftovers and this run\'s files are gone');
  assert.match(readRel(work, 'tickets/s3-storage/plan.md'), /^status: ready$/m);
  const out = run(work, 'export', 's3-storage');
  assert.deepEqual(out.slice(0, 4), ['exported: tickets/s3-storage/ (2 tickets)', '- T1 -> PROJ-1: tickets/s3-storage/PROJ-1-ticket-1.md', '- T2 -> PROJ-2: tickets/s3-storage/PROJ-2-ticket-2.md', 'readme: tickets/s3-storage/README.md']);
  assert.equal(out[4], 'draft: plan.md, reviews/ and T-files leave with the commit (plans.js commit s3-storage)');
  assert.ok(!out.some((l) => l.startsWith('note:')));
  assert.match(readRel(work, 'tickets/s3-storage/plan.md'), /^status: exported$/m);
  assert.match(readRel(work, 'tickets/s3-storage/plan.md'), /^export: repo$/m);
  assert.ok(exists(work, 'tickets/s3-storage/tickets/T1-ticket-1.md'), 'the draft stays until the commit');

  // A draft on this machine exported into the repository: temporary folder, one rename, the draft to the trash.
  planning(work, { tickets_dir: 'features' });
  run(work, 'settings', 'set', '--draft', 'pc');
  ready(work, 'csv-export', 1);
  const moved = exportFeature(work, 'csv-export', { stop: (at) => { if (at === 'moved') throw new Error('interrupted'); } });
  assert.match(moved[0], /refused \(interrupted; nothing exported/);
  assert.ok(!exists(work, 'features/csv-export') && !exists(work, 'features/csv-export.export-tmp'));
  const pc = run(work, 'export', 'csv-export');
  assert.equal(pc[0], 'exported: features/csv-export/ (1 tickets)');
  assert.equal(pc[1], '- T1 -> PROJ-3: features/csv-export/PROJ-3-ticket-1.md');
  assert.match(pc[3], /^draft: moved to keel's trash: batch /);
  assert.ok(!exists(work, `${LOCAL}/csv-export`));
  assert.deepEqual(fs.readdirSync(path.join(work, 'features')), ['csv-export']);
});

gitTest('the researcher\'s reports go with the tickets into research/ beside them, on this machine and in the repository; anything else in research/ stops the export; a draft in another repository folder leaves its copy at the commit', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  const report = '# Push library\r\n\r\n## Question\nWhich one?\n';
  ready(work, 's3-storage');
  write(work, `${LOCAL}/s3-storage/research/push-library.md`, report);
  // A file that is not a report, or a folder, would leave with the draft without a copy.
  for (const other of ['notes.txt', 'old/a.md']) {
    write(work, `${LOCAL}/s3-storage/research/${other}`, 'x');
    const name = other.split('/')[0];
    assert.deepEqual(run(work, 'export', 's3-storage'), [`plans: export refused (research/${name} is not a report: research/ holds only .md files; move it out; nothing exported, the plan stays ready)`]);
    fs.rmSync(path.join(work, LOCAL, 's3-storage', 'research', name), { recursive: true });
  }
  assert.ok(!exists(work, `${LOCAL}/s3-storage/tickets/PROJ-1-ticket-1.md`) && !exists(work, `${LOCAL}/s3-storage.export-tmp`));
  // Interrupted: nothing of it is left beside the draft.
  exportFeature(work, 's3-storage', { stop: (at) => { if (at === 'written') throw new Error('interrupted'); } });
  assert.ok(!exists(work, `${LOCAL}/s3-storage.export-tmp`));
  const out = run(work, 'export', 's3-storage');
  assert.equal(line(out, 'research: '), `research: ${LOCAL}/s3-storage/tickets/research/ (1 reports)`);
  assert.equal(readRel(work, `${LOCAL}/s3-storage/tickets/research/push-library.md`), report, 'copied as it is');
  assert.deepEqual(fs.readdirSync(path.join(work, LOCAL, 's3-storage')), ['tickets'], 'the draft\'s own copy went to the trash with it');

  // A draft in the repository whose folder is the feature folder keeps its reports where they are.
  planning(work, { tickets: 'repo' });
  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 'csv-export', 1, 'tickets/csv-export');
  write(work, 'tickets/csv-export/research/csv-format.md', report);
  assert.equal(line(run(work, 'export', 'csv-export'), 'research: '), 'research: tickets/csv-export/research/ (1 reports)');
  git(work, 'checkout', '-q', '-b', 'csv-export');
  run(work, 'commit', 'csv-export');
  assert.match(git(work, 'show', '--name-status', '--format=', 'HEAD'), /^A\ttickets\/csv-export\/research\/csv-format\.md$/m);

  // A draft in another repository folder: copied at export, the draft's copy leaves with the commit.
  run(work, 'settings', 'set', '--draft', 'repo', '--draft-dir', 'plans');
  ready(work, 'pdf-export', 1, 'plans/pdf-export');
  write(work, 'plans/pdf-export/research/pdf-library.md', report);
  run(work, 'commit', 'pdf-export');
  const pdf = run(work, 'export', 'pdf-export');
  assert.equal(line(pdf, 'research: '), 'research: tickets/pdf-export/research/ (1 reports)');
  assert.equal(line(pdf, 'draft: '), 'draft: plan.md, reviews/, research/ and T-files leave with the commit (plans.js commit pdf-export)');
  assert.equal(readRel(work, 'tickets/pdf-export/research/pdf-library.md'), report);
  run(work, 'commit', 'pdf-export');
  const files = git(work, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').split('\n');
  assert.ok(files.includes('A\ttickets/pdf-export/research/pdf-library.md'), files.join('\n'));
  assert.ok(files.includes('D\tplans/pdf-export/research/pdf-library.md'), files.join('\n'));
  assert.ok(!exists(work, 'plans/pdf-export'));
});

gitTest('export into the draft\'s own folder never replaces a README of the user\'s own', () => {
  const { work } = setup({ remote: false });
  planning(work, { tickets: 'repo', ticket_prefix: 'PROJ' });
  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 's3-storage', 2, 'tickets/s3-storage');
  write(work, 'tickets/s3-storage/README.md', '# My notes\n');
  assert.deepEqual(run(work, 'export', 's3-storage'), ['plans: export refused (tickets/s3-storage/README.md is not keel\'s overview: move it away, then export again)']);
  assert.equal(readRel(work, 'tickets/s3-storage/README.md'), '# My notes\n');
  assert.match(readRel(work, 'tickets/s3-storage/plan.md'), /^status: ready$/m);
  assert.ok(!exists(work, 'tickets/s3-storage/PROJ-1-ticket-1.md'));
  // One ticket writes no overview: the user's README stays and the export goes on.
  planning(work, { tickets_dir: 'plans' });
  run(work, 'settings', 'set', '--draft', 'repo', '--draft-dir', 'plans');
  ready(work, 'csv-export', 1, 'plans/csv-export');
  write(work, 'plans/csv-export/README.md', '# Mine\n');
  assert.equal(run(work, 'export', 'csv-export')[2], 'readme: none (1 ticket)');
  assert.equal(readRel(work, 'plans/csv-export/README.md'), '# Mine\n');
});

gitTest('fetched: a remote that takes the connection and never answers is a failed fetch at the time limit, not a hang', async () => {
  const net = require('node:net');
  const { spawn } = require('node:child_process');
  const held = [];
  const server = net.createServer((s) => { held.push(s); s.on('error', () => {}); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const work = tempDir('keel-fetch-');
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'remote', 'add', 'origin', `http://127.0.0.1:${server.address().port}/team/api.git`);
  const code = `process.stdout.write(JSON.stringify(require(${JSON.stringify(path.join(SCRIPTS, 'lib', 'plans-export.js'))}).fetched(process.argv[1], { timeoutMs: 1000 })))`;
  const child = spawn(process.execPath, ['-e', code, work]);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  // The test's own limit: without one, a hung fetch would hang the test run too.
  const ended = await new Promise((done) => {
    const timer = setTimeout(() => { child.kill(); done(false); }, 20000);
    child.on('exit', () => { clearTimeout(timer); done(true); });
  });
  for (const s of held) s.destroy();
  server.close();
  assert.ok(ended, 'the fetch ended at its limit');
  const r = JSON.parse(out);
  assert.equal(r.failed, true);
  assert.deepEqual(r.notes, ['fetch: origin failed (no answer in 1 s); keys from what this clone knows']);
});
