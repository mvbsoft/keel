'use strict';
// plans.js set, stale, report, export, commit and push on throwaway projects: a bare repository plays
// the server, a second clone plays a colleague. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const { exportFeature, highestKey } = require(path.join(SCRIPTS, 'lib', 'plans-export.js'));
const plans = require(path.join(SCRIPTS, 'lib', 'plans.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (extra = {}) => ({
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
  ...extra,
});

const LOCAL = '.keel/local/plans/keel';
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';
const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));
const front = (dir, rel, key, value) => write(dir, rel, readRel(dir, rel).replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));

const PLAN_BODY = `# S3 storage

## Summary
Upload and download files on S3; T1 comes first.

## Problem / Goal
Files go to S3.

## Decisions
D1. Use the SDK (T2 builds on T1).

## Out of scope

## Design sketch

## Terms

## Open questions

## Tickets
T1 client

## Next action
Export.
`;

const TICKET_BODY = (id, where = '`src/app.js:1`') => `# [${id}] Title of ${id}

## Goal
Do one thing after T1; not T10, T20 or xT1.

## Why
D1.

## Acceptance criteria
- Given a file, when uploaded, then it is in the bucket

## Where to look
${where}

## Out of scope

## Dependencies

## How to check
\`npm test\`
`;

// A project with keel's config, src/app.js, one commit on main and, when asked, a remote with main pushed.
function setup({ remote = true, config = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-export-'));
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG(config)));
  write(work, '.keel/.gitignore', 'local/\n');
  write(work, 'src/app.js', 'module.exports = 1;\n');
  write(work, 'src/other.js', 'module.exports = 2;\n');
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

// A colleague's clone that pushes a branch with one file.
function otherPush(server, tmp, branch, rel, text) {
  const other = path.join(tmp, `other-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'checkout', '-q', '-b', branch);
  write(other, rel, text);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', `add ${rel}`);
  git(other, 'push', '-q', 'origin', branch);
}

// A ready draft with `n` tickets (T2 depends on T1) in the folder plans.js new picks.
function ready(dir, feature, n = 2, folder = `${LOCAL}/${feature}`) {
  run(dir, 'new', feature);
  body(dir, `${folder}/plan.md`, PLAN_BODY);
  for (let i = 1; i <= n; i++) {
    run(dir, 'ticket', feature, '--title', `Ticket ${i}`, ...(i > 1 ? ['--depends', `T${i - 1}`] : []));
    body(dir, `${folder}/tickets/T${i}-ticket-${i}.md`, TICKET_BODY(`T${i}`));
  }
  run(dir, 'reviewed', feature, ...Array.from({ length: n }, (_, i) => `T${i + 1}`));
  assert.deepEqual(run(dir, 'state', feature, 'ready'), ['status: ready']);
}

const trashed = (dir) => { try { return fs.readdirSync(path.join(dir, '.keel', 'local', 'trash')); } catch { return []; } };

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
  assert.match(run(work, 'set', 's3-storage')[0], /refused \(nothing to set: --branch, --merge-into\)/);
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

// --- report ---

const FINDING = (id, place, o = {}) => ({ id, place, check: 'testable-criteria', severity: 'important', what: `What of ${id}`, problem: 'p', fix: 'f', evidence: 'e', ...o });
const CHECK = (place, check = 'one-goal') => ({ place, check, answer: 'yes' });

test('report: a valid reply lists its findings; each rule the schema cannot hold fails the report, never "no findings"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-report-'));
  const put = (name, json) => { const rel = `.keel/local/tmp/planning/s1/${name}`; write(dir, rel, typeof json === 'string' ? json : `Done.\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\`\n`); return rel; };
  const ticket = { agent: 'ticket-reviewer', status: 'complete', checks: [CHECK('T1'), CHECK('T2')], findings: [FINDING('ticket-reviewer-1', 'T1'), FINDING('ticket-reviewer-2', 'T2', { severity: 'minor', check: 'size' })] };
  assert.deepEqual(run(dir, 'report', put('ticket-reviewer-a1.md', ticket)), [
    'report: ok · ticket-reviewer · complete · findings 2',
    '- ticket-reviewer-1 T1 important testable-criteria: What of ticket-reviewer-1',
    '- ticket-reviewer-2 T2 minor size: What of ticket-reviewer-2',
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
  const s = plans.settings(work);
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
  run(work, 'settings', 'set', '--export', 'pc', '--prefix', 'PROJ');
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
  assert.match(run(work, 'export', 's3-storage')[0], /refused \(where the tickets go is not set: plans\.js settings set --export pc\|repo\)/);
  run(work, 'settings', 'set', '--export', 'pc');
  assert.match(run(work, 'export', 's3-storage')[0], /refused \(no ticket prefix: plans\.js settings set --prefix <PROJ>\)/);
  run(work, 'settings', 'set', '--prefix', 'PROJ');
  const folder = `${LOCAL}/s3-storage/tickets`;
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
  assert.ok(t2.startsWith('---\ntype: ticket\nkey: PROJ-102\nstatus: todo\nfeature: s3-storage\nbranch: feat/s3\nmerge_into: main\ndepends_on: [PROJ-101]\n---\n\n# [PROJ-102] Title of PROJ-102\n'), t2);
  assert.match(t2, /^Do one thing after PROJ-101; not T10, T20 or xT1\.$/m, 'only the draft\'s T-numbers, whole words');
  assert.doesNotMatch(t2, /review_hash|^id:/m);
  const readme = readRel(work, `${folder}/README.md`);
  assert.ok(readme.startsWith('---\ntype: feature\n---\n\n# S3 storage\n\n## Summary\nUpload and download files on S3; PROJ-101 comes first.\n'), readme);
  assert.match(readme, /^D1\. Use the SDK \(PROJ-102 builds on PROJ-101\)\.$/m);
  assert.doesNotMatch(readme, /## (Open questions|Tickets|Next action)|status|branch/);
  // The draft left the folder for keel's trash, marked exported; the folder holds only the tickets.
  assert.deepEqual(fs.readdirSync(path.join(work, LOCAL, 's3-storage')), ['tickets']);
  const batch = trashed(work)[0];
  assert.match(readRel(work, `.keel/local/trash/${batch}/files/${LOCAL}/s3-storage/plan.md`), /^status: exported$/m);
  assert.match(readRel(work, `.keel/local/trash/${batch}/files/${LOCAL}/s3-storage/plan.md`), /^export: pc$/m);
  // Nothing of it goes into git.
  git(work, 'checkout', '-q', '-b', 's3');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['plans: commit refused (the tickets of s3-storage are on this machine (export pc): none of it goes into git)']);
  assert.match(run(work, 'push', 's3-storage')[0], /^plans: push refused \(the tickets of s3-storage are on this machine/);
  // The next feature's keys follow these on this machine.
  ready(work, 'csv-export', 1);
  const one = run(work, 'export', 'csv-export');
  assert.equal(one[1], `- T1 -> PROJ-103: ${LOCAL}/csv-export/tickets/PROJ-103-ticket-1.md`);
  assert.equal(one[2], 'readme: none (1 ticket)');
  assert.ok(!exists(work, `${LOCAL}/csv-export/tickets/README.md`));
});

gitTest('export refusals: not ready, a check problem, a repository draft to this machine, a taken target; the prefix from comments.ticket_prefixes', () => {
  const { work } = setup({ remote: false, config: { comments: { level: 'short', ticket_prefixes: ['X', 'SHOP'] } } });
  run(work, 'settings', 'set', '--export', 'pc');
  run(work, 'new', 'draft-only');
  assert.match(run(work, 'export', 'draft-only')[0], /refused \(the plan is draft; only a ready plan is exported/);
  ready(work, 's3-storage', 1);
  fs.rmSync(path.join(work, 'src', 'app.js'));
  assert.match(run(work, 'export', 's3-storage')[0], /refused \(check finds 1 problems \(plans\.js check s3-storage\)\)/);
  write(work, 'src/app.js', 'module.exports = 1;\n');
  assert.equal(run(work, 'export', 's3-storage')[1], `- T1 -> SHOP-1: ${LOCAL}/s3-storage/tickets/SHOP-1-ticket-1.md`, 'the first valid comments.ticket_prefixes');

  run(work, 'settings', 'set', '--draft', 'repo');
  ready(work, 'csv-export', 1, 'tickets/csv-export');
  assert.match(run(work, 'export', 'csv-export')[0], /refused \(the draft is in the repository, so its tickets go there too: plans\.js settings set --export repo\)/);
  run(work, 'settings', 'set', '--export', 'repo', '--export-dir', 'features');
  write(work, 'features/csv-export/keep.md', 'x\n');
  assert.match(run(work, 'export', 'csv-export')[0], /refused \(features\/csv-export\/ exists and is not this draft's folder/);
  assert.match(readRel(work, 'tickets/csv-export/plan.md'), /^status: ready$/m);
});

gitTest('export is all or nothing on this machine: an interrupted run leaves no feature folder and a ready plan; the next run takes the same keys', () => {
  const { work } = setup({ remote: false });
  run(work, 'settings', 'set', '--export', 'pc', '--prefix', 'PROJ');
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

gitTest('export into the repository: the draft\'s own folder gets the new files (an earlier run\'s are removed first); a draft on this machine goes through a temporary folder', () => {
  const { work } = setup({ remote: false });
  run(work, 'settings', 'set', '--export', 'repo', '--prefix', 'PROJ', '--draft', 'repo');
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
  run(work, 'settings', 'set', '--draft', 'pc', '--export-dir', 'features');
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

// --- commit and push ---

gitTest('commit: refused on main, detached, during a merge, without a draft; a draft commits as "Plan"; an export commits its tickets and the draft leaves in the same commit; other staged changes stay out', () => {
  const { work } = setup({ remote: false });
  run(work, 'settings', 'set', '--export', 'repo', '--prefix', 'PROJ', '--draft', 'repo');
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
  assert.match(out[0], /^committed: [0-9a-f]{7,} PROJ-1, PROJ-2: add the s3-storage tickets$/);
  assert.equal(out[1], 'fetch: no remote, skipped; keys from this clone only');
  const files = git(work, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').split('\n').sort();
  assert.deepEqual(files, [
    'A\ttickets/s3-storage/PROJ-1-ticket-1.md', 'A\ttickets/s3-storage/PROJ-2-ticket-2.md', 'A\ttickets/s3-storage/README.md',
    'D\ttickets/s3-storage/plan.md', 'D\ttickets/s3-storage/tickets/T1-ticket-1.md', 'D\ttickets/s3-storage/tickets/T2-ticket-2.md',
  ]);
  assert.equal(git(work, 'diff', '--cached', '--name-only'), 'src/app.js', 'the staged change stays staged, outside the commit');
  assert.equal(git(work, 'log', '-1', '--format=%B'), 'PROJ-1, PROJ-2: add the s3-storage tickets');
  assert.ok(trashed(work).length === 1, 'the draft files are in keel\'s trash');
  assert.deepEqual(run(work, 'commit', 's3-storage'), ['commit: nothing to commit', 'fetch: no remote, skipped; keys from this clone only'], 'an export checks its keys before every commit');
  assert.deepEqual(run(work, 'push', 's3-storage'), ['push: no remote, nothing pushed']);
});

gitTest('commit and push: a key taken on another branch since the export is renumbered (files and references); one already on the remote is refused', () => {
  const { tmp, work, server } = setup();
  run(work, 'settings', 'set', '--export', 'repo', '--prefix', 'PROJ');
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
  const stopped = run(work, 'commit', 's3-storage');
  assert.equal(stopped[0], 'renumbered: PROJ-2 -> PROJ-11');
  assert.match(stopped[1], /^plans: commit refused \(git commit failed \(a project hook\?\)/);
  fs.rmSync(hook);
  const out = run(work, 'commit', 's3-storage');
  assert.match(out[0], /^committed: [0-9a-f]{7,} PROJ-1, PROJ-11: add the s3-storage tickets$/);
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
  assert.deepEqual(run(work, 'push', 's3-storage'), ['plans: push refused (PROJ-1 is also docs/PROJ-1.md on origin/late-work: commit again (plans.js commit s3-storage gives it a new number), then push)']);
});

gitTest('commit: when part of an exported draft cannot go to keel\'s trash, what went comes back and nothing is committed', () => {
  const { tmp, work } = setup({ remote: false });
  run(work, 'settings', 'set', '--export', 'repo', '--prefix', 'PROJ', '--draft', 'repo');
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
  const { work } = setup({ remote: false });
  run(work, 'new', 'local-thing');
  run(work, 'settings', 'set', '--export', 'repo', '--prefix', 'PROJ', '--draft', 'repo', '--draft-dir', 'plans');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  assert.deepEqual(run(work, 'commit', 'local-thing'), ['plans: commit refused (the draft of local-thing is on this machine: none of it goes into git)']);
  ready(work, 's3-storage', 2, 'plans/s3-storage');
  write(work, 'tickets/s3-storage/notes.md', 'mine\n');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} Plan s3-storage$/);
  assert.doesNotMatch(git(work, 'show', '--name-only', '--format=', 'HEAD'), /notes\.md/);
  assert.equal(git(work, 'status', '--porcelain', '--', 'tickets'), '?? tickets/');
  fs.rmSync(path.join(work, 'tickets'), { recursive: true });
  assert.equal(run(work, 'export', 's3-storage')[0], 'exported: tickets/s3-storage/ (2 tickets)');
  assert.match(run(work, 'commit', 's3-storage')[0], /^committed: [0-9a-f]{7,} PROJ-1, PROJ-2: add the s3-storage tickets$/);
  assert.deepEqual(git(work, 'show', '--name-status', '--no-renames', '--format=', 'HEAD').split('\n').sort(), [
    'A\ttickets/s3-storage/PROJ-1-ticket-1.md', 'A\ttickets/s3-storage/PROJ-2-ticket-2.md', 'A\ttickets/s3-storage/README.md',
    'D\tplans/s3-storage/plan.md', 'D\tplans/s3-storage/tickets/T1-ticket-1.md', 'D\tplans/s3-storage/tickets/T2-ticket-2.md',
  ]);
  assert.ok(!exists(work, 'plans/s3-storage'));
  assert.equal(git(work, 'status', '--porcelain'), '');
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

// --- the write guard ---

test('planning-guard: the exported feature folder in the repository is writable for the chat that plans it; other project files stay blocked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-export-guard-'));
  write(dir, '.keel/config.json', '{}');
  run(dir, 'settings', 'set', '--export', 'repo', '--export-dir', 'features');
  run(dir, 'new', 's3-storage');
  run(dir, 'mark', 'set', 's3-storage', '--session', 'chat-plan');
  const guard = (file) => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
    const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'planning-guard.js')], { input: JSON.stringify({ session_id: 'chat-plan', tool_name: 'Write', tool_input: { file_path: path.join(dir, file) }, cwd: dir }), env: { ...clean, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(guard('features/s3-storage/PROJ-1-client.md'), 'allow');
  assert.equal(guard('features/s3-storage/README.md'), 'allow');
  assert.equal(guard('features/payments/PROJ-9-pay.md'), 'deny');
  assert.equal(guard('features/README.md'), 'deny');
  assert.equal(guard('src/app.js'), 'deny');
});
