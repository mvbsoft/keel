'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const { parseSteps, problems } = require(path.join(SCRIPTS, 'plan-steps.js'));
const { lastPerAgent, main: ledgerReport } = require(path.join(SCRIPTS, 'ledger-report.js'));

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

function step(n, { files = [`src/m${n}.js`, `test/m${n}.test.js`], model = 'sonnet', effort = 'high', criteria = 2, status = 'not done', title = `module ${n}` } = {}) {
  return [
    `### Step ${n}: ${title}`,
    `- files: ${files.map((f) => `\`${f}\``).join(', ')}`,
    `- model: ${model}`,
    `- effort: ${effort}`,
    `- do: add module ${n}: export run(), reuse lib/util: parse()`,
    '- done when:',
    ...Array.from({ length: criteria }, (_, i) => `  ${i + 1}. \`npm test -- m${n}\` passes case ${i + 1}: ok`),
    `- status: ${status}`,
    '',
  ].join('\n');
}

const plan = (...steps) => `# KEY: title\n\n## Files\n- x\n\n## Steps\n<intro>\n\n${steps.join('\n')}\n## Execution\n1. something: here\n`;

function project(config = CONFIG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-plan-'));
  fs.mkdirSync(path.join(dir, '.keel', 'local'), { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify(config));
  return dir;
}

function run(root, planText, ...args) {
  fs.writeFileSync(path.join(root, 'plan.md'), planText);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'plan-steps.js'), root, 'plan.md', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout;
}

test('plan-steps: reads each step\'s files, model, effort, criteria and status; stops at the next section', () => {
  const steps = parseSteps(plan(step(1), step(2, { model: 'opus', effort: 'medium', criteria: 3, status: 'done' })));
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0].files, ['src/m1.js', 'test/m1.test.js']);
  assert.equal(steps[0].model, 'sonnet');
  assert.equal(steps[1].model, 'opus');
  assert.equal(steps[1].effort, 'medium');
  assert.equal(steps[1].criteria.length, 3, 'criteria with a colon inside stay criteria');
  assert.equal(steps[1].done, true);
  assert.equal(steps[0].done, false);
  assert.equal(steps[1].items.length, 6, 'the Execution section after the steps is not read into the last step');
  assert.deepEqual(problems(steps), []);
});

test('plan-steps: a plan in another language is read by its shape: the word, labels and status symbols', () => {
  const uk = [
    '# ADM-20: API замовлень', '', '## Кроки', '',
    '### Варіант 1: не крок, бо слово інше й номер не з кроків', '',
    '### Крок 1: модуль грошей',
    '- файли: `src/money.js`, `test/money.test.js`',
    '- модель: sonnet', '- рівень міркувань: high',
    '- зробити: додати `formatMoney(cents)`: 123450 → `1234.50 UAH`',
    '- готово, коли:', '  1. `node --test test/money.test.js` проходить', '  2. `npm test` проходить',
    '- виконавець: a3a0f2526dce97103', '- статус: ✅ зроблено', '',
    '### Крок 2: модуль замовлень',
    '- файли: `src/orders.js`', '- модель: opus', '- рівень міркувань: high',
    '- зробити: одним шматком, бо перевірка, ціна й сховище мають узгоджуватися',
    '- готово, коли:', '  1. `node --test test/orders.test.js` проходить',
    '- статус: ◐ 50 % — тести є, сховища ще немає', '',
    '### Крок 3: README', '- файли: `README.md`', '- модель: sonnet', '- рівень міркувань: medium',
    '- зробити: розділ «Замовлення»', '- готово, коли:', '  1. описано 201, 400, 404', '- статус: ⬜ не зроблено', '',
    '## Виконання', '1. щось: тут',
  ].join('\n');
  const steps = parseSteps(uk);
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3], 'only the step word counts; "Варіант 1" is ignored');
  assert.deepEqual(steps.map((s) => s.status), ['done', 'partial 50%', 'not done']);
  assert.equal(steps[0].implementer, 'a3a0f2526dce97103');
  assert.equal(steps[0].criteria.length, 2);
  assert.equal(steps[1].model, 'opus');
  assert.equal(steps[2].effort, 'medium');
  assert.deepEqual(problems(steps), []);
  const root = project({ ...CONFIG, delegation: { min_plan_steps: 3, min_plan_files: 50 } });
  assert.match(run(root, uk, '--remaining'), /^steps: 3 \(1 done, 2 left\); counted: the 2 left$/m);
});

test('plan-steps: ⚠ marks a broken step: not done, counted as left', () => {
  const broken = plan(step(1, { status: '⚠ fails since the schema change' }));
  const steps = parseSteps(broken);
  assert.equal(steps[0].status, 'broken');
  assert.equal(steps[0].done, false);
  assert.match(run(project(), broken), /^steps: 1 \(0 done, 1 left\)$/m);
});

test('plan-steps: the plan template itself is a valid one-step plan', () => {
  const tpl = fs.readFileSync(path.join(PLUGIN, 'templates', 'keel', 'plan.md'), 'utf8');
  const steps = parseSteps(tpl);
  assert.equal(steps.length, 1);
  assert.deepEqual(problems(steps), []);
});

test('plan-steps: names every gap that would make an implementer guess', () => {
  const broken = [
    '### Step 1: no details', '- do: something', '',
    step(3, { model: 'fable' }),
    step(4, { effort: 'turbo' }),
    step(5, { files: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    step(6, { files: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], model: 'opus' }),
    step(7, { files: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], model: 'haiku' }),
  ].join('\n');
  const p = problems(parseSteps(plan(broken)));
  const has = (re) => assert.ok(p.some((x) => re.test(x)), `${re} in ${JSON.stringify(p)}`);
  has(/^step 1: 1 fields; expected at least 5, in this order: files, model, effort, do, done when, status/);
  has(/^step 1: field 1 \(files\) names no file/);
  has(/^step 1: field 2 \(model\) "" - use haiku, sonnet or opus/);
  has(/^step 1: field 5 \(done when\) has no numbered list/);
  has(/^step 3: numbered out of order \(expected 2\)/);
  has(/^step 3: field 2 \(model\) "fable"/);
  has(/^step 4: field 3 \(effort\) "turbo"/);
  has(/^step 5: large for one Sonnet step \(7 files/);
  assert.ok(!p.some((x) => /^step 6: large/.test(x)), 'an Opus step may be one large piece');
  has(/^step 7: large for one Haiku step \(7 files/);
  assert.ok(!p.some((x) => /^step 7: field 2/.test(x)), 'haiku is a valid step model');
  assert.match(problems(parseSteps('# no steps here'))[0], /^no steps: the plan needs level-3 headings "<word> 1: <title>"/);
});

test('plan-steps: proposes delegation at either threshold of .keel/config.json', () => {
  const root = project({ ...CONFIG, delegation: { min_plan_steps: 3, min_plan_files: 5 } });
  const below = run(root, plan(step(1), step(2)));
  assert.match(below, /^suggest: here \(below both thresholds\)$/m);
  assert.match(below, /^thresholds: 3 steps or 5 files \(\.keel\/config\.json delegation\)$/m);
  const over = run(root, plan(step(1), step(2), step(3)));
  assert.match(over, /^suggest: delegate \(3 steps >= 3, 6 files >= 5\)$/m);
  // the here-or-delegate question has one wording: the script's
  assert.match(over, /^ask: Plan: 3 steps, ~6 files\. Do it here or delegate to implementers \(each step to a fresh implementer on its model\)\?$/m);
  assert.doesNotMatch(below, /^ask:/m);
  assert.match(run(root, plan(step(1, { files: ['a', 'b', 'c', 'd', 'e'] }))), /^suggest: delegate \(5 files >= 5\)$/m);
  const table = run(root, plan(step(1, { model: 'opus' }), step(2)));
  assert.match(table, /^\| 1 \| module 1 \| opus \| high \| 2 \| 2 \| not done \|$/m);
  assert.match(table, /^models: sonnet 1, opus 1$/m);
  assert.match(table, /^problems: none$/m);
});

test('plan-steps --remaining counts only the work that is left', () => {
  const root = project({ ...CONFIG, delegation: { min_plan_steps: 3, min_plan_files: 50 } });
  const text = plan(step(1, { status: 'done' }), step(2, { status: 'done' }), step(3, { status: 'partial 60%' }), step(4));
  assert.match(run(root, text), /^suggest: delegate \(4 steps >= 3\)$/m);
  assert.match(run(root, text), /^ask: Plan: 4 steps, ~\d+ files\./m);
  const left = run(root, text, '--remaining');
  assert.match(left, /^steps: 4 \(2 done, 2 left\); counted: the 2 left$/m);
  assert.match(left, /^files: 4 distinct/m);
  assert.match(left, /^suggest: here/m);
  assert.match(left, /\| partial 60% \|$/m);
});

test('plan-steps: keel defaults without a delegation section; a missing file is reported, not thrown', () => {
  const root = project();
  assert.match(run(root, plan(step(1))), /^thresholds: 8 steps or 15 files \(keel defaults\)$/m);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'plan-steps.js'), root, 'nope.md'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^plan-steps: unavailable \(ENOENT/);
});

test('plan-steps: reads plans only in the project or Claude Code\'s plans folder; table cells are cleaned', () => {
  const root = project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-claude-'));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-else-'));
  const text = plan(step(1, { title: 'a | b \u001b[31mred' }));
  fs.writeFileSync(path.join(elsewhere, 'secret.md'), text);
  fs.mkdirSync(path.join(home, 'plans'));
  fs.writeFileSync(path.join(home, 'plans', 'p.md'), text);
  const go = (file) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plan-steps.js'), root, file], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: home } }).stdout;
  assert.match(go(path.join(elsewhere, 'secret.md')), /^plan-steps: unavailable \(the plan file must be inside the project or in Claude Code's plans folder\)/);
  assert.match(go('../' + path.basename(elsewhere) + '/secret.md'), /^plan-steps: unavailable \(the plan file must be inside/);
  const out = go(path.join(home, 'plans', 'p.md'));
  assert.match(out, /^\| 1 \| a \\\| b \[31mred \| sonnet \|/m);
  assert.doesNotMatch(out, /\u001b/);
  assert.match(run(root, text), /^\| 1 \| a \\\| b /m, 'a plan inside the project');
});

test('ledger report: a resumed implementer counts once; --agent filters', () => {
  const root = project();
  const usage = { input_tokens: 10, output_tokens: 1000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 0 };
  const line = (id, type, ts, mult = 1) => JSON.stringify({ ts, session_id: 's', agent_id: id, agent_type: type, model: 'claude-sonnet-5-5', effort: 'high', usage: { ...usage, output_tokens: usage.output_tokens * mult }, requests: 3 * mult, output_estimated: false, transcript: `/t/${id}.jsonl` });
  fs.writeFileSync(path.join(root, '.keel', 'local', 'ledger.jsonl'), [
    line('a1', 'keel:implementer', '2026-10-10T10:00:00.000Z'),
    line('a1', 'keel:implementer', '2026-10-10T10:10:00.000Z', 2),
    line('b2', 'keel:implementer', '2026-10-10T10:20:00.000Z'),
    line('c3', 'keel:qa', '2026-10-10T10:30:00.000Z'),
  ].join('\n') + '\n');
  const out = ledgerReport([root, '--since', '2026-10-10T09:00:00.000Z', '--agent', 'implementer']);
  assert.match(out, /^total: 2 agents/m);
  assert.match(out, /implementer \(sonnet, high\): 6 requests/, 'the later line of a resumed agent covers its whole transcript');
  assert.ok(!/\bqa\b/.test(out));
  assert.match(ledgerReport([root, '--since', '2026-10-10T09:00:00.000Z']), /^total: 3 agents/m);
  assert.equal(lastPerAgent([{ agent_id: 'x', transcript: '/a' }, { agent_id: 'x', transcript: '/b' }]).length, 2, 'different transcripts stay separate');
});
