'use strict';
// plans.js brief: a start-task brief goes into a new draft's plan.md, and the brief to keel's trash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const { sections } = require(path.join(SCRIPTS, 'lib', 'tasks.js'));
const { listBatches } = require(path.join(SCRIPTS, 'lib', 'trash.js'));

const CONFIG = {
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
};
const BRIEF = '.keel/local/plans/briefs/order-notices-brief.md';
const TEXT = `## Goal
Customers get an e-mail when their order is paid or shipped.

## Files
- src/payment.js:4 charge() returns status paid: the place the e-mail starts from

## Decisions and why
- Mail goes through the company's SMTP server - no new service account
- D7. Texts in English only - the shop has no other language

## Open questions
- Should customers turn the e-mails off? - a settings page depends on it
- Which address sends them? - the SMTP account
`;

const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const planOf = (dir) => fs.readFileSync(path.join(dir, '.keel/local/plans/keel/order-notices/plan.md'), 'utf8');

function project() {
  const dir = tempDir('keel-brief-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, BRIEF, TEXT);
  assert.match(run(dir, 'new', 'order-notices')[0], /^created: /);
  return dir;
}

test('plans.js brief moves each brief section into its plan.md section, numbers decisions and questions, and trashes the brief', () => {
  const dir = project();
  const out = run(dir, 'brief', 'order-notices', BRIEF);
  assert.equal(out[0], `brief: ${BRIEF} -> .keel/local/plans/keel/order-notices/plan.md (In plain words, What was gathered, Decisions, Open questions)`);
  assert.match(out[1], /^moved to keel's trash: batch \S+ \(\/keel:cleanup restore \S+ puts it back\)$/);
  const s = sections(planOf(dir));
  assert.equal(s['In plain words'], 'Customers get an e-mail when their order is paid or shipped.');
  assert.equal(s['What was gathered'], '- src/payment.js:4 charge() returns status paid: the place the e-mail starts from');
  // An item already numbered keeps its number; the others follow the highest one so far.
  assert.equal(s.Decisions, "D1. Mail goes through the company's SMTP server - no new service account\nD7. Texts in English only - the shop has no other language");
  assert.equal(s['Open questions'], 'Q1. Should customers turn the e-mails off? - a settings page depends on it\nQ2. Which address sends them? - the SMTP account');
  assert.equal(s.Tickets, '<T1 title, one line per ticket>', 'the other sections stay as plans.js new wrote them');
  assert.match(run(dir, 'list')[1], /^- order-notices: draft · open Q 2 · tickets 0 /, 'the questions count as open ones');
  assert.ok(!fs.existsSync(path.join(dir, BRIEF)), 'the brief left its place');
  const batch = listBatches(dir).pop();
  assert.equal(batch.by, 'planning');
  assert.deepEqual(batch.items.map((i) => i.path), [BRIEF], 'the trash holds the brief, so /keel:cleanup restore puts it back');
});

test('plans.js brief adds to what a section already holds and numbers past its D and Q', () => {
  const dir = project();
  const file = path.join(dir, '.keel/local/plans/keel/order-notices/plan.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('## Decisions\n', '## Decisions\nD2. One queue - fewer parts\n'));
  run(dir, 'brief', 'order-notices', path.join(dir, BRIEF));
  assert.equal(sections(planOf(dir)).Decisions, "D2. One queue - fewer parts\nD3. Mail goes through the company's SMTP server - no new service account\nD7. Texts in English only - the shop has no other language");
});

test('plans.js brief refuses what is not a brief, a missing draft or one that is not a draft, and leaves the brief', () => {
  const dir = project();
  write(dir, 'notes/order-notices-brief.md', TEXT);
  write(dir, '.keel/local/plans/briefs/bare-goal-brief.md', '## Files\n- x\n');
  write(dir, '.keel/local/plans/briefs/notices-2-brief.md', TEXT);
  const refusal = (args, why) => assert.match(run(dir, 'brief', ...args)[0], new RegExp(`^plans: brief refused \\(${why}`), args.join(' '));
  refusal(['order-notices'], 'needs the brief file');
  refusal(['order-notices', 'notes/order-notices-brief.md'], 'notes/order-notices-brief\\.md is not a brief');
  refusal(['order-notices', '.keel/local/plans/briefs/../order-notices-brief.md'], '.* is not a brief');
  refusal(['order-notices', '.keel/local/plans/order-notices-brief.md'], '.* is not a brief');
  // The brief's name is a feature name: no digit right after a hyphen.
  refusal(['order-notices', '.keel/local/plans/briefs/notices-2-brief.md'], '.* is not a brief');
  refusal(['order-notices', '.keel/local/plans/briefs/missing-one-brief.md'], 'no brief');
  refusal(['order-notices', '.keel/local/plans/briefs/bare-goal-brief.md'], '.* has no Goal section');
  refusal(['other-feature', BRIEF], 'no draft "other-feature"');
  const file = path.join(dir, '.keel/local/plans/keel/order-notices/plan.md');
  const draft = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, draft.replace(/^status: draft$/m, 'status: exported'));
  refusal(['order-notices', BRIEF], 'the plan is exported');
  assert.ok(fs.existsSync(path.join(dir, BRIEF)), 'a refusal moves nothing');
  assert.equal(fs.readFileSync(file, 'utf8'), draft.replace(/^status: draft$/m, 'status: exported'), 'and writes nothing');
});

test('plans.js brief never gives two items one number: a number the brief or the section has is skipped', () => {
  const dir = project();
  const file = path.join(dir, '.keel/local/plans/keel/order-notices/plan.md');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
    .replace('## Decisions\n', '## Decisions\n- **D2** One queue - fewer parts\n')
    .replace('## Open questions\n', '## Open questions\n- Q1. Who reads the log? - the support team\n'));
  write(dir, BRIEF, [
    '## Goal', 'Order e-mails.', '',
    '## Decisions and why', '- Plain text - every client shows it', '- D3. SMTP - no new account', '- D2. One sender - one reply address', '',
    '## Open questions', '- Q1. Which sender? - the SMTP account', '```', '- not an item', '```', '- Quiet hours? - the scheduler', '',
  ].join('\r\n'));
  run(dir, 'brief', 'order-notices', BRIEF);
  const s = sections(planOf(dir));
  // D2 is the section's own (bold, after a bullet): the brief's D2 moves on; D3 is the brief's own.
  assert.equal(s.Decisions, '- **D2** One queue - fewer parts\nD4. Plain text - every client shows it\nD3. SMTP - no new account\nD5. One sender - one reply address');
  assert.equal(s['Open questions'], '- Q1. Who reads the log? - the support team\nQ2. Which sender? - the SMTP account\n```\n- not an item\n```\nQ3. Quiet hours? - the scheduler');
  assert.ok(!/\r/.test(planOf(dir)), 'a brief with Windows line ends writes none into plan.md');
});

test('plans.js brief refuses a plan.md without the section a brief part goes to, and writes nothing', () => {
  const dir = project();
  const file = path.join(dir, '.keel/local/plans/keel/order-notices/plan.md');
  const plan = fs.readFileSync(file, 'utf8').replace(/^## What was gathered$/m, '## Gathered');
  fs.writeFileSync(file, plan);
  assert.equal(run(dir, 'brief', 'order-notices', BRIEF)[0], 'plans: brief refused (plan.md has no What was gathered section)');
  assert.equal(fs.readFileSync(file, 'utf8'), plan);
  assert.ok(fs.existsSync(path.join(dir, BRIEF)));
});

test('plans.js brief refuses a brief behind a link', { skip: process.platform === 'win32' && 'links need rights on Windows' }, () => {
  const dir = project();
  const outside = tempDir('keel-brief-outside-');
  fs.rmSync(path.join(dir, '.keel/local/plans/briefs'), { recursive: true });
  write(outside, 'order-notices-brief.md', TEXT);
  fs.symlinkSync(outside, path.join(dir, '.keel/local/plans/briefs'));
  assert.match(run(dir, 'brief', 'order-notices', BRIEF)[0], /^plans: brief refused \(\.keel\/local\/plans\/briefs\/order-notices-brief\.md: /);
  assert.ok(fs.existsSync(path.join(outside, 'order-notices-brief.md')), 'the linked file stays');
});
