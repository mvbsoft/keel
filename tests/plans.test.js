'use strict';
// Planning drafts: plans.js (lib/plans.js) on throwaway projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

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
  const dir = tempDir('keel-plans-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  return dir;
}

const PLAN_BODY = (plain, questions = '') => `# f

## In plain words
${plain}

## Level

## Decisions
D1. Use the SDK.

## Contract

## Out of scope

## Design sketch
Files go to S3.

## Terms

## What was gathered

## Open questions
${questions}

## Tickets
T1 client

## Next action
Write T2.
`;

const TICKET_BODY = (id, o = {}) => `# [${id}] Title

## In plain words
A file you upload lands in the bucket, and you can download it again.

## Goal
Do one thing.

## Acceptance criteria
${o.criteria ?? '- [ ] Given a file, when uploaded, then it is in the bucket'}

## How to check
\`npm test\`

## Boundaries
${o.boundaries ?? '- always: keep the old route\n- ask first: a new dependency\n- never: delete a file'}

## Where to look
${o.where ?? '`src/app.js:1`'}

## Out of scope

## Why
D1.

## Dependencies
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
  // The feature's code for its page: random, one per draft.
  assert.match(plan, /^feature: s3-connection\npage: [0-9a-f]{8}$/m);
  run(dir, 'new', 'csv-report');
  assert.notEqual(/^page: (\w+)$/m.exec(readRel(dir, `${LOCAL}/csv-report/plan.md`))[1], /^page: (\w+)$/m.exec(plan)[1]);
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

test('list: feature, state, open questions, tickets, last change; find by words in names and In plain words', () => {
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
  body(dir, t(2), TICKET_BODY('T2', { criteria: '- [ ] Given <user>, it works\n- [ ] `Array<string>` and <https://example.com> are fine' }));
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

test('check: a path of this machine in any file of the feature is a problem: Windows, Linux, macOS, WSL, the project folder', () => {
  const dir = project();
  filled(dir, 's3-connection', 2);
  const planFile = `${LOCAL}/s3-connection/plan.md`;
  const t1 = `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`;
  write(dir, planFile, readRel(dir, planFile).replace('Files go to S3.', 'Files go to S3, as D:/work/api/src/s3.js does.'));
  write(dir, t1, readRel(dir, t1).replace('Do one thing.', [
    'Do one thing, like C:\\Users\\ann\\app\\upload.js does.',
    'Read /home/dev/api/src/s3.js and `/Users/ann/web/app.js`.',
    '```bash\ncd /mnt/c/work/api\n```',
    `See ${path.join(dir, 'src', 'app.js')}.`,
    'Not paths: <https://example.com/home/page>, http://localhost:3000/x, src/home/x.js, ~/.claude/keel, a:b/c.',
  ].join('\n')));
  write(dir, `${LOCAL}/s3-connection/research/r1-s3.md`, '# S3\n\nThe SDK cache sits in /root/.npm/_cacache.\n');
  const out = run(dir, 'check', 's3-connection');
  const expected = [
    'plan.md: local path D:/work/api/src/s3.js (line',
    'T1: local path C:\\Users\\ann\\app\\upload.js (line',
    'T1: local path /home/dev/api/src/s3.js (line',
    'T1: local path /Users/ann/web/app.js (line',
    'T1: local path /mnt/c/work/api (line',
    `T1: local path ${path.join(dir, 'src', 'app.js')} (line`,
    'research/r1-s3.md: local path /root/.npm/_cacache (line 3)',
  ];
  for (const e of expected) assert.ok(out.some((l) => l.startsWith(`- ${e}`)), `${e}\n${out.join('\n')}`);
  assert.equal(out[0], `check: ${expected.length} problems`, out.join('\n'));
});

test('check: an exported feature with a path of this machine in a ticket, its overview or a report', () => {
  const dir = project();
  const folder = `${LOCAL}/s3-connection/tickets`;
  write(dir, `${folder}/PROJ-1-client.md`, EXPORTED('PROJ-1').replace('Do one thing.', 'Do it as /home/dev/api/client.js does.'));
  write(dir, `${folder}/README.md`, '---\ntype: feature\n---\n\n# S3\n\nThe old code: D:\\work\\api\\s3.\n');
  write(dir, `${folder}/research/sdk.md`, '# SDK\n\nSee /Users/ann/notes/sdk.md\n');
  assert.deepEqual(run(dir, 'check', 's3-connection'), [
    'check: 3 problems',
    `- PROJ-1: local path /home/dev/api/client.js (line ${EXPORTED('PROJ-1').split('\n').indexOf('Do one thing.') + 1})`,
    '- README.md: local path D:\\work\\api\\s3 (line 7)',
    '- research/sdk.md: local path /Users/ann/notes/sdk.md (line 3)',
  ]);
});

test('check: the ticket sections in their order, the three Boundaries labels, criteria as a "- [ ]" list; Example and Correct the priors are optional', () => {
  const dir = project();
  filled(dir, 's3-connection', 4);
  const t = (n) => `${LOCAL}/s3-connection/tickets/T${n}-ticket-${n}.md`;
  const plan = `${LOCAL}/s3-connection/plan.md`;
  // Both optional sections in their places: still clean.
  body(dir, t(1), TICKET_BODY('T1').replace('## Goal\n', '## Example\nUpload a.txt -> it is listed.\n\n## Goal\n').replace('## Where to look\n', '## Correct the priors\nThe SDK retries by itself: no retry loop.\n\n## Where to look\n'));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 4 tickets)']);
  // Goal moved below Boundaries; an optional section out of its place counts too.
  body(dir, t(1), TICKET_BODY('T1').replace('## Goal\nDo one thing.\n\n', '').replace('## Where to look\n', '## Goal\nDo one thing.\n\n## Where to look\n'));
  body(dir, t(2), TICKET_BODY('T2', { boundaries: '- always: keep the old route\n- **never**: delete a file\nask first: nothing' }));
  body(dir, t(3), TICKET_BODY('T3', { criteria: '- [ ] Given a file, then it is in the bucket\n  and listed\nThe upload is fast.' }));
  body(dir, t(4), TICKET_BODY('T4').replace('## In plain words\nA file you upload lands in the bucket, and you can download it again.\n\n', ''));
  write(dir, plan, readRel(dir, plan).replace('## What was gathered\n', '').replace('## Level\n', ''));
  assert.deepEqual(run(dir, 'check', 's3-connection'), [
    'check: 6 problems',
    '- plan.md: no section "## Level"',
    '- plan.md: no section "## What was gathered"',
    '- T1: "## Goal" stands after "## Boundaries" (the order: In plain words, Example, Goal, Acceptance criteria, How to check, Boundaries, Correct the priors, Where to look, Out of scope, Why, Dependencies)',
    '- T2: Boundaries has no "- ask first:" item',
    '- T3: acceptance criteria are not a "- [ ]" list: "The upload is fast."',
    '- T4: no section "## In plain words"',
  ]);
  body(dir, t(4), TICKET_BODY('T4').replace('## Out of scope\n', '## Example\nUpload a.txt -> it is listed.\n\n## Out of scope\n'));
  assert.match(run(dir, 'check', 's3-connection').find((l) => l.startsWith('- T4')), /^- T4: "## Example" stands after "## Where to look"/);
});

test('check: headings in a code block are text; a section twice, a missing or empty "# [id] title" heading and indented Boundaries', () => {
  const dir = project();
  filled(dir, 's3-connection', 4);
  const t = (n) => `${LOCAL}/s3-connection/tickets/T${n}-ticket-${n}.md`;
  // Markdown samples in How to check (one holds a ``` block inside ~~~), Boundaries items indented.
  const fenced = '## How to check\n```md\n## Why\nx\n\n## Example\ny\n```\n~~~md\n```js\n## Why\n```\n~~~\n\n';
  body(dir, t(1), TICKET_BODY('T1').replace('## How to check\n`npm test`\n\n', fenced));
  body(dir, t(2), TICKET_BODY('T2', { boundaries: '  - always: keep the old route\n  - ask first: a new dependency\n  - never: delete a file' }));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 4 tickets)']);
  // No heading, an empty title, the id in another case (export would not turn "t4" into its key).
  body(dir, t(1), `${TICKET_BODY('T1').replace('# [T1] Title\n', '')}\n## Why\nD2.\n`);
  body(dir, t(2), `${TICKET_BODY('T2')}\n## Goal\nAnother.\n`);
  body(dir, t(3), TICKET_BODY('T3').replace('# [T3] Title', '# [T3]'));
  body(dir, t(4), TICKET_BODY('T4').replace('# [T4]', '# [t4]'));
  assert.deepEqual(run(dir, 'check', 's3-connection'), [
    'check: 5 problems',
    '- T1: no "# [T1] <title>" heading',
    '- T1: "## Why" appears twice',
    '- T2: "## Goal" appears twice',
    '- T3: no "# [T3] <title>" heading',
    '- T4: no "# [T4] <title>" heading',
  ]);
});

test('check: a mermaid diagram and a table in In plain words pass, and the overview keeps them as they are', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const diagram = 'Three messages in 10 s become one push:\n```mermaid\nsequenceDiagram\n  participant O as Olya\n  participant S as Server\n  O->>S: 3 messages in 10 s\n  S-->>O: one push after 30 s\n```';
  const table = 'Two ways to send:\n\n| Way | Pushes for 3 messages |\n|---|---|\n| one by one | 3 |\n| grouped, T1 | 1 |';
  const plain = `${diagram}\n\n${table}`;
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(plain));
  body(dir, `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`, TICKET_BODY('T1').replace('A file you upload lands in the bucket, and you can download it again.', plain));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
  const { overviewSections } = require(path.join(SCRIPTS, 'lib', 'plans-format.js'));
  const overview = overviewSections(PLAN_BODY(plain), [], (s) => s.replace(/\bT1\b/g, 'PROJ-1'));
  assert.ok(overview.startsWith(`## In plain words\n${diagram}\n\n${table.replace('T1', 'PROJ-1')}\n`), overview);
});

test('check: a comparison with < and > on one line is not a placeholder, a <name> still is', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const table = 'When a push goes out:\n\n| Wait | Messages |\n|---|---|\n| < 30 s | > 1 min |\n| x <= 3 | y > 2 |';
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(table));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(`${table}\n\nSent by <who>.`));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: 1 problems', '- plan.md: placeholder <who> (line 28)']);
});

test('check: an indented code block and "<30 s" are not placeholders, a <name> still is', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const text = 'How it goes:\n\n1. Three messages arrive:\n   ```mermaid\n   sequenceDiagram\n     S-->>O: one push<br>after 30 s\n   ```\n\n| Wait | Messages |\n|---|---|\n| <30 s | >1 min |\n\nPushes wait <30 s, then >1 min.';
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(text));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(`${text}\n\nSent by <who>.\nEnter the <2fa code>.\n<1-2 sentences: what changes>`));
  assert.deepEqual(run(dir, 'check', 's3-connection'), [
    'check: 3 problems',
    '- plan.md: placeholder <who> (line 35)',
    '- plan.md: placeholder <2fa code> (line 36)',
    '- plan.md: placeholder <1-2 sentences: what changes> (line 37)',
  ]);
});

test('check: the unfilled templates show only their placeholders', () => {
  const dir = project();
  run(dir, 'new', 's3-connection');
  run(dir, 'ticket', 's3-connection', '--title', 'Upload');
  const out = run(dir, 'check', 's3-connection');
  assert.match(out[0], /^check: \d+ problems$/);
  for (const l of out.slice(1)) assert.match(l, /^- (plan\.md|T1): placeholder </, out.join('\n'));
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
  // The page's code is no edit of the plan.
  write(dir, plan, readRel(dir, plan).replace(/^page: .*$/m, 'page: 0badc0de'));
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready · /);
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

test('settings: this machine keeps only the draft place and the repos map; the old planning keys are dropped, not carried over', () => {
  const dir = project();
  assert.deepEqual(run(dir, 'settings').slice(0, 4), ['settings: none yet (the first planning here asks where the draft lives)', 'draft: pc (default)', 'draft_dir: tickets (default)', 'repos: -']);
  // A settings file of keel 1.4: its language, export and prefix count nowhere and leave with the next write.
  write(dir, `${LOCAL}/settings.json`, JSON.stringify({ language: 'en', draft: 'pc', export: 'repo', export_dir: 'features', prefix: 'OLD' }));
  const old = run(dir, 'settings');
  for (const l of ['planning: planning is not set up in .keel/config.json: /keel:configure planning', 'ticket_prefix: -', 'tickets: -', 'tickets_dir: tickets (default)', 'language: uk (default)']) assert.ok(old.includes(l), l);
  const out = run(dir, 'settings', 'set', '--draft', 'repo', '--draft-dir', 'docs/tickets/');
  assert.equal(out[0], `settings: ${LOCAL}/settings.json`);
  for (const l of ['draft: repo', 'draft_dir: docs/tickets']) assert.ok(out.includes(l), l);
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/settings.json`)), { draft: 'repo', draft_dir: 'docs/tickets' });
  for (const k of ['--language', '--export', '--export-dir', '--prefix']) assert.match(run(dir, 'settings', 'set', k, 'x')[0], /^plans: settings set refused \(nothing to set: --draft, --draft-dir, --repo\)$/, k);
  assert.match(run(dir, 'settings', 'set', '--draft', 'cloud')[0], /^plans: settings set refused \(--draft: pc or repo\)/);
  for (const d of ['.hidden/t', 'work/handoff', 'handoffs', 'docs/plans/x', '../elsewhere', 'C:/abs']) {
    assert.match(run(dir, 'settings', 'set', '--draft-dir', d)[0], /^plans: settings set refused \(--draft_dir: /, d);
  }
  assert.match(run(dir, 'settings', 'set')[0], /refused \(nothing to set/);
  assert.match(run(dir, 'settings', 'set', '--draft')[0], /refused \(--draft: pc or repo\)/);
  // A broken file: the defaults, said so.
  write(dir, `${LOCAL}/settings.json`, '{oops');
  assert.match(run(dir, 'settings')[0], /\(unreadable: defaults in use\)$/);
  assert.equal(run(dir, 'settings')[1], 'draft: pc (default)');
});

test('settings: the project\'s planning section in .keel/config.json; the ticket language defaults to repo_language', () => {
  const dir = project();
  const config = (planning) => write(dir, '.keel/config.json', JSON.stringify({ ...CONFIG, planning }));
  config({ ticket_prefix: 'API', tickets: 'repo' });
  const out = run(dir, 'settings');
  for (const l of ['planning: .keel/config.json', 'ticket_prefix: API', 'tickets: repo', 'tickets_dir: tickets (default)', 'language: uk (default)']) assert.ok(out.includes(l), l);
  config({ ticket_prefix: 'API', tickets: 'pc', tickets_dir: 'work/tickets', language: 'en' });
  for (const l of ['tickets: pc', 'tickets_dir: work/tickets', 'language: en']) assert.ok(run(dir, 'settings').includes(l), l);
  assert.equal(line(run(dir, 'new', 'csv-export'), 'language: '), 'language: en', 'a new plan takes the ticket language');
  // A section the config check rejects (here without tickets), or a valid one in a config invalid
  // elsewhere, is not used: the line names the config problem, not a missing section.
  config({ ticket_prefix: 'API' });
  assert.match(line(run(dir, 'settings'), 'planning: '), /^planning: \.keel\/config\.json is invalid \(.*tickets.*\), so its planning section is not used: \/keel:configure$/);
  write(dir, '.keel/config.json', JSON.stringify({ ...CONFIG, docs: { profile: 99 }, planning: { ticket_prefix: 'API', tickets: 'pc' } }));
  assert.match(line(run(dir, 'settings'), 'planning: '), /^planning: \.keel\/config\.json is invalid \(.*docs.*\), so its planning section is not used: \/keel:configure$/);
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  assert.equal(line(run(dir, 'settings'), 'planning: '), 'planning: planning is not set up in .keel/config.json: /keel:configure planning');
});

test('settings: the repos map, one --repo <PREFIX>=<absolute folder> per call', () => {
  const dir = project();
  const web = path.join(path.dirname(dir), 'web');
  const mob = path.join(path.dirname(dir), 'mobile') + path.sep;
  const slash = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  assert.ok(run(dir, 'settings', 'set', '--repo', `WEB=${web}`).includes(`repos: WEB=${slash(web)}`));
  run(dir, 'settings', 'set', '--draft', 'repo');
  const out = run(dir, 'settings', 'set', '--repo', `MOB=${mob}`);
  assert.ok(out.includes(`repos: WEB=${slash(web)}, MOB=${slash(mob)}`), out.join('\n'));
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/settings.json`)), { repos: { WEB: slash(web), MOB: slash(mob) }, draft: 'repo' });
  assert.ok(run(dir, 'settings', 'set', '--repo', `WEB=${mob}`).includes(`repos: WEB=${slash(mob)}, MOB=${slash(mob)}`), 'a prefix set again moves');
  for (const [v, why] of [['web=/x', 'the prefix is 2-10 capital letters'], ['W=/x', 'the prefix is 2-10 capital letters'], ['WEB=../web', 'the folder is an absolute path'], ['WEB=', 'the folder is an absolute path'], ['WEB', 'give <PREFIX>=<absolute folder>']]) {
    assert.match(run(dir, 'settings', 'set', '--repo', v)[0], new RegExp(`^plans: settings set refused \\(--repo: ${why}`), v);
  }
  assert.match(run(dir, 'settings', 'set', '--repo')[0], /refused \(--repo: give <PREFIX>=<absolute folder>\)/);
  // Entries edited by hand into something else are left out.
  write(dir, `${LOCAL}/settings.json`, JSON.stringify({ repos: { WEB: web, bad: web, API: 'relative/api', MOB: 7 } }));
  assert.ok(run(dir, 'settings').includes(`repos: WEB=${web}`));
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
const EXPORTED = (key, deps = '', status = 'todo') => `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: s3-connection\npage: 5e7a01c3\nbranch: feat/s3\nmerge_into: main\ndepends_on: [${deps}]\n---\n\n${TICKET_BODY(key)}`;

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
    `created: ${folder}/PROJ-6-delete-files.md`, 'ticket: PROJ-6', `overview: ${folder}/README.md`, 'fetch: not a git repository; keys from the files here only',
  ]);
  const t = readRel(dir, `${folder}/PROJ-6-delete-files.md`);
  assert.ok(t.startsWith('---\ntype: ticket\nkey: PROJ-6\nstatus: todo\nfeature: s3-connection\npage: 5e7a01c3\nbranch: feat/s3\nmerge_into: main\ndepends_on: [PROJ-2, PROJ-5]\n---\n\n# [PROJ-6] Delete files\n\n## In plain words\n'), t);
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
  assert.match(run(dir, 'import')[0], /^plans: unknown command "import" \(list, find, new, .*set, stale, repos, report, export, commit, push/);
  assert.equal(run(dir)[0], 'drafts: 0');
});
