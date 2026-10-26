'use strict';
// Planning drafts: plans.js (lib/plans.js) on throwaway projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const plans = require(path.join(SCRIPTS, 'lib', 'plans.js'));
const { planningFiles } = require(path.join(SCRIPTS, 'lib', 'planning.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = {
  schema_version: 1,
  repo_language: 'uk',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

const LOCAL = '.keel/local/plans/keel';
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, prefix) => out.find((l) => l.startsWith(prefix)) || '';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-plans-'));
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  return dir;
}

const PLAN_BODY = (summary, questions = '') => `# f

## Summary
${summary}

## Problem / Goal
Files go to S3.

## Decisions
D1. Use the SDK.

## Out of scope

## Design sketch

## Terms

## Open questions
${questions}

## Tickets
T1 client

## Next action
Write T2.
`;

const TICKET_BODY = (id, o = {}) => `# [${id}] Title

## Goal
Do one thing.

## Why
D1.

## Acceptance criteria
${o.criteria ?? '- Given a file, when uploaded, then it is in the bucket'}

## Where to look
${o.where ?? '`src/app.js:1`'}

## Out of scope

## Dependencies

## How to check
\`npm test\`
`;

// Replaces the body of a file made by plans.js, keeping its front matter.
const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));
const front = (dir, rel, key, value) => write(dir, rel, readRel(dir, rel).replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));

// A draft that passes the check: plan.md and `n` tickets filled in.
function filled(dir, feature, n = 2, summary = 'Upload and download files on S3.') {
  run(dir, 'new', feature);
  body(dir, `${LOCAL}/${feature}/plan.md`, PLAN_BODY(summary));
  for (let i = 1; i <= n; i++) {
    run(dir, 'ticket', feature, '--title', `Ticket ${i}`, ...(i > 1 ? ['--depends', `T${i - 1}`] : []));
    body(dir, `${LOCAL}/${feature}/tickets/T${i}-ticket-${i}.md`, TICKET_BODY(`T${i}`));
  }
}

test('feature names: 2-4 English words, starting with a letter, no digit after a hyphen', () => {
  for (const ok of ['s3-connection', 'add-csv-export', 'a1-b2-c3-d4']) assert.ok(plans.validFeature(ok), ok);
  for (const bad of ['upload', 'add-2fa', 'one-two-three-four-five', 'S3-connection', '3d-viewer', 'a-b_c', 'x'.repeat(30) + '-' + 'y'.repeat(10), '-s3-x', 's3-x-']) {
    assert.ok(!plans.validFeature(bad), bad);
  }
  const dir = project();
  assert.match(run(dir, 'new', 'add-2fa')[0], /^plans: new refused \(invalid feature name "add-2fa"/);
  assert.ok(!exists(dir, `${LOCAL}/add-2fa`));
});

test('new: a draft on this machine with plan.md (type plan, status draft), refused for a taken name', () => {
  const dir = project();
  const out = run(dir, 'new', 's3-connection');
  assert.equal(out[0], `created: ${LOCAL}/s3-connection/plan.md`);
  const plan = readRel(dir, `${LOCAL}/s3-connection/plan.md`);
  for (const f of ['type: plan', 'status: draft', 'feature: s3-connection', 'language: uk', 'last_ticket: 0', 'ready_hash: -']) assert.match(plan, new RegExp(`^${f}$`, 'm'), f);
  assert.match(plan, /^# s3-connection$/m);
  assert.doesNotMatch(plan, /<!--/, 'template comments are removed');
  assert.match(run(dir, 'new', 's3-connection')[0], /refused \(a draft "s3-connection" exists \(draft, .*this machine only/);
  // A feature folder in the repository takes the name for a draft on this machine too.
  write(dir, 'tickets/csv-export/PROJ-1-x.md', '---\ntype: ticket\nkey: PROJ-1\n---\n');
  assert.match(run(dir, 'new', 'csv-export')[0], /refused \(tickets\/csv-export\/ exists/);
  assert.ok(!exists(dir, `${LOCAL}/csv-export`));
});

gitTest('new in the repository: draft_dir/<feature>/, which tasks see as planning files; a folder there is taken', () => {
  const dir = project();
  execFileSync('git', ['-C', dir, 'init', '-q']);
  assert.match(run(dir, 'settings', 'set', '--draft', 'repo', '--draft-dir', 'plans/features').join('\n'), /draft: repo/);
  assert.equal(run(dir, 'new', 's3-connection')[0], 'created: plans/features/s3-connection/plan.md');
  run(dir, 'ticket', 's3-connection', '--title', 'Client');
  const isPlanning = planningFiles(dir);
  assert.equal(isPlanning('plans/features/s3-connection/tickets/T1-client.md').kind, 'draft');
  assert.equal(isPlanning('src/app.js'), null);
  // An exported feature folder (no draft plan.md) still takes the name.
  write(dir, 'plans/features/csv-export/PROJ-1-x.md', '---\ntype: ticket\nkey: PROJ-1\n---\n');
  assert.match(run(dir, 'new', 'csv-export')[0], /refused \(plans\/features\/csv-export\/ exists/);
  assert.match(line(run(dir, 'list'), '- s3-connection'), /draft · open Q 0 · tickets 1 · changed \d{4}-\d\d-\d\d · plans\/features\/s3-connection\/$/);
});

test('ticket: T<n>-<slug>.md with id, depends_on and review_hash; numbers are never reused', () => {
  const dir = project();
  run(dir, 'new', 's3-connection');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Add S3 client')[1], 'ticket: T1');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Upload', '--depends', 'T1')[1], 'ticket: T2');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Download')[1], 'ticket: T3');
  const t2 = readRel(dir, `${LOCAL}/s3-connection/tickets/T2-upload.md`);
  for (const f of ['id: T2', 'depends_on: \\[T1\\]', 'review_hash: -']) assert.match(t2, new RegExp(`^${f}$`, 'm'), f);
  assert.match(t2, /^# \[T2\] Upload$/m);
  fs.rmSync(path.join(dir, LOCAL, 's3-connection', 'tickets', 'T3-download.md'));
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Delete')[1], 'ticket: T4', 'deleted T3 keeps its number');
  assert.match(readRel(dir, `${LOCAL}/s3-connection/plan.md`), /^last_ticket: 4$/m);
  // A ticket file made by hand past last_ticket moves the count on too.
  write(dir, `${LOCAL}/s3-connection/tickets/T9-manual.md`, '---\nid: T9\n---\n');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Next')[1], 'ticket: T10');
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'X', '--depends', 'T3')[0], /refused \(--depends: no ticket T3\)/);
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'Завантаження')[0], /refused \(the title has no English words .*--slug/);
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Завантаження', '--slug', 'upload-big')[0], `created: ${LOCAL}/s3-connection/tickets/T11-upload-big.md`);
  assert.match(run(dir, 'ticket', 'no-such-draft', '--title', 'X')[0], /refused \(no draft "no-such-draft"/);
});

test('list: feature, state, open questions, tickets, last change; find by words in names and Summary', () => {
  const dir = project();
  filled(dir, 's3-connection', 2, 'Підключення до сховища S3 для файлів.');
  filled(dir, 'csv-export', 1, 'Export invoices as CSV.');
  body(dir, `${LOCAL}/csv-export/plan.md`, PLAN_BODY('Export invoices as CSV.', '- Q1. Which columns?\n- Q2. Which encoding?'));
  const list = run(dir, 'list');
  assert.equal(list[0], 'drafts: 2');
  assert.match(line(list, '- csv-export'), /^- csv-export: draft · open Q 2 · tickets 1 · changed \d{4}-\d\d-\d\d · \.keel\/local\/plans\/keel\/csv-export\/ \(this machine only\)$/);
  assert.match(line(list, '- s3-connection'), /open Q 0 · tickets 2/);
  const one = run(dir, 'find', 'продовжуємо', 'планувати', 'підключенням', 'до', 'S3');
  assert.equal(one[0], 'find: 1 match');
  assert.match(one[1], /^- s3-connection:/);
  assert.equal(run(dir, 'find', 'продовжуємо', 'підключенням')[0], 'find: 1 match', 'a longer word matches by its first 5 letters');
  assert.match(run(dir, 'find', 'csv', 'export')[1], /^- csv-export:/);
  const several = run(dir, 'find', 'файлів', 'invoices');
  assert.equal(several[0], 'find: 2 matches');
  const none = run(dir, 'find', 'payments');
  assert.equal(none[0], 'find: no match (all drafts: 2)');
  assert.equal(none.length, 3);
});

test('check: a filled draft is clean', () => {
  const dir = project();
  filled(dir, 's3-connection');
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
});

test('check: missing sections, empty criteria, TBD and <...> outside code, missing files, bad dependencies, cycles', () => {
  const dir = project();
  filled(dir, 's3-connection', 3);
  const t = (n) => `${LOCAL}/s3-connection/tickets/T${n}-ticket-${n}.md`;
  write(dir, `${LOCAL}/s3-connection/plan.md`, readRel(dir, `${LOCAL}/s3-connection/plan.md`).replace('## Terms\n', '').replace('Files go to S3.', 'Files go to S3. TBD'));
  body(dir, t(1), TICKET_BODY('T1', { criteria: '', where: '`src/app.js:1`, `src/gone.js:3`, lib/missing.ts:12, `../outside.js`' }));
  body(dir, t(2), TICKET_BODY('T2', { criteria: '- Given <user>, it works\n- `Array<string>` and <https://example.com> are fine' }));
  write(dir, t(3), readRel(dir, t(3)).replace('## Why\nD1.\n', ''));
  front(dir, t(1), 'depends_on', '[T3]');
  front(dir, t(3), 'depends_on', '[T2, T7, T3]');
  const out = run(dir, 'check', 's3-connection');
  const expected = [
    'plan.md: no section "## Terms"',
    'plan.md: placeholder TBD (line',
    'T1: acceptance criteria are empty',
    'T1: src/gone.js in Where to look does not exist',
    'T1: lib/missing.ts in Where to look does not exist',
    'T1: ../outside.js in Where to look is outside the project',
    'T2: placeholder <user> (line',
    'T3: no section "## Why"',
    'T3: depends on T7, which does not exist',
    'T3: depends on itself',
    'dependency cycle: T1 -> T3 -> T2 -> T1',
  ];
  for (const e of expected) assert.ok(out.some((l) => l.startsWith(`- ${e}`)), `${e}\n${out.join('\n')}`);
  assert.equal(out[0], `check: ${expected.length} problems`);
  assert.ok(!out.some((l) => /src\/app\.js|Array|example\.com/.test(l)), out.join('\n'));
});

test('review: never reviewed, unchanged after reviewed, changed after an edit; the hash line itself does not count', () => {
  const dir = project();
  filled(dir, 's3-connection');
  assert.deepEqual(run(dir, 'review', 's3-connection'), ['review: 2 of 2 tickets to review', '- T1: never reviewed', '- T2: never reviewed']);
  assert.deepEqual(run(dir, 'reviewed', 's3-connection', 't1', 'T2'), ['reviewed: 2', '- T1: reviewed', '- T2: reviewed']);
  const t1 = `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`;
  assert.match(readRel(dir, t1), /^review_hash: [0-9a-f]{12}$/m);
  assert.deepEqual(run(dir, 'review', 's3-connection'), ['review: 0 of 2 tickets to review', '- T1: unchanged', '- T2: unchanged']);
  write(dir, t1, readRel(dir, t1).replace('Do one thing.', 'Do one other thing.'));
  assert.equal(run(dir, 'review', 's3-connection')[1], '- T1: changed since review');
  assert.equal(plans.ticketHash('---\nid: T1\nreview_hash: abc\n---\nx\n'), plans.ticketHash('---\nid: T1\nreview_hash: -\n---\nx\n'));
  assert.notEqual(plans.ticketHash('---\nid: T1\n---\nx\n'), plans.ticketHash('---\nid: T1\n---\ny\n'));
  assert.match(run(dir, 'reviewed', 's3-connection', 'T5')[0], /refused \(no ticket T5\)/);
});

test('state: ready only when clean, no open questions and all reviewed; an edit after ready makes it a draft again', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const plan = `${LOCAL}/s3-connection/plan.md`;
  assert.match(run(dir, 'state', 's3-connection', 'ready')[0], /refused \(not ready: not reviewed as they are: T1, T2\)/);
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  body(dir, plan, PLAN_BODY('Upload files.', '- Q1. Which region?'));
  assert.match(run(dir, 'state', 's3-connection', 'ready')[0], /refused \(not ready: 1 open questions\)/);
  body(dir, plan, PLAN_BODY('Upload files.'));
  assert.deepEqual(run(dir, 'state', 's3-connection', 'ready'), ['status: ready']);
  assert.match(readRel(dir, plan), /^ready_hash: [0-9a-f]{12}$/m);
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready · /);
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)'], 'check leaves an unchanged ready plan alone');
  // An edit after ready: the list shows a draft, check writes it.
  body(dir, plan, PLAN_BODY('Upload and list files.'));
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: draft \(changed after ready\) · /);
  assert.equal(run(dir, 'check', 's3-connection').at(-1), 'status: draft (the plan changed after ready)');
  assert.match(readRel(dir, plan), /^status: draft$/m);
  assert.match(readRel(dir, plan), /^ready_hash: -$/m);
  // A new ticket after ready is an edit too.
  run(dir, 'state', 's3-connection', 'ready');
  run(dir, 'ticket', 's3-connection', '--title', 'Later');
  assert.match(readRel(dir, plan), /^status: draft$/m);
});

test('state: the moves between states; exported and abandoned are final', () => {
  const dir = project();
  filled(dir, 's3-connection');
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  assert.match(run(dir, 'state', 's3-connection', 'exported')[0], /refused \(draft -> exported is not a move/);
  assert.match(run(dir, 'state', 's3-connection', 'done')[0], /refused \(unknown state "done"/);
  assert.deepEqual(run(dir, 'state', 's3-connection', 'draft'), ['status: draft (already)']);
  run(dir, 'state', 's3-connection', 'ready');
  assert.deepEqual(run(dir, 'state', 's3-connection', 'draft'), ['status: draft']);
  run(dir, 'state', 's3-connection', 'ready');
  assert.deepEqual(run(dir, 'state', 's3-connection', 'exported'), ['status: exported']);
  assert.match(run(dir, 'state', 's3-connection', 'draft')[0], /refused \(exported -> draft is not a move/);
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'X')[0], /refused \(the plan is exported\)/);
});

test('abandoned: a draft on this machine goes to keel\'s trash and its chat marks go; one in the repository stays', () => {
  const dir = project();
  filled(dir, 's3-connection');
  run(dir, 'mark', 'set', 's3-connection', '--session', 'chat-1');
  const out = run(dir, 'state', 's3-connection', 'abandoned');
  assert.equal(out[0], 'status: abandoned');
  assert.match(out[1], /^moved to keel's trash: batch \d{8}-\d{6}/);
  assert.ok(!exists(dir, `${LOCAL}/s3-connection`));
  const batch = fs.readdirSync(path.join(dir, '.keel', 'local', 'trash'))[0];
  assert.match(fs.readFileSync(path.join(dir, '.keel', 'local', 'trash', batch, 'files', LOCAL, 's3-connection', 'plan.md'), 'utf8'), /^status: abandoned$/m);
  assert.deepEqual(run(dir, 'mark', 'get', '--session', 'chat-1'), ['planning: none']);

  run(dir, 'settings', 'set', '--draft', 'repo');
  run(dir, 'new', 'csv-export');
  const repo = run(dir, 'state', 'csv-export', 'abandoned');
  assert.equal(repo[1], 'tickets/csv-export/ stays: the user removes it, or a commit removes it after the user\'s yes');
  assert.match(readRel(dir, 'tickets/csv-export/plan.md'), /^status: abandoned$/m);
  assert.match(run(dir, 'mark', 'set', 'csv-export', '--session', 'chat-2')[0], /refused \(the plan is abandoned\)/);
});

test('settings: defaults (language from repo_language), saved values, refused values', () => {
  const dir = project();
  assert.deepEqual(run(dir, 'settings').slice(0, 4), ['settings: none yet (the first planning here asks the language and where the draft lives)', 'language: uk (default)', 'draft: pc (default)', 'draft_dir: tickets (default)']);
  const out = run(dir, 'settings', 'set', '--language', 'en', '--draft', 'repo', '--draft-dir', 'docs/tickets/', '--prefix', 'PROJ', '--export', 'repo');
  assert.equal(out[0], `settings: ${LOCAL}/settings.json`);
  for (const l of ['language: en', 'draft: repo', 'draft_dir: docs/tickets', 'export: repo', 'prefix: PROJ', 'export_dir: tickets (default)']) assert.ok(out.includes(l), l);
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/settings.json`)), { language: 'en', draft: 'repo', draft_dir: 'docs/tickets', export: 'repo', prefix: 'PROJ' });
  const bad = {
    '--draft': 'cloud', '--language': 'English', '--prefix': 'proj', '--export': 'jira',
  };
  for (const [k, v] of Object.entries(bad)) assert.match(run(dir, 'settings', 'set', k, v)[0], new RegExp(`^plans: settings set refused \\(${k}: `), `${k} ${v}`);
  for (const d of ['.hidden/t', 'work/handoff', 'handoffs', 'docs/plans/x', '../elsewhere', 'C:/abs']) {
    assert.match(run(dir, 'settings', 'set', '--draft-dir', d)[0], /^plans: settings set refused \(--draft_dir: /, d);
  }
  assert.match(run(dir, 'settings', 'set')[0], /refused \(nothing to set/);
  assert.match(run(dir, 'settings', 'set', '--draft')[0], /refused \(--draft: pc or repo\)/);
  // A broken file: the defaults, said so.
  write(dir, `${LOCAL}/settings.json`, '{oops');
  assert.match(run(dir, 'settings')[0], /\(unreadable: defaults in use\)$/);
  assert.equal(run(dir, 'settings')[2], 'draft: pc (default)');
});

test('mark: set, get and clear this chat\'s planning mark', () => {
  const dir = project();
  run(dir, 'new', 's3-connection');
  assert.deepEqual(run(dir, 'mark', 'get', '--session', 'chat-1'), ['planning: none']);
  assert.deepEqual(run(dir, 'mark', 'set', 's3-connection', '--session', 'chat-1'), ['planning: s3-connection']);
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/sessions/chat-1.json`)), { feature: 's3-connection' });
  assert.deepEqual(run(dir, 'mark', 'get', '--session', 'chat-1'), ['planning: s3-connection']);
  assert.deepEqual(run(dir, 'mark', 'get', '--session', 'chat-2'), ['planning: none']);
  assert.equal(plans.planningMark(dir, 'chat-1'), 's3-connection');
  assert.deepEqual(run(dir, 'mark', 'clear', '--session', 'chat-1'), ['planning: none']);
  assert.ok(!exists(dir, `${LOCAL}/sessions/chat-1.json`));
  assert.match(run(dir, 'mark', 'set', 'csv-export', '--session', 'chat-1')[0], /refused \(no draft "csv-export"/);
  assert.match(run(dir, 'mark', 'set', 's3-connection', '--session', '../x')[0], /refused \(needs --session <id>\)/);
  assert.match(run(dir, 'mark', 'set', 's3-connection')[0], /refused \(needs --session <id>\)/);
  assert.match(run(dir, 'mark', 'drop', '--session', 'chat-1')[0], /refused \(unknown "drop"/);
  assert.equal(plans.planningMark(dir, '../x'), null);
});

// An exported ticket as export writes it.
const EXPORTED = (key, deps = '', status = 'todo') => `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: s3-connection\nbranch: feat/s3\nmerge_into: main\ndepends_on: [${deps}]\n---\n\n${TICKET_BODY(key)}`;

test('an exported feature on this machine: mark set, ticket with the next key and check work in its folder', () => {
  const dir = project();
  const folder = `${LOCAL}/s3-connection/tickets`;
  write(dir, `${folder}/PROJ-1-client.md`, EXPORTED('PROJ-1'));
  write(dir, `${folder}/PROJ-2-upload.md`, EXPORTED('PROJ-2', 'PROJ-1'));
  write(dir, `${folder}/README.md`, '---\ntype: feature\n---\n\n# S3\n');
  write(dir, `${LOCAL}/other-thing/tickets/PROJ-5-x.md`, EXPORTED('PROJ-5'));
  assert.deepEqual(run(dir, 'mark', 'set', 's3-connection', '--session', 'chat-1'), [`planning: s3-connection (exported: ${folder}/)`]);
  assert.equal(plans.planningMark(dir, 'chat-1'), 's3-connection');
  assert.deepEqual(run(dir, 'check', 's3-connection'), [`check: clean (2 tickets in ${folder}/)`]);

  assert.match(run(dir, 'ticket', 's3-connection')[0], /refused \(needs --title\)/);
  assert.deepEqual(run(dir, 'ticket', 's3-connection', '--title', 'X', '--depends', 'PROJ-9,T1'), ['plans: ticket refused (--depends: no ticket PROJ-9, T1)']);
  // The next key after every key here (PROJ-5 of another feature); depends_on are keys, any case.
  assert.deepEqual(run(dir, 'ticket', 's3-connection', '--title', 'Delete files', '--depends', 'proj-2,PROJ-5'), [
    `created: ${folder}/PROJ-6-delete-files.md`, 'ticket: PROJ-6', 'fetch: not a git repository; keys from the files here only',
  ]);
  const t = readRel(dir, `${folder}/PROJ-6-delete-files.md`);
  assert.ok(t.startsWith('---\ntype: ticket\nkey: PROJ-6\nstatus: todo\nfeature: s3-connection\nbranch: feat/s3\nmerge_into: main\ndepends_on: [PROJ-2, PROJ-5]\n---\n\n# [PROJ-6] Delete files\n\n## Goal\n'), t);
  const unfilled = run(dir, 'check', 's3-connection');
  assert.match(unfilled[0], /^check: \d+ problems$/);
  assert.ok(unfilled.some((l) => /^- PROJ-6: placeholder /.test(l)), 'the template\'s placeholders are problems, as in a draft');

  write(dir, `${folder}/PROJ-1-client.md`, EXPORTED('PROJ-1', 'PROJ-2'));
  write(dir, `${folder}/PROJ-2-upload.md`, EXPORTED('PROJ-2', 'PROJ-1', 'started').replace('## Out of scope\n', ''));
  write(dir, `${folder}/PROJ-3-renamed.md`, EXPORTED('PROJ-4'));
  write(dir, `${folder}/PROJ-6-delete-files.md`, EXPORTED('PROJ-6', 'PROJ-6, PROJ-9'));
  assert.deepEqual(run(dir, 'check', 's3-connection'), [
    'check: 6 problems',
    '- PROJ-2: status is "started"; todo or done',
    '- PROJ-2: no section "## Out of scope"',
    '- PROJ-4: the file name PROJ-3-renamed.md does not start with the key',
    '- PROJ-6: depends on itself',
    '- PROJ-6: depends on PROJ-9, which does not exist',
    '- dependency cycle: PROJ-1 -> PROJ-2 -> PROJ-1',
  ]);
  // Not exported, no draft: refused as before.
  assert.match(run(dir, 'mark', 'set', 'csv-export', '--session', 'chat-2')[0], /refused \(no draft "csv-export"/);
  assert.match(run(dir, 'ticket', 'csv-export', '--title', 'X')[0], /refused \(no draft "csv-export"/);
});

test('plans.js: unknown commands are named, never thrown', () => {
  const dir = project();
  assert.match(run(dir, 'import')[0], /^plans: unknown command "import" \(list, find, new, .*set, stale, report, export, commit, push/);
  assert.equal(run(dir)[0], 'drafts: 0');
});
