'use strict';
// Planned features: plans.js (lib/plans.js) on throwaway projects.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
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
  assert.match(run(dir, 'new', 's3-connection')[0], /refused \(a feature "s3-connection" exists \(draft, .*this machine only/);
  assert.doesNotMatch(plan, /^(export|tracker|tracker_url):/m, 'no export field; the tracker fields come only when the user asks');
  // A folder of that name in the repository takes the name for one on this machine too.
  write(dir, 'tickets/csv-export/notes.md', 'x\n');
  assert.match(run(dir, 'new', 'csv-export')[0], /refused \(tickets\/csv-export\/ exists/);
  assert.ok(!exists(dir, `${LOCAL}/csv-export`));
  assert.match(run(dir, 'new', 'csv-report', '--place', 'cloud')[0], /refused \(--place is repo or pc\)/);
});

gitTest('new in the repository: planning.place repo or --place repo puts it in tickets_dir/<feature>/, which tasks see as planning files', () => {
  const dir = project();
  execFileSync('git', ['-C', dir, 'init', '-q']);
  write(dir, '.keel/config.json', JSON.stringify({ ...CONFIG, planning: { place: 'repo', tickets_dir: 'plans/features' } }));
  assert.deepEqual(run(dir, 'new', 's3-connection').slice(0, 2), ['created: plans/features/s3-connection/plan.md', 'folder: plans/features/s3-connection/']);
  run(dir, 'ticket', 's3-connection', '--title', 'Client');
  const isPlanning = planningFiles(dir);
  assert.equal(isPlanning('plans/features/s3-connection/tickets/T1-client.md').kind, 'draft');
  assert.equal(isPlanning('src/app.js'), null);
  write(dir, 'plans/features/csv-export/notes.md', 'x\n');
  assert.match(run(dir, 'new', 'csv-export')[0], /refused \(plans\/features\/csv-export\/ exists/);
  assert.match(line(run(dir, 'list'), '- s3-connection'), /draft · open Q 0 · tickets 1 · changed \d{4}-\d\d-\d\d · plans\/features\/s3-connection\/$/);
  // --place takes this feature to the other place; without planning.place a new one goes to this machine.
  assert.equal(run(dir, 'new', 'csv-report', '--place', 'pc')[0], `created: ${LOCAL}/csv-report/plan.md`);
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  assert.equal(run(dir, 'new', 'pdf-report')[0], `created: ${LOCAL}/pdf-report/plan.md`);
  assert.equal(run(dir, 'new', 'png-report', '--place', 'repo')[0], 'created: tickets/png-report/plan.md');
});

test('ticket: T<n>-<slug>.md with id, type, status draft, a flat depends_on and review_hash; numbers are never reused', () => {
  const dir = project();
  run(dir, 'new', 's3-connection');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Add S3 client')[1], 'ticket: T1');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Upload', '--depends', 't1')[1], 'ticket: T2');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Download')[1], 'ticket: T3');
  const t2 = readRel(dir, `${LOCAL}/s3-connection/tickets/T2-upload.md`);
  assert.ok(t2.startsWith('---\nid: T2\ntype: ticket\nstatus: draft\ndepends_on: T1\nreview_hash: -\n---\n'), t2);
  assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T1-add-s3-client.md`), /^depends_on:$/m, 'no dependency: an empty value');
  assert.match(t2, /^# \[T2\] Upload$/m);
  fs.rmSync(path.join(dir, LOCAL, 's3-connection', 'tickets', 'T3-download.md'));
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Delete')[1], 'ticket: T4', 'deleted T3 keeps its number');
  assert.match(readRel(dir, `${LOCAL}/s3-connection/plan.md`), /^last_ticket: 4$/m);
  // A ticket file made by hand past last_ticket moves the count on too.
  write(dir, `${LOCAL}/s3-connection/tickets/T9-manual.md`, '---\nid: T9\n---\n');
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Next')[1], 'ticket: T10');
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'X', '--depends', 'T3')[0], /refused \(--depends: no ticket T3 in s3-connection\)/);
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'Завантаження')[0], /refused \(the title has no English words .*--slug/);
  assert.equal(run(dir, 'ticket', 's3-connection', '--title', 'Завантаження', '--slug', 'upload-big')[0], `created: ${LOCAL}/s3-connection/tickets/T11-upload-big.md`);
  assert.match(run(dir, 'ticket', 'no-such-draft', '--title', 'X')[0], /refused \(no feature "no-such-draft"/);
});

test('list: feature, state, open questions, tickets, last change; find by words in names and In plain words', () => {
  const dir = project();
  filled(dir, 's3-connection', 2, 'Підключення до сховища S3 для файлів.');
  filled(dir, 'csv-export', 1, 'Export invoices as CSV.');
  body(dir, `${LOCAL}/csv-export/plan.md`, PLAN_BODY('Export invoices as CSV.', '- Q1. Which columns?\n- Q2. Which encoding?'));
  const list = run(dir, 'list');
  assert.equal(list[0], 'features: 2');
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
  assert.equal(none[0], 'find: no match (all features: 2)');
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
  // On Windows this is a C:/Users folder; the localPaths test below passes a Linux home folder itself.
  const home = os.homedir().replace(/\\/g, '/');
  const dir = project();
  filled(dir, 's3-connection', 2);
  const planFile = `${LOCAL}/s3-connection/plan.md`;
  const t1 = `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`;
  write(dir, planFile, readRel(dir, planFile).replace('Files go to S3.', 'Files go to S3, as D:/work/api/src/s3.js does.'));
  write(dir, t1, readRel(dir, t1).replace('Do one thing.', [
    'Do one thing, like C:\\Users\\ann\\app\\upload.js does.',
    `Read ${home}/api/src/s3.js and \`${home}/web/app.js\`.`,
    '```bash\ncd /mnt/c/work/api\n```',
    `See ${path.join(dir, 'src', 'app.js')}.`,
    'Not paths: <https://example.com/home/page>, http://localhost:3000/x, src/home/x.js, ~/.claude/keel, a:b/c, the route ' + '/home/' + 'feed, `GET ' + '/Users/' + '42`.',
  ].join('\n')));
  write(dir, `${LOCAL}/s3-connection/research/r1-s3.md`, `# S3\n\nThe SDK cache sits in ${home}/.npm/_cacache.\n`);
  const out = run(dir, 'check', 's3-connection');
  const expected = [
    'plan.md: local path D:/work/api/src/s3.js (line',
    'T1: local path C:\\Users\\ann\\app\\upload.js (line',
    `T1: local path ${home}/api/src/s3.js (line`,
    `T1: local path ${home}/web/app.js (line`,
    'T1: local path /mnt/c/work/api (line',
    `T1: local path ${path.join(dir, 'src', 'app.js')} (line`,
    `research/r1-s3.md: local path ${home}/.npm/_cacache (line 3)`,
  ];
  for (const e of expected) assert.ok(out.some((l) => l.startsWith(`- ${e}`)), `${e}\n${out.join('\n')}`);
  assert.equal(out[0], `check: ${expected.length} problems`, out.join('\n'));
  assert.deepEqual(out.filter((l) => l.startsWith('note: ')).map((l) => l.replace(/ \(line .*$/, '')), ['note: T1: ' + '/home/' + 'feed', 'note: T1: ' + '/Users/' + '42']);
});

test('localPaths: a folder of this machine counts only as a whole path part; web routes are only a note', () => {
  const at = (text, folders) => plans.localPaths(text, folders).map((p) => p.replace(/ \(line \d+\)$/, ''));
  assert.deepEqual(at('Fix src/apple.js, lib/application.ts and /approot/x.js.', ['/app']), []);
  assert.deepEqual(at('See /app/page.tsx:3, "/app", file:///app/x.js and /app.', ['/app']), ['/app/page.tsx:3', '/app', '/app/x.js', '/app']);
  assert.deepEqual(at('Open <file:///app>, /app?x=1, /app#top or /app!', ['/app']), ['/app', '/app?x=1', '/app#top', '/app!']);
  assert.deepEqual(at('Keep api-old, src/api.v2/x.js and /api_v2.', ['/api']), []);
  assert.deepEqual(at(`Read ${'/home'}/olya>`, [`${'/home'}/olya`]), [`${'/home'}/olya`]);
  assert.deepEqual(at('Remix keeps app/root.tsx; /root.tsx is a file of the repository.', ['/root']), []);
  // Joined, so that the repository's own check for home folders does not take these routes for one.
  const routes = `The news page is ${'/home'}/feed, \`GET ${'/Users'}/42\` returns one, /root redirects.`;
  assert.deepEqual(at(routes), []);
  const notes = plans.homeNotes('T1', routes, []);
  assert.deepEqual(notes.map((n) => n.replace(/ looks like .*$/, '')), [`note: T1: ${'/home'}/feed (line 1)`, `note: T1: ${'/Users'}/42 (line 1)`, 'note: T1: /root (line 1)']);
  assert.match(notes[0], /looks like a home folder; a file's path goes from its repository's root, a web route stays$/);
  // This machine's home folder is a problem, never also a note.
  assert.deepEqual(plans.homeNotes('T1', `Read ${'/home'}/olya/api/x.js.`, [`${'/home'}/olya`]), []);
  assert.deepEqual(at(`Read ${'/home'}/olya/api/x.js.`, [`${'/home'}/olya`]), [`${'/home'}/olya/api/x.js`]);
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

test('check: a mermaid diagram and a table in In plain words pass', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const diagram = 'Three messages in 10 s become one push:\n```mermaid\nsequenceDiagram\n  participant O as Olya\n  participant S as Server\n  O->>S: 3 messages in 10 s\n  S-->>O: one push after 30 s\n```';
  const table = 'Two ways to send:\n\n| Way | Pushes for 3 messages |\n|---|---|\n| one by one | 3 |\n| grouped, T1 | 1 |';
  const plain = `${diagram}\n\n${table}`;
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(plain));
  body(dir, `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`, TICKET_BODY('T1').replace('A file you upload lands in the bucket, and you can download it again.', plain));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
});

test('check: a comparison with < and > on one line is not a placeholder, a <name> still is', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const table = 'When a push goes out:\n\n| Wait | Messages |\n|---|---|\n| < 30 s | > 1 min |\n| x <= 3 | y > 2 |';
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(table));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(`${table}\n\nSent by <who>.`));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: 1 problems', '- plan.md: placeholder <who> (line 26)']);
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
    '- plan.md: placeholder <who> (line 33)',
    '- plan.md: placeholder <2fa code> (line 34)',
    '- plan.md: placeholder <1-2 sentences: what changes> (line 35)',
  ]);
});

test('check: a diagram fenced with ~~~ is code, not a placeholder; the line numbers after it hold', () => {
  const dir = project();
  filled(dir, 's3-connection');
  const text = 'The states:\n\n~~~mermaid\nflowchart TD\n  A <--> B\n~~~';
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(text));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 2 tickets)']);
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY(`${text}\n\nSent by <who>.`));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: 1 problems', '- plan.md: placeholder <who> (line 26)']);
});

test('check: a code block that is never closed is a problem, so the text it hides is not taken as clean', () => {
  const dir = project();
  filled(dir, 's3-connection');
  body(dir, `${LOCAL}/s3-connection/plan.md`, PLAN_BODY('The states:\n\n~~~mermaid\nflowchart TD\n\nSent by <who>.'));
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: 1 problems', '- plan.md: the code block from line 21 is never closed']);
});

test('check: the unfilled templates show only their placeholders', () => {
  const dir = project();
  run(dir, 'new', 's3-connection');
  run(dir, 'ticket', 's3-connection', '--title', 'Upload');
  const out = run(dir, 'check', 's3-connection');
  assert.match(out[0], /^check: \d+ problems$/);
  for (const l of out.slice(1)) assert.match(l, /^- (plan\.md|T1): placeholder </, out.join('\n'));
});

test('review: never reviewed, unchanged after reviewed, changed after an essential edit; descriptive sections and fields do not count', () => {
  const dir = project();
  filled(dir, 's3-connection');
  assert.deepEqual(run(dir, 'review', 's3-connection'), ['review: 2 of 2 tickets to review', '- plan: draft', '- T1: never reviewed', '- T2: never reviewed']);
  assert.deepEqual(run(dir, 'reviewed', 's3-connection', 't1', 'T2'), ['reviewed: 2', '- T1: reviewed', '- T2: reviewed']);
  const t1 = `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`;
  assert.match(readRel(dir, t1), /^review_hash: [0-9a-f]{12}$/m);
  assert.deepEqual(run(dir, 'review', 's3-connection'), ['review: 0 of 2 tickets to review', '- plan: draft', '- T1: unchanged', '- T2: unchanged']);
  // In plain words, Why, Where to look and the fields are descriptive: still unchanged.
  write(dir, t1, readRel(dir, t1).replace('lands in the bucket', 'lands in the S3 bucket').replace('D1.', 'D1, the SDK.').replace(/^status: .*$/m, 'status: in-progress\nbranch: s3-T1\ntracker: PROJ-7\ntracker_url: https://example.com/PROJ-7'));
  assert.equal(run(dir, 'review', 's3-connection')[2], '- T1: unchanged');
  write(dir, t1, readRel(dir, t1).replace('Do one thing.', 'Do one other thing.'));
  assert.equal(run(dir, 'review', 's3-connection')[2], '- T1: changed since review');
  const hash = (fm, text) => plans.ticketHash(`---\nid: T1\n${fm}---\n# [T1] X\n\n${text}`);
  assert.equal(hash('review_hash: abc\nstatus: ready\n', '## Goal\nx\n'), hash('review_hash: -\nstatus: done\nreason: gone\n', '## Goal\nx\n'));
  assert.notEqual(hash('', '## Goal\nx\n'), hash('', '## Goal\ny\n'));
  assert.notEqual(hash('depends_on: T2\n', '## Goal\nx\n'), hash('depends_on:\n', '## Goal\nx\n'), 'depends_on counts');
  assert.equal(hash('depends_on: T2, T3\n', '## Goal\nx\n'), hash('depends_on: [T2,T3]\n', '## Goal\nx\n'), 'as a list of tickets');
  assert.equal(hash('', '## Goal\nx\n\n## Example\na\n'), hash('', '## Goal\nx\n\n## Example\nb\n'));
  assert.match(run(dir, 'reviewed', 's3-connection', 'T5')[0], /refused \(no ticket T5\)/);
});

test('state ready: only when clean with no open questions; readies the plan and every draft ticket that needs no review', () => {
  const dir = project();
  filled(dir, 's3-connection', 3);
  const plan = `${LOCAL}/s3-connection/plan.md`;
  const t = (n) => `${LOCAL}/s3-connection/tickets/T${n}-ticket-${n}.md`;
  body(dir, plan, PLAN_BODY('Upload files.', '- Q1. Which region?'));
  assert.match(run(dir, 'state', 's3-connection', 'ready')[0], /refused \(not ready: 1 open questions\)/);
  body(dir, plan, PLAN_BODY('Upload files.'));
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  assert.deepEqual(run(dir, 'state', 's3-connection', 'ready'), [
    'status: ready', 'ready: T1, T2', 'draft: T3 (needs review: plans.js reviewed s3-connection <ids>, then plans.js status s3-connection <id> ready)',
  ]);
  assert.match(readRel(dir, plan), /^ready_hash: [0-9a-f]{12}$/m);
  for (const [n, s] of [[1, 'ready'], [2, 'ready'], [3, 'draft']]) assert.match(readRel(dir, t(n)), new RegExp(`^status: ${s}$`, 'm'), `T${n}`);
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready · /);
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 3 tickets)']);
  // The page's code and a descriptive section are no edit that needs review.
  write(dir, plan, readRel(dir, plan).replace(/^page: .*$/m, 'page: 0badc0de'));
  body(dir, plan, PLAN_BODY('Upload and list files.'));
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready · /);
  // An essential section edited after ready: the plan needs review and stays ready; so does a ticket.
  write(dir, plan, readRel(dir, plan).replace('D1. Use the SDK.', 'D1. Use the SDK v3.'));
  write(dir, t(1), readRel(dir, t(1)).replace('Do one thing.', 'Do two things.'));
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready \(needs review\) · /);
  assert.deepEqual(run(dir, 'check', 's3-connection'), ['check: clean (plan.md and 3 tickets)']);
  assert.match(readRel(dir, plan), /^status: ready$/m);
  assert.match(readRel(dir, t(1)), /^status: ready$/m);
  assert.equal(run(dir, 'review', 's3-connection')[1], '- plan: changed since ready');
  assert.deepEqual(run(dir, 'reviewed', 's3-connection', 'plan'), ['reviewed: 1', '- plan: reviewed']);
  assert.match(line(run(dir, 'list'), '- s3-connection'), /^- s3-connection: ready · /);
  // set never changes the status either.
  run(dir, 'set', 's3-connection', '--branch', 'feat/s3');
  assert.match(readRel(dir, plan), /^status: ready$/m);
});

test('ticket on a ready feature: a draft that needs review; the plan keeps its state; status ready waits for the review', () => {
  const dir = project();
  filled(dir, 's3-connection');
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  run(dir, 'state', 's3-connection', 'ready');
  const plan = `${LOCAL}/s3-connection/plan.md`;
  assert.deepEqual(run(dir, 'ticket', 's3-connection', '--title', 'Later'), [
    `created: ${LOCAL}/s3-connection/tickets/T3-later.md`, 'ticket: T3',
    'note: T3 is a draft until its review: plans.js reviewed s3-connection T3, then plans.js status s3-connection T3 ready',
  ]);
  assert.match(readRel(dir, plan), /^status: ready$/m);
  assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T3-later.md`), /^status: draft$/m);
  body(dir, `${LOCAL}/s3-connection/tickets/T3-later.md`, TICKET_BODY('T3'));
  assert.match(run(dir, 'status', 's3-connection', 'T3', 'ready')[0], /refused \(T3 needs review: plans.js reviewed s3-connection T3 after its review\)/);
  run(dir, 'reviewed', 's3-connection', 'T3');
  assert.deepEqual(run(dir, 'status', 's3-connection', 'T3', 'ready'), ['status: T3 ready']);
  assert.match(run(dir, 'state', 's3-connection', 'done')[0], /refused \(not every ticket is done or abandoned: T1 ready, T2 ready, T3 ready\)/);
});

test('status: a ticket moves to any state; in-progress takes a ready plan along; done of the last says the plan can be done', () => {
  const dir = project();
  filled(dir, 's3-connection');
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  run(dir, 'state', 's3-connection', 'ready');
  const plan = `${LOCAL}/s3-connection/plan.md`;
  assert.deepEqual(run(dir, 'status', 's3-connection', 't1', 'in-progress'), ['status: T1 in-progress', 'plan: in-progress']);
  assert.match(readRel(dir, plan), /^status: in-progress$/m);
  assert.deepEqual(run(dir, 'status', 's3-connection', 'T1', 'in-progress'), ['status: T1 in-progress (already)']);
  assert.deepEqual(run(dir, 'status', 's3-connection', 'T1', 'done'), ['status: T1 done']);
  assert.match(run(dir, 'status', 's3-connection', 'T2', 'abandoned')[0], /refused \(abandoned needs --reason "<why>"\)/);
  assert.deepEqual(run(dir, 'status', 's3-connection', 'T2', 'abandoned', '--reason', 'the SDK does it'), [
    'status: T2 abandoned', 'plan: every ticket is done or abandoned: plans.js state s3-connection done',
  ]);
  assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T2-ticket-2.md`), /^reason: the SDK does it$/m);
  assert.deepEqual(run(dir, 'check', 's3-connection').at(-1), 'plan: every ticket is done or abandoned: plans.js state s3-connection done');
  assert.deepEqual(run(dir, 'status', 's3-connection', 'T2', 'ready'), ['status: T2 ready']);
  assert.doesNotMatch(readRel(dir, `${LOCAL}/s3-connection/tickets/T2-ticket-2.md`), /^reason:/m, 'the reason leaves with abandoned');
  assert.match(run(dir, 'status', 's3-connection', 'T2', 'closed')[0], /refused \(unknown state "closed": draft, ready, in-progress, done, abandoned\)/);
  assert.match(run(dir, 'status', 's3-connection', 'T9', 'done')[0], /refused \(no ticket T9 in s3-connection\)/);
  assert.match(run(dir, 'status', 's3-connection')[0], /refused \(needs a ticket: T<n>\)/);
  // A check problem: a status that is no state, an abandoned ticket without a reason.
  front(dir, `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`, 'status', 'todo');
  front(dir, `${LOCAL}/s3-connection/tickets/T2-ticket-2.md`, 'status', 'abandoned');
  assert.deepEqual(run(dir, 'check', 's3-connection').slice(0, 3), ['check: 2 problems', '- T1: status is "todo"; draft, ready, in-progress, done, abandoned', '- T2: abandoned without a reason']);
});

test('status and state --project: a session in another folder updates the feature where it lives', () => {
  const dir = project();
  const elsewhere = project();
  filled(dir, 's3-connection');
  run(dir, 'reviewed', 's3-connection', 'T1', 'T2');
  run(dir, 'state', 's3-connection', 'ready');
  assert.deepEqual(run(elsewhere, 'status', 's3-connection', 'T1', 'done', '--project', dir), ['status: T1 done']);
  assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`), /^status: done$/m);
  assert.deepEqual(run(elsewhere, 'state', 's3-connection', 'in-progress', '--project', dir), ['status: in-progress']);
  assert.match(run(elsewhere, 'status', 's3-connection', 'T1', 'done', '--project')[0], /refused \(--project needs the project's folder\)/);
  assert.match(run(elsewhere, 'status', 's3-connection', 'T1', 'done')[0], /refused \(no feature "s3-connection"/);
});

test('state abandoned: needs a reason, abandons every open ticket with it, clears the chat marks; the files stay', () => {
  const dir = project();
  filled(dir, 's3-connection', 3);
  run(dir, 'status', 's3-connection', 'T1', 'done');
  run(dir, 'mark', 'set', 's3-connection', '--session', 'chat-1');
  assert.match(run(dir, 'state', 's3-connection', 'abandoned')[0], /refused \(abandoned needs --reason "<why>"\)/);
  assert.deepEqual(run(dir, 'state', 's3-connection', 'abandoned', '--reason', 'the vendor does it'), ['status: abandoned', 'abandoned: T2, T3']);
  const plan = readRel(dir, `${LOCAL}/s3-connection/plan.md`);
  assert.match(plan, /^status: abandoned\n[\s\S]*^reason: the vendor does it$/m);
  assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T1-ticket-1.md`), /^status: done$/m, 'a done ticket stays done');
  for (const n of [2, 3]) assert.match(readRel(dir, `${LOCAL}/s3-connection/tickets/T${n}-ticket-${n}.md`), /^status: abandoned\n[\s\S]*^reason: the vendor does it$/m);
  assert.deepEqual(run(dir, 'mark', 'get', '--session', 'chat-1'), ['planning: none']);
  assert.match(run(dir, 'mark', 'set', 's3-connection', '--session', 'chat-2')[0], /refused \(the plan is abandoned\)/);
  assert.match(run(dir, 'ticket', 's3-connection', '--title', 'X')[0], /refused \(the plan is abandoned\)/);
  assert.match(run(dir, 'state', 's3-connection', 'finished')[0], /refused \(unknown state "finished"/);
  assert.deepEqual(run(dir, 'state', 's3-connection', 'abandoned', '--reason', 'x'), ['status: abandoned (already)']);
});

test('settings: this machine keeps only the repos map; the project has place, tickets_dir and language', () => {
  const dir = project();
  assert.deepEqual(run(dir, 'settings'), [
    'settings: none yet', 'repos: -', 'planning: planning is not set up in .keel/config.json: /keel:configure planning',
    'place: -', 'tickets_dir: tickets (default)', 'language: uk (default)',
  ]);
  // keel 2.0.0's draft and draft_dir on this machine count nowhere and leave with the next write.
  write(dir, `${LOCAL}/settings.json`, JSON.stringify({ draft: 'repo', draft_dir: 'plans' }));
  assert.ok(!run(dir, 'settings').some((l) => l.startsWith('draft')));
  const web = path.join(path.dirname(dir), 'web');
  run(dir, 'settings', 'set', '--repo', `WEB=${web}`);
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/settings.json`)), { repos: { WEB: web.replace(/\\/g, '/') } });
  for (const k of ['--draft', '--draft-dir', '--language']) assert.match(run(dir, 'settings', 'set', k, 'x')[0], /^plans: settings set refused \(nothing to set: --repo <name>=<absolute folder>\)$/, k);
  write(dir, '.keel/config.json', JSON.stringify({ ...CONFIG, planning: { place: 'repo', tickets_dir: 'work/tickets', language: 'en', ticket_prefix: 'OLD' } }));
  const out = run(dir, 'settings');
  for (const l of ['planning: .keel/config.json', 'place: repo', 'tickets_dir: work/tickets', 'language: en']) assert.ok(out.includes(l), l);
  assert.ok(!out.some((l) => l.includes('OLD')), 'the old prefix is not read');
  assert.equal(line(run(dir, 'new', 'csv-export'), 'language: '), 'language: en', 'a new plan takes the ticket language');
  // A config the check rejects is not used: the line names the config problem.
  write(dir, '.keel/config.json', JSON.stringify({ ...CONFIG, docs: { profile: 99 }, planning: { place: 'pc' } }));
  assert.match(line(run(dir, 'settings'), 'planning: '), /^planning: \.keel\/config\.json is invalid \(.*docs.*\), so its planning section is not used: \/keel:configure$/);
  write(dir, `${LOCAL}/settings.json`, '{oops');
  assert.match(run(dir, 'settings')[0], /\(unreadable: defaults in use\)$/);
});

test('settings: the repos map, one --repo <name>=<absolute folder> per call', () => {
  const dir = project();
  const web = path.join(path.dirname(dir), 'web');
  const mob = path.join(path.dirname(dir), 'mobile') + path.sep;
  const slash = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  assert.ok(run(dir, 'settings', 'set', '--repo', `web=${web}`).includes(`repos: web=${slash(web)}`));
  const out = run(dir, 'settings', 'set', '--repo', `team/mobile=${mob}`);
  assert.ok(out.includes(`repos: web=${slash(web)}, team/mobile=${slash(mob)}`), out.join('\n'));
  assert.deepEqual(JSON.parse(readRel(dir, `${LOCAL}/settings.json`)), { repos: { web: slash(web), 'team/mobile': slash(mob) } });
  assert.ok(run(dir, 'settings', 'set', '--repo', `web=${mob}`).includes(`repos: web=${slash(mob)}, team/mobile=${slash(mob)}`), 'a name set again moves');
  for (const [v, why] of [['my web=/x', 'the name is the repository name'], ['-web=/x', 'the name is the repository name'], ['a/b/c=/x', 'the name is the repository name'], ['web=../web', 'the folder is an absolute path'], ['web=', 'the folder is an absolute path'], ['web', 'give <name>=<absolute folder>']]) {
    assert.match(run(dir, 'settings', 'set', '--repo', v)[0], new RegExp(`^plans: settings set refused \\(--repo: ${why}`), v);
  }
  assert.match(run(dir, 'settings', 'set', '--repo')[0], /refused \(--repo: give <name>=<absolute folder>\)/);
  // Entries edited by hand into something else are left out.
  write(dir, `${LOCAL}/settings.json`, JSON.stringify({ repos: { web, 'my web': web, api: 'relative/api', mobile: 7 } }));
  assert.ok(run(dir, 'settings').includes(`repos: web=${web}`));
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
  assert.match(run(dir, 'mark', 'set', 'csv-export', '--session', 'chat-1')[0], /refused \(no feature "csv-export"/);
  assert.match(run(dir, 'mark', 'set', 's3-connection', '--session', '../x')[0], /refused \(needs --session <id>\)/);
  assert.match(run(dir, 'mark', 'set', 's3-connection')[0], /refused \(needs --session <id>\)/);
  assert.match(run(dir, 'mark', 'drop', '--session', 'chat-1')[0], /refused \(unknown "drop"/);
  assert.equal(plans.planningMark(dir, '../x'), null);
});

test('plans.js: unknown commands are named, never thrown', () => {
  const dir = project();
  assert.equal(run(dir, 'import')[0], 'plans: unknown command "import" (list, find, new, ticket, check, review, reviewed, state, status, set, stale, repos, report, commit, push, tickets, drop, brief, settings, mark)');
  assert.equal(run(dir)[0], 'features: 0');
  assert.match(run(dir, 'export', 's3-connection')[0], /^plans: unknown command "export"/);
  assert.match(run(dir, 'done', 'PROJ-1')[0], /^plans: unknown command "done"/);
});
