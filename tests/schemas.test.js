'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validate, checkSchema } = require('../plugins/keel/scripts/lib/schema.js');

const SCHEMAS = path.join(__dirname, '..', 'plugins', 'keel', 'schemas');
const load = (name) => JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), 'utf8'));
const clone = (v) => structuredClone(v);

// Apply a mutation to a copy of the valid example and expect a matching error.
function expectInvalid(schema, base, mutate, errorPattern) {
  const doc = clone(base);
  mutate(doc);
  const errors = validate(doc, schema);
  assert.ok(errors.length > 0, `expected an error matching ${errorPattern}`);
  assert.ok(errors.some((e) => errorPattern.test(e)), `no error matched ${errorPattern}: ${errors.join('; ')}`);
}

const EXAMPLES = {
  'config.schema.json': {
    schema_version: 1,
    repo_language: 'en',
    gates: {
      checks: [
        { part: '.', kind: 'test', command: 'npm test' },
        { part: 'packages/api', kind: 'types', command: 'npx tsc --noEmit' },
      ],
      security_scanners: [{ name: 'gitleaks', command: 'gitleaks detect --no-banner' }],
    },
    git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
    verification: {
      tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
      verifier_caps: { basic: 3, standard: 5, maximum: 8 },
    },
    architecture: { file_lines_warn: 700, file_lines_max: 1000 },
    docs: { profile: 2, pattern: 'none' },
    delegation: { min_plan_steps: 8, min_plan_files: 15 },
    cleanup: { trash_max_age_days: 30 },
    stack_skills: ['php-laravel'],
  },
  'profile.schema.json': {
    schema_version: 1,
    manifest_fingerprint: 'a'.repeat(64),
    languages: [{ name: 'TypeScript', files: 120 }, { name: 'SQL', files: 4 }],
    monorepo_tool: 'pnpm',
    parts: [
      { path: '.', ecosystems: ['npm'], commands: { test: ['pnpm -r test'] }, run_command: null },
      { path: 'packages/api', name: 'api', ecosystems: ['npm'], commands: { test: ['pnpm test'], lint: ['pnpm lint'] }, run_command: 'pnpm dev' },
    ],
    triggers: { security: ['**/auth/**'], data: ['**/migrations/**'], docs: ['docs/**', '*.md'], env: ['Dockerfile'] },
    secret_paths: ['.env', 'config/prod.key'],
    ai_rules: ['AGENTS.md', 'packages/api/CLAUDE.md'],
  },
  'findings.schema.json': {
    agent: 'bug-hunter',
    status: 'complete',
    topics: [{ topic: 'logic', checked: 'changed functions in src/orders' }],
    findings: [{
      id: 'bug-hunter-1',
      topic: 'logic',
      severity: 'critical',
      what: 'Discount applied twice',
      problem: 'applyDiscount is called in both the controller and the service',
      fix: 'Remove the controller call',
      if_not_fixed: 'Customers pay less than the price',
      locations: [{ file: 'src/orders/service.ts', line: 42, end_line: 47 }],
      evidence: 'order total 100 with 10% discount becomes 81',
      reproduce: 'npm test -- orders.discount',
      sources: ['src/orders/controller.ts:18'],
    }],
  },
  'plan-findings.schema.json': {
    agent: 'ticket-reviewer',
    status: 'complete',
    checks: [
      { place: 'T2', check: 'testable-criteria', answer: 'no', note: 'criterion 2 says "fast"' },
      { place: 'T2', check: 'true-in-code', answer: 'n/a' },
    ],
    findings: [{
      id: 'ticket-reviewer-1',
      place: 'T2',
      check: 'testable-criteria',
      severity: 'important',
      what: 'Criterion 2 has no measure',
      problem: 'The developer cannot tell when the export is fast enough',
      fix: 'Say: 10 000 invoices export in under 5 s',
      evidence: 'T2: "the export is fast"',
      code: ['src/export/csv.js:42', 'src/export/csv.js:10-20'],
    }],
  },
  'verdicts.schema.json': {
    verifier: 'verifier',
    verdicts: [{
      finding_id: 'bug-hunter-1',
      lens: 'general',
      restatement: 'The discount function runs twice per order',
      verdict: 'CONFIRMED',
      evidence: [{ file: 'src/orders/controller.ts', line: 18, note: 'second call' }],
      reasoning: 'Both call sites are reached for every POST /orders',
    }],
  },
  'ledger-entry.schema.json': {
    ts: '2026-10-09T14:20:00.123Z',
    session_id: 's-1',
    agent_id: 'a-1',
    agent_type: 'keel:qa',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    usage: { input_tokens: 10, output_tokens: 200, cache_read_input_tokens: 50000, cache_creation_input_tokens: 3000 },
    requests: 12,
    output_estimated: false,
  },
  'judgement.schema.json': {
    items: [{
      n: 1,
      group: 'must',
      status: 'confirmed',
      ids: ['bug-hunter-1', 'data-2'],
      what: 'Discount applied twice',
      problem: 'applyDiscount runs in the controller and the service',
      fix: 'Remove the controller call',
      if_not_fixed: 'Customers pay less than the price',
      locations: [{ file: 'src/orders/service.ts', line: 42 }],
      evidence: 'verifier v1: src/orders/controller.ts:18 second call',
      notes: 'merged with data-2 (same call)',
    }],
    refuted: ['security-2'],
    contradictions: [{ items: [1, 3], description: 'removing the call breaks the preview endpoint' }],
  },
  'usage-day.schema.json': {
    schema: 1,
    date: '2026-10-11',
    pc: 'DESKTOP-1',
    user: 'me@example.com',
    part: 1,
    parts: 1,
    synced_until: '2026-10-11T20:00:00.000Z',
    hours: [{
      h: '2026-10-11T10:00:00.000Z', wallet: 'subscription', usd: 1.5, req: 3,
      tok: { in: 10, cw5: 100, cw1h: 0, cr: 5000, out: 200 }, by_model: { 'claude-opus-5': 1.5 },
    }],
    snapshots: [{ t: '2026-10-11T10:05:00.000Z', five_hour: 12, seven_day: 40 }],
    sessions: [{
      id: 's1', project: 'demo', cwd: '/work/demo', branch: 'main', wallet: 'subscription', entrypoint: 'cli',
      start: '2026-10-11T10:00:00.000Z', end: '2026-10-11T10:30:00.000Z', active_min: 20, usd: 1.5, cost_cc: null, unpriced: [],
      keel: { task: 'KEY-1: thing', level: 'standard', findings: { must: 0, should: 1, nice: 2 }, gates: 'pass', lines: { add: 10, del: 2 }, files: 3, steps: [{ title: 'one', model: 'sonnet' }] },
      participants: [{
        kind: 'main', type: 'main', model: 'claude-opus-5',
        by_model: { 'claude-opus-5': { requests: 3, tok: { in: 10, cw5: 100, cw1h: 0, cr: 5000, out: 200 }, usd: 1.5 } },
        start: '2026-10-11T10:00:00.000Z', end: '2026-10-11T10:30:00.000Z', active_min: 20, requests: 3, tools: { Bash: 2 }, agents_launched: 0,
        tok: { in: 10, cw5: 100, cw1h: 0, cr: 5000, out: 200 }, usd: 1.5, output_estimated: false, resumed: 0,
      }],
      turns: [{ t: '2026-10-11T10:00:01.000Z', text: 'hello', usd: 1.5, requests: 3, agents: 0 }],
    }],
  },
};

test('every schema uses only supported keywords and resolves its refs', () => {
  const files = fs.readdirSync(SCHEMAS).filter((f) => f.endsWith('.schema.json'));
  assert.deepEqual(files.sort(), Object.keys(EXAMPLES).sort());
  for (const f of files) assert.deepEqual(checkSchema(load(f)), [], f);
});

for (const [file, example] of Object.entries(EXAMPLES)) {
  test(`${file}: valid example passes`, () => {
    assert.deepEqual(validate(example, load(file)), []);
  });
}

test('config.schema.json rejects broken configs', () => {
  const s = load('config.schema.json');
  const ok = EXAMPLES['config.schema.json'];
  expectInvalid(s, ok, (d) => { d.schema_version = 2; }, /schema_version: must equal 1/);
  expectInvalid(s, ok, (d) => { delete d.git; }, /missing "git"/);
  expectInvalid(s, ok, (d) => { d.git.mode = 'auto'; }, /git\.mode: must be one of/);
  expectInvalid(s, ok, (d) => { d.gates.checks[0].kind = 'build'; }, /kind: must be one of/);
  expectInvalid(s, ok, (d) => { d.gates.checks[0].command = ''; }, /command: shorter than 1/);
  expectInvalid(s, ok, (d) => { d.docs.profile = 5; }, /profile: above 4/);
  expectInvalid(s, ok, (d) => { d.docs.pattern = 'c4'; }, /pattern: must be one of/);
  expectInvalid(s, ok, (d) => { d.verification.verifier_caps.basic = 2.5; }, /expected integer/);
  expectInvalid(s, ok, (d) => { d.verification.verifier_caps.basic = -1; }, /basic: below 0/);
  expectInvalid(s, ok, (d) => { d.verification.verifier_caps.quick = 2; }, /quick: unexpected property/);
  expectInvalid(s, ok, (d) => { d.verification.tier_rules.core_fan_in = 0; }, /core_fan_in: below 1/);
  assert.deepEqual(validate({ ...ok, verification: { ...ok.verification, tier_rules: { ...ok.verification.tier_rules, core_fan_in: 5 } } }, s), [], 'the core-code setting is optional and valid');
  expectInvalid(s, ok, (d) => { d.repo_language = 'English'; }, /repo_language: does not match/);
  expectInvalid(s, ok, (d) => { d.api_key = 'x'; }, /api_key: unexpected property/);
});

test('profile.schema.json rejects machine-specific and unsafe paths', () => {
  const s = load('profile.schema.json');
  const ok = EXAMPLES['profile.schema.json'];
  for (const bad of ['C:/Users/me/.env', '/home/me/.env', '../outside/.env', 'a/../../b', 'config\\prod.key']) {
    expectInvalid(s, ok, (d) => { d.secret_paths = [bad]; }, /does not match/);
  }
  expectInvalid(s, ok, (d) => { d.parts = []; }, /fewer than 1 items/);
  expectInvalid(s, ok, (d) => { d.parts[0].path = '/abs'; }, /parts\[0\]\.path: does not match/);
  expectInvalid(s, ok, (d) => { d.manifest_fingerprint = 'abc'; }, /does not match/);
  expectInvalid(s, ok, (d) => { d.secret_paths = ['.env', '.env']; }, /must be unique/);
  expectInvalid(s, ok, (d) => { d.parts[0].cache_dir = '/root/.npm'; }, /unexpected property/);
  expectInvalid(s, ok, (d) => { delete d.triggers.security; }, /missing "security"/);
});

test('findings.schema.json enforces the four-part finding with a location', () => {
  const s = load('findings.schema.json');
  const ok = EXAMPLES['findings.schema.json'];
  for (const part of ['what', 'problem', 'fix', 'if_not_fixed', 'evidence']) {
    expectInvalid(s, ok, (d) => { delete d.findings[0][part]; }, new RegExp(`missing "${part}"`));
  }
  expectInvalid(s, ok, (d) => { d.findings[0].locations = []; }, /fewer than 1 items/);
  expectInvalid(s, ok, (d) => { d.findings[0].locations[0].line = 0; }, /line: below 1/);
  expectInvalid(s, ok, (d) => { d.findings[0].severity = 'high'; }, /severity: must be one of/);
  expectInvalid(s, ok, (d) => { d.findings[0].id = '1'; }, /id: does not match/);
  expectInvalid(s, ok, (d) => { d.status = 'partial'; }, /status: must be one of/);
});

test('plan-findings.schema.json: a finding names a ticket or part of the plan, with evidence; the decision has a reason', () => {
  const s = load('plan-findings.schema.json');
  const ok = EXAMPLES['plan-findings.schema.json'];
  for (const part of ['place', 'check', 'severity', 'what', 'problem', 'fix', 'evidence']) {
    expectInvalid(s, ok, (d) => { delete d.findings[0][part]; }, new RegExp(`missing "${part}"`));
  }
  for (const place of ['src/export/csv.js:42', 'T0', 'proj-101', 'ticket 2', 'decisions']) {
    expectInvalid(s, ok, (d) => { d.findings[0].place = place; }, /place: does not match/);
  }
  // An exported ticket, reviewed when its feature is reopened, is named by its key.
  const exported = structuredClone(ok);
  exported.findings[0].place = 'PROJ-101';
  assert.deepEqual(validate(exported, s), []);
  expectInvalid(s, ok, (d) => { d.findings[0].evidence = ''; }, /evidence/);
  expectInvalid(s, ok, (d) => { d.findings[0].code = ['src/export/csv.js']; }, /does not match/);
  expectInvalid(s, ok, (d) => { d.findings[0].check = 'style'; }, /check: must be one of/);
  expectInvalid(s, ok, (d) => { d.checks[0].answer = 'maybe'; }, /answer: must be one of/);
  expectInvalid(s, ok, (d) => { d.agent = 'reviewer'; }, /agent: must be one of/);
  expectInvalid(s, ok, (d) => { d.findings = Array(21).fill(ok.findings[0]); }, /more than 20 items/);
  assert.deepEqual(validate({ ...ok, agent: 'plan-reviewer', checks: [{ place: 'plan', check: 'premortem', answer: 'yes' }], findings: [{ ...ok.findings[0], id: 'plan-reviewer-1', place: 'Decisions', check: 'consistency' }] }, s), []);
  // An agent out of turns says what is left in the top-level note.
  assert.deepEqual(validate({ ...ok, status: 'incomplete', note: 'T3 and T4 not reviewed' }, s), []);
  expectInvalid(s, ok, (d) => { d.status = 'incomplete'; d.note = ''; }, /note/);

  // Every section of the plan template is a place.
  const template = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'templates', 'keel', 'planning', 'plan.md'), 'utf8');
  for (const [, section] of template.matchAll(/^## (.+)$/gm)) {
    assert.deepEqual(validate({ ...ok, findings: [{ ...ok.findings[0], place: section }] }, s), [], section);
  }

  const decision = { $defs: s.$defs, $ref: '#/$defs/decision' };
  const made = { place: 'T2', what: 'Criterion 2 has no measure', choice: 'defer', reason: 'the target is not known yet', question: 'Q3' };
  assert.deepEqual(validate(made, decision), []);
  expectInvalid(decision, made, (d) => { delete d.reason; }, /missing "reason"/);
  expectInvalid(decision, made, (d) => { d.choice = 'ignore'; }, /choice: must be one of/);
  expectInvalid(decision, made, (d) => { d.question = 'D3'; }, /question: does not match/);
});

test('verdicts.schema.json requires evidence and a known verdict', () => {
  const s = load('verdicts.schema.json');
  const ok = EXAMPLES['verdicts.schema.json'];
  expectInvalid(s, ok, (d) => { d.verdicts[0].verdict = 'TRUE_POSITIVE'; }, /verdict: must be one of/);
  expectInvalid(s, ok, (d) => { d.verdicts[0].evidence = []; }, /fewer than 1 items/);
  expectInvalid(s, ok, (d) => { delete d.verdicts[0].restatement; }, /missing "restatement"/);
  expectInvalid(s, ok, (d) => { d.verdicts = [1, 2, 3, 4, 5].map(() => clone(ok.verdicts[0])); }, /more than 4 items/);
  expectInvalid(s, ok, (d) => { d.verdicts[0].lens = 'vibes'; }, /lens: must be one of/);
});

test('ledger-entry.schema.json rejects bad timestamps and negative tokens', () => {
  const s = load('ledger-entry.schema.json');
  const ok = EXAMPLES['ledger-entry.schema.json'];
  expectInvalid(s, ok, (d) => { d.ts = '2026-10-09 14:20'; }, /ts: does not match/);
  expectInvalid(s, ok, (d) => { d.usage.output_tokens = -1; }, /below 0/);
  expectInvalid(s, ok, (d) => { d.effort = 'ultra'; }, /effort: must be one of/);
  assert.deepEqual(validate({ ...clone(ok), effort: null, model: null }, s), []);
});
