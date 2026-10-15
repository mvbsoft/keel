'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const { parseDiff } = require(path.join(SCRIPTS, 'lib', 'diff.js'));
const { analyze, lineup, moduleOf, verifierCaps } = require(path.join(SCRIPTS, 'lib', 'tier.js'));
const { fanIn, specifiers, pointsAt } = require(path.join(SCRIPTS, 'lib', 'fanin.js'));
const { extractJson, makePlan, tally } = require(path.join(SCRIPTS, 'votes.js'));
const { summarize } = require(path.join(PLUGIN, 'hooks', 'ledger.js'));
const { cost, report } = require(path.join(SCRIPTS, 'ledger-report.js'));
const { validate } = require(path.join(SCRIPTS, 'lib', 'schema.js'));

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
const PROFILE = {
  parts: [{ path: '.', ecosystems: ['npm'], commands: {} }],
  triggers: {
    security: ['**/auth/**', '**/*auth*', '**/*payment*'],
    data: ['**/migrations/**', '**/*.sql', '**/models/**', '**/routes/**'],
    docs: ['**/*.md', 'docs/**'],
    env: ['**/package.json', '**/Dockerfile*', '.github/workflows/**'],
  },
};
const file = (p, added = [], removed = [], extra = {}) => ({ path: p, oldPath: null, status: 'modified', binary: false, secret: false, added, removed, ...extra });
const tierOf = (files, sizes = {}, fanIn = {}) => analyze({ files, sizes, fan_in: fanIn }, PROFILE, CONFIG).proposal.tier;

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('diff parser: statuses, renames, binaries and removed lines that look like headers', () => {
  const text = [
    'diff --git a/src/a.js b/src/a.js', 'index 1..2 100644', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new',
    'diff --git a/q.sql b/q.sql', '--- a/q.sql', '+++ b/q.sql', '@@ -1 +1 @@', '--- a comment', '+++ counter',
    'diff --git a/old.js b/new.js', 'similarity index 90%', 'rename from old.js', 'rename to new.js',
    'diff --git a/img.png b/img.png', 'new file mode 100644', 'Binary files /dev/null and b/img.png differ',
    'diff --git a/gone.js b/gone.js', 'deleted file mode 100644', '--- a/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
  ].join('\n');
  const files = parseDiff(text);
  assert.deepEqual(files.map((f) => [f.path, f.status]), [['src/a.js', 'modified'], ['q.sql', 'modified'], ['new.js', 'renamed'], ['img.png', 'added'], ['gone.js', 'deleted']]);
  assert.deepEqual([files[0].added, files[0].removed], [['new'], ['old']]);
  assert.deepEqual([files[1].added, files[1].removed], [['++ counter'], ['-- a comment']]);
  assert.equal(files[2].oldPath, 'old.js');
  assert.equal(files[3].binary, true);
  assert.deepEqual(files[4].removed, ['x']);
});

test('modules: source roots are skipped, tests share the module of their code, monorepo parts prefix it', () => {
  const parts = ['.', 'packages/api'];
  assert.equal(moduleOf('src/billing/invoice.js', parts), 'billing');
  assert.equal(moduleOf('tests/billing/invoice.test.js', parts), 'billing');
  assert.equal(moduleOf('index.js', parts), '.');
  assert.equal(moduleOf('packages/api/src/routes/users.ts', parts), 'packages/api:routes');
});

test('a line starting with * is a comment only as a block comment line, not a pointer or a product', () => {
  assert.equal(tierOf([file('src/billing/sum.c', ['/**', ' * Adds two sums.', ' *', ' */'])]), 'gates-only', 'block comment lines');
  assert.equal(tierOf([file('src/billing/sum.c', ['*count += 2;'])]), 'basic', 'a pointer write');
  assert.equal(tierOf([file('src/billing/sum.c', [], ['*p = 0;'])]), 'basic', 'a removed pointer write');
  assert.equal(tierOf([file('src/billing/sum.php', ['#'])]), 'gates-only', 'a lone # in PHP');
});

test('level proposal follows plan 10.2', () => {
  assert.equal(tierOf([]), 'none');
  assert.equal(tierOf([file('README.md', ['more'])]), 'gates-only', 'one doc file');
  assert.equal(tierOf([file('src/billing/sum.js', ['// note', ''])]), 'gates-only', 'comments only');
  assert.equal(tierOf([file('src/app.py', ['#!/usr/bin/env python3'])]), 'basic', 'a shebang is not a comment');
  assert.equal(tierOf([file('src/billing/sum.js', ['return a - b;'])]), 'basic', 'small behavior change in one module');
  const lines = (n) => Array.from({ length: n }, (_, i) => `y${i}()`);
  assert.equal(tierOf([file('src/billing/sum.js', lines(399))]), 'basic', 'an ordinary change below large_change_lines');
  assert.equal(tierOf([file('src/billing/sum.js', ['x()']), file('src/users/list.js', ['y()'])]), 'standard', 'two modules');
  const api = analyze({ files: [file('src/routes/users.js', ['router.get()'])], sizes: {} }, PROFILE, CONFIG);
  assert.equal(api.proposal.tier, 'basic', 'API files alone: Basic, as measured');
  assert.match(api.proposal.reasons.join(' | '), /touches data \(API src\/routes\/users\.js\): Standard would add specialist reviewers/);
  assert.equal(tierOf([file('package.json', ['"left-pad": "1.0.0"'])]), 'basic', 'a dependency change alone');
  assert.equal(tierOf([file('db/migrations/001.sql', ['CREATE TABLE t (id int);'], [], { status: 'added' })]), 'maximum', 'migration');
  assert.equal(tierOf([file('src/billing/sum.js', ['await db.query("DELETE FROM orders")'])]), 'maximum', 'data deletion');
  assert.equal(tierOf([file('src/auth/login.js', ['if (!user.isAdmin) return;', 'const password = req.body.password;'])]), 'maximum', 'auth code');
  assert.equal(tierOf([file('src/ui/form.js', ['label: "password"'])]), 'standard', 'security word outside security paths: group, not Maximum');
  assert.equal(tierOf([file('src/cart.js', ['const gross = item.price * qty;']), file('src/auth/x.js', ['// note'])]), 'standard', 'money and a security path in different files: not Maximum');
  assert.equal(tierOf([file('src/payment-refund.js', ['const amount = order.total;'])]), 'maximum', 'money in a security-path file');
  const inTest = analyze({ files: [file('src/search.js', ['find()']), file('test/search.spec.js', ["addTask({ title: 'Invoice page', password: 'x' })"])], sizes: {} }, PROFILE, CONFIG);
  assert.equal(inTest.groups.security, undefined, 'money or security words in a test do not call the security group');
  const big = Array.from({ length: 1000 }, (_, i) => `x${i}()`);
  assert.equal(tierOf([file('src/billing/sum.js', big)]), 'maximum', 'very large change');
  assert.equal(tierOf([file('src/billing/sum.js', big.slice(0, 400))]), 'standard', 'large change');
});

test('level proposal: core code suggests Maximum, with the threshold from the config', () => {
  const custom = { ...CONFIG, verification: { ...CONFIG.verification, tier_rules: { ...CONFIG.verification.tier_rules, core_fan_in: 3 } } };
  const one = [file('src/billing/sum.js', Array.from({ length: 11 }, (_, i) => `z${i}()`))];
  assert.equal(analyze({ files: one, sizes: {} }, PROFILE, custom).proposal.tier, 'basic');
  const core = analyze({ files: [file('src/billing/sum.js', ['return a - b;'])], sizes: {}, fan_in: { 'src/billing/sum.js': 7 } }, PROFILE, CONFIG);
  assert.equal(core.proposal.tier, 'maximum');
  assert.match(core.proposal.reasons[0], /^core code: src\/billing\/sum\.js: 7 files depend on it \(threshold 5\)$/);
  assert.deepEqual(core.core, { 'src/billing/sum.js': 7 });
  assert.equal(tierOf([file('src/billing/sum.js', ['return a - b;'])], {}, { 'src/billing/sum.js': 4 }), 'basic', 'below the default threshold 5');
  assert.equal(tierOf([file('src/billing/sum.js', ['// a comment only'])], {}, { 'src/billing/sum.js': 9 }), 'gates-only', 'no behavior change: fan-in does not matter');
  assert.equal(analyze({ files: one, sizes: {}, fan_in: { 'src/billing/sum.js': 3 } }, PROFILE, custom).proposal.tier, 'maximum', 'core_fan_in from the config');
  assert.deepEqual(verifierCaps(CONFIG), CONFIG.verification.verifier_caps);
});

test('fan-in: JS/TS, Python and PHP imports are counted per changed file; tests do not count', () => {
  assert.deepEqual(specifiers("import a from './a';\nconst b = require('../b');\nexport { c } from './c.js';\nimport('./d');\nimport './e';", 'js'), ['./a', './c.js', './e', '../b', './d']);
  assert.ok(pointsAt('../lib/util', 'src/app/x.ts', 'src/lib/util.ts', 'js'));
  assert.ok(pointsAt('./lib', 'src/x.js', 'src/lib/index.js', 'js'));
  assert.ok(!pointsAt('lodash', 'src/x.js', 'src/lodash.js', 'js'), 'packages are not project files');
  assert.ok(pointsAt('app.core.db', 'app/api/x.py', 'src/app/core/db.py', 'py'));
  assert.ok(pointsAt('.db', 'app/core/x.py', 'app/core/db.py', 'py'));
  assert.ok(pointsAt('..core.db', 'app/api/x.py', 'app/core/db.py', 'py'));
  assert.deepEqual(specifiers('from app.core import db, cache as c\nimport os, app.util', 'py'), ['app.core', 'app.core.db', 'app.core.cache', 'os', 'app.util']);
  assert.ok(pointsAt('App\\Models\\User', 'app/Http/C.php', 'app/Models/User.php', 'php'));
  assert.ok(pointsAt('../lib/db.php', 'public/index.php', 'lib/db.php', 'php'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-fanin-'));
  const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  put('src/core/db.js', 'module.exports = {};\n');
  for (const n of ['a', 'b', 'c']) put(`src/${n}.js`, "const db = require('./core/db');\n");
  put('src/d.ts', "import { q } from './core/db.js';\n");
  put('src/e.js', "const other = require('./core/dbx');\n");
  put('test/db.test.js', "require('../src/core/db');\n");
  put('app/core/db.py', 'x = 1\n');
  put('app/api/users.py', 'from app.core import db\n');
  const isTest = (p) => p.startsWith('test/');
  const r = fanIn(dir, ['src/core/db.js', 'app/core/db.py', 'README.md'], isTest);
  assert.deepEqual(r.counts, { 'src/core/db.js': 4, 'app/core/db.py': 1 });
});

test('analysis: groups get only touched topics; secrets and sizes are reported', () => {
  const a = analyze({
    files: [
      file('db/migrations/002.sql', ['ALTER TABLE t ADD c int;'], [], { status: 'added' }),
      file('.env', [], [], { status: 'added', secret: true }),
      file('docs/guide.md', ['text']),
      file('src/big.js', ['x()']),
    ],
    sizes: { 'src/big.js': { now: 1200, before: 900 }, 'docs/guide.md': { now: 10, before: 9 } },
  }, PROFILE, CONFIG);
  assert.deepEqual(a.groups.data.topics, ['database', 'performance']);
  assert.deepEqual(a.groups.docs.topics, ['docs']);
  assert.equal(a.groups.env, undefined);
  assert.deepEqual(a.sizes, [{ path: 'src/big.js', lines: 1200, before: 900, level: 'over max', grew: 300 }]);
  assert.ok(!a.new_files.includes('.env') && !a.new_files.some((p) => p.includes('migrations')), 'secrets and migrations are not architecture signals');
});

test('lineup follows plan 10.3 and 10.4', () => {
  const analysis = { groups: { data: { topics: ['database'] }, docs: { topics: ['docs'] }, env: { topics: ['dependencies'] } }, sizes: [], architect_signal: [] };
  const names = (l) => l.agents.map((a) => `${a.agent}:${a.model}:${a.phase}`);
  const std = lineup('standard', analysis);
  assert.deepEqual(names(std), ['context:haiku:4', 'reviewer:sonnet:5a', 'bug-hunter:sonnet:5a', 'architect:sonnet:5a', 'data:sonnet:5a', 'env:sonnet:5a', 'docs:sonnet:5a', 'qa:sonnet:5b', 'test-reviewer:sonnet:5b']);
  assert.deepEqual(std.verifier_models, { default: 'sonnet', 'bug-hunter': 'opus', security: 'opus' });
  assert.equal(lineup('standard', { ...analysis, architect_signal: ['new file x'] }).agents.find((a) => a.agent === 'architect').model, 'opus');
  const max = lineup('maximum', analysis);
  assert.deepEqual(names(max).filter((n) => /bug-hunter|security|qa/.test(n)), ['bug-hunter:opus:5a', 'bug-hunter:opus:5a', 'security:opus:5a', 'qa:opus:5b', 'qa-break:sonnet:5b']);
  assert.equal(max.agents.filter((a) => ['security', 'data', 'env', 'docs'].includes(a.agent)).length, 4, 'security always, cap 4');
  assert.equal(max.judge, 'opus');
  assert.deepEqual(lineup('gates-only', analysis).agents, []);
  assert.ok(!names(max).some((n) => n.startsWith('reviewer')), 'Maximum has two Opus bug hunters instead');
  const basic = lineup('basic', analysis);
  assert.deepEqual(names(basic), ['reviewer:haiku:5a'], 'Basic: the Haiku reviewer only, no groups even when triggered');
  assert.equal(basic.judge, 'session');
  assert.deepEqual(basic.verifier_models, { default: 'sonnet' });
  assert.equal(basic.estimate, '≈$0.25-0.5');
  assert.deepEqual(lineup('quick', analysis), basic, 'the word quick means Basic');
});

test('lineup: on Standard and Maximum the docs group reviews comments when code changed; Basic does not', () => {
  const code = { groups: { data: { topics: ['database'] } }, behavior_files: 2, sizes: [], architect_signal: [] };
  const docsOf = (l) => l.agents.find((a) => a.agent === 'docs');
  assert.deepEqual(docsOf(lineup('standard', code)).topics, ['comments']);
  assert.deepEqual(docsOf(lineup('standard', { ...code, groups: { docs: { topics: ['docs'] } } })).topics, ['docs', 'comments']);
  assert.deepEqual(docsOf(lineup('maximum', code)).topics, ['comments']);
  assert.equal(docsOf(lineup('basic', code)), undefined);
  assert.equal(docsOf(lineup('standard', { ...code, behavior_files: 0 })), undefined, 'text-only change: no comment review');
  assert.equal(code.groups.docs, undefined, 'the analysis is not changed');
});

// Each finding sits at its own line unless a test places it ("same place" groups share a verifier).
let nextLine = 1;
const LENSES_EXPECTED = ['reachability', 'impact', 'defenses'].map((lens) => [lens, ['security-1', 'bug-hunter-1']]);
const finding = (id, severity, extra = {}) => ({
  id, topic: 'logic', severity, what: `what ${id}`, problem: 'p', fix: 'f', if_not_fixed: 'i',
  locations: [{ file: extra.file || 'src/a.js', line: extra.line || (nextLine += 10) }], evidence: 'e', ...(extra.reproduce ? { reproduce: extra.reproduce } : {}),
});
const reportOf = (agent, findings) => ({ file: `${agent}.md`, json: { agent, status: 'complete', topics: [{ topic: 'logic', checked: 'x' }], findings } });

test('extractJson: fenced block first, then the outer braces; garbage gives null', () => {
  assert.deepEqual(extractJson('text\n```json\n{"a": 1}\n```\nmore'), { a: 1 });
  assert.deepEqual(extractJson('Here: {"b": {"c": 2}} done'), { b: { c: 2 } });
  assert.equal(extractJson('no json here'), null);
  assert.deepEqual(extractJson(String.raw`{"checked": "ESCAPE '\' and \\ and \n stay"}`), { checked: "ESCAPE '\\' and \\ and \n stay" }, 'an unknown escape is kept as a backslash');
});

test('extractJson: Windows paths in a reply that needs repair keep their backslashes; \\n stays a newline', () => {
  assert.deepEqual(extractJson(String.raw`{"what": "path src\utils\x.js breaks"}`), { what: 'path src\\utils\\x.js breaks' }, '\\u without 4 hex digits');
  assert.deepEqual(extractJson(String.raw`{"what": "src\tests\a.js and src\routes\books.js\nnext line"}`), { what: 'src\\tests\\a.js and src\\routes\\books.js\nnext line' });
  assert.deepEqual(extractJson(String.raw`{"what": "A \x \t1"}`), { what: 'A \\x \t1' }, 'real \\u and a tab before a non-letter stay escapes');
  assert.deepEqual(extractJson(String.raw`{"what": "src\tests"}`), { what: 'src\tests' }, 'valid JSON is never repaired');
});

test('verifier plan: proven and minor skip verification; critical first; important batched by folder; cap respected', () => {
  const reports = [
    reportOf('qa', [finding('qa-1', 'critical', { reproduce: 'curl -X POST /x' }), finding('qa-2', 'important')]),
    reportOf('bug-hunter', [finding('bug-hunter-1', 'critical'), finding('bug-hunter-2', 'important', { file: 'src/a.js' }), finding('bug-hunter-3', 'important', { file: 'src/b.js' }), finding('bug-hunter-4', 'minor')]),
    reportOf('docs', [finding('docs-1', 'important', { file: 'docs/x.md' })]),
  ];
  const plan = makePlan(reports, 'standard', 3, { default: 'sonnet', 'bug-hunter': 'opus', security: 'opus' });
  assert.deepEqual(plan.proven, ['qa-1']);
  assert.deepEqual(plan.minor, ['bug-hunter-4']);
  assert.deepEqual(plan.launches.map((l) => [l.model, l.lens, l.findings]), [
    ['opus', 'general', ['bug-hunter-1']],
    ['sonnet', 'general', ['qa-2']],
    ['opus', 'general', ['bug-hunter-2', 'bug-hunter-3']],
  ]);
  assert.deepEqual(plan.unverified, [{ id: 'docs-1', reason: 'verifier cap (3) reached' }]);
});

test('verifier plan at Quick: the reviewer findings go to Sonnet verifiers, cap 2; minor ones are not verified', () => {
  const plan = makePlan([reportOf('reviewer', [finding('reviewer-1', 'critical'), finding('reviewer-2', 'important', { file: 'src/q.js' }), finding('reviewer-3', 'important', { file: 'lib/z.js' }), finding('reviewer-4', 'minor')])], 'quick', 2, { default: 'sonnet' });
  assert.deepEqual(plan.launches.map((l) => [l.model, l.findings]), [['sonnet', ['reviewer-1']], ['sonnet', ['reviewer-2']]]);
  assert.deepEqual(plan.minor, ['reviewer-4']);
  assert.deepEqual(plan.unverified, [{ id: 'reviewer-3', reason: 'verifier cap (2) reached' }]);
});

test('verifier plan: findings at one place share a launch; one at a QA-proven place is not verified again', () => {
  const plan = makePlan([
    reportOf('qa', [finding('qa-1', 'important', { file: 'src/t.js', line: 157, reproduce: 'node -e x' })]),
    reportOf('bug-hunter', [finding('bug-hunter-1', 'important', { file: 'src/t.js', line: 159 }), finding('bug-hunter-2', 'important', { file: 'README.md', line: 33 }), finding('bug-hunter-3', 'critical', { file: 'src/t.js', line: 158 })]),
    reportOf('docs', [finding('docs-1', 'important', { file: 'README.md', line: 34 }), finding('docs-2', 'important', { file: 'test/r.js', line: 20 })]),
    reportOf('test-reviewer', [finding('test-reviewer-1', 'important', { file: 'test/r.js', line: 21 })]),
  ], 'standard', 5, { default: 'sonnet' });
  assert.deepEqual(plan.unverified, [{ id: 'bug-hunter-1', reason: 'same place as qa-1, which QA proved by running it' }]);
  assert.deepEqual(plan.launches.map((l) => l.findings), [['bug-hunter-3'], ['bug-hunter-2', 'docs-1'], ['docs-2', 'test-reviewer-1']], 'a critical finding next to a proven one is still verified');
  const crit = makePlan([reportOf('security', [finding('security-1', 'critical', { file: 'src/x.js', line: 6 })]), reportOf('bug-hunter', [finding('bug-hunter-1', 'critical', { file: 'src/x.js', line: 7 })])], 'maximum', 8, { default: 'opus' });
  assert.deepEqual(crit.launches.map((l) => [l.lens, l.findings]), LENSES_EXPECTED, 'one critical issue reported twice: three lenses, each judging both');
});

test('verifier plan and verdict schema agree: one issue from four agents is one launch, and its four verdicts count', () => {
  const at = (id) => finding(id, 'critical', { file: 'db/migrations/002.sql', line: 15 });
  const plan = makePlan([reportOf('bug-hunter', [at('bug-hunter-1')]), reportOf('data', [at('data-1')]), reportOf('docs', [at('requirements-1')]), reportOf('qa', [at('qa-1')])], 'maximum', 8, { default: 'opus' });
  assert.ok(plan.launches.every((l) => l.findings.length === 4), 'one group of four, three lenses');
  const verdict = (id, lens) => ({ finding_id: id, lens, restatement: 'r', verdict: 'CONFIRMED', evidence: [{ file: 'db/migrations/002.sql', line: 15, note: 'n' }], reasoning: 'x' });
  const replies = plan.launches.map((l) => ({ file: `verifier-${l.id}.md`, json: { verifier: l.id, verdicts: l.findings.map((id) => verdict(id, l.lens)) } }));
  const r = tally(plan, replies);
  assert.deepEqual(r.invalid, [], 'a verifier answering a whole group is valid (phase 8: the schema allowed 3 and dropped three CONFIRMED reports)');
  assert.equal(r.confirmed.length, 4);
});

test('one faulty item does not drop a report: unknown fields are dropped, a bad finding or verdict is left out alone', () => {
  const qa = reportOf('qa', [finding('qa-1', 'important', { reproduce: 'node -e x' }), finding('qa-2', 'important'), finding('qa-3', 'important')]);
  qa.json.findings[0].note = 'an extra field';
  delete qa.json.findings[1].locations[0].line;
  const plan = makePlan([qa], 'standard', 5, { default: 'sonnet' });
  assert.deepEqual(plan.proven, ['qa-1'], 'the QA proof survives (phase 8: one location without a line emptied "proven")');
  assert.deepEqual(Object.keys(plan.findings), ['qa-1', 'qa-3']);
  assert.equal(plan.findings['qa-1'].note, undefined);
  assert.deepEqual(plan.repaired, [{ file: 'qa.md', dropped: ['$.findings[0].note'] }]);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.invalid[0].item, 'qa-2');
  assert.match(plan.invalid[0].errors[0], /missing "line"/);

  const verdict = (id, extra = {}) => ({ finding_id: id, lens: 'general', restatement: 'r', verdict: 'CONFIRMED', evidence: [{ file: 'src/a.js', line: 1, note: 'n', ...extra }], reasoning: 'x' });
  const two = makePlan([reportOf('bug-hunter', [finding('bug-hunter-1', 'important', { file: 'src/v.js', line: 5 }), finding('bug-hunter-2', 'important', { file: 'src/v.js', line: 40 })])], 'standard', 5, { default: 'sonnet' });
  const id = two.launches[0].id;
  const r = tally(two, [{ file: 'verifier-x.md', json: { verifier: id, verdicts: [verdict('bug-hunter-1', { evidence_note: 'extra' }), { finding_id: 'bug-hunter-2', verdict: 'CONFIRMED' }] } }]);
  assert.deepEqual(r.confirmed.map((f) => f.id), ['bug-hunter-1'], 'a verdict with an extra field still counts');
  assert.deepEqual(r.unverified.map((u) => u.id), ['bug-hunter-2']);
  assert.equal(r.invalid[0].item, 'bug-hunter-2');
  assert.deepEqual(r.repaired[0].dropped, ['$.verdicts[0].evidence[0].evidence_note']);
  const emptyField = { ...finding('reviewer-1', 'important'), reproduce: '' };
  const empty = makePlan([reportOf('reviewer', [emptyField])], 'quick', 2, { default: 'sonnet' });
  assert.deepEqual(Object.keys(empty.findings), ['reviewer-1'], 'an empty optional field is dropped, not the finding');
  assert.deepEqual(empty.repaired, [{ file: 'reviewer.md', dropped: ['$.findings[0].reproduce'] }]);
  const broken = makePlan([{ file: 'docs-a.md', json: { agent: 'docs', findings: [] } }], 'basic', 3, { default: 'sonnet' });
  assert.match(broken.invalid[0].errors.join(' '), /missing "status"/, 'a broken frame still invalidates the report');
  const noIds = reportOf('reviewer', [finding('reviewer-1', 'important', { file: 'src/n.js', line: 3 }), finding('x', 'important', { file: 'src/n.js', line: 30 }), finding('reviewer-3', 'important', { file: 'src/m.js', line: 9 })]);
  delete noIds.json.findings[1].id;
  noIds.json.findings[2].id = 'Finding 3';
  const named = makePlan([noIds], 'quick', 2, { default: 'sonnet' });
  assert.deepEqual(Object.keys(named.findings), ['reviewer-1', 'reviewer-2', 'reviewer-3'], 'a finding without a usable id gets one and is verified, not left out');
  assert.deepEqual(named.invalid, []);
  assert.deepEqual(named.repaired, [{ file: 'reviewer.md', ids: ['reviewer-2', 'reviewer-3'] }]);
});

test('verifier plan on Maximum: three lenses while the cap allows, then one vote, then not verified', () => {
  const crit = (n) => reportOf('security', Array.from({ length: n }, (_, i) => finding(`security-${i + 1}`, 'critical')));
  const full = makePlan([crit(2)], 'maximum', 8, { default: 'opus' });
  assert.equal(full.launches.length, 6);
  assert.deepEqual(full.launches.slice(0, 3).map((l) => l.lens), ['reachability', 'impact', 'defenses']);
  const tight = makePlan([crit(4)], 'maximum', 8, { default: 'opus' });
  assert.deepEqual(tight.launches.map((l) => l.findings[0]), ['security-1', 'security-1', 'security-1', 'security-2', 'security-2', 'security-2', 'security-3', 'security-4']);
  assert.deepEqual(tight.one_vote, ['security-3', 'security-4']);
  const over = makePlan([crit(3)], 'maximum', 2, { default: 'opus' });
  assert.deepEqual(over.unverified.map((u) => u.id), ['security-3']);
});

test('verifier plan: duplicate ids from two agents of one type stay distinct; invalid reports are listed', () => {
  const plan = makePlan([reportOf('bug-hunter', [finding('bug-hunter-1', 'important')]), reportOf('bug-hunter', [finding('bug-hunter-1', 'important')]),
    { file: 'bad.md', json: { agent: 'data', status: 'complete', topics: [], findings: [{ id: 'data-1' }] } }], 'standard', 5, { default: 'sonnet' });
  assert.deepEqual(Object.keys(plan.findings), ['bug-hunter-1', 'bug-hunter-r2-1']);
  assert.equal(plan.invalid[0].file, 'bad.md');
  const prose = makePlan([{ file: 'docs-a1b2c3.md', json: null }, { file: 'verifier-d4e5.md', json: null }, { file: 'context-f6.md', json: null }], 'basic', 3, { default: 'sonnet' });
  assert.deepEqual(prose.invalid, [{ file: 'docs-a1b2c3.md', errors: ['no JSON report (prose only)'] }], 'a search agent without JSON is listed; other agents are not');
});

test('tally: 2 of 3 decides on Maximum, single verdicts count as given, missing verdicts are reported', () => {
  const plan = makePlan([reportOf('security', [finding('security-1', 'critical'), finding('security-2', 'critical')]), reportOf('data', [finding('data-1', 'important')])], 'maximum', 8, { default: 'opus' });
  const v = (verifier, id, verdict, lens) => ({ file: `${verifier}.md`, json: { verifier, verdicts: [{ finding_id: id, lens, restatement: 'r', verdict, evidence: [{ file: 'src/a.js', line: 1, note: 'n' }], reasoning: 'x' }] } });
  const replies = [
    v('v1', 'security-1', 'CONFIRMED', 'reachability'), v('v2', 'security-1', 'REFUTED', 'impact'), v('v3', 'security-1', 'CONFIRMED', 'defenses'),
    v('v4', 'security-2', 'CONFIRMED', 'reachability'), v('v5', 'security-2', 'UNCLEAR', 'impact'), v('v6', 'security-2', 'REFUTED', 'defenses'),
  ];
  const r = tally(plan, replies);
  assert.deepEqual(r.confirmed.map((f) => f.id), ['security-1']);
  assert.deepEqual(r.unclear.map((f) => f.id), ['security-2']);
  assert.deepEqual(r.unverified.map((u) => [u.id, u.reason]), [['data-1', 'the verifier returned no verdict for it']]);
  assert.equal(r.confirmed[0].votes.length, 3);
});

test('ledger: last usage row per message id; output estimated when the transcript under-records it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-ledger-'));
  const t = path.join(dir, 'agent.jsonl');
  const row = (id, usage, content) => JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', model: 'claude-sonnet-5-5', usage, content } });
  fs.writeFileSync(t, [
    row('m1', { input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }, [{ type: 'text', text: 'hi' }]),
    row('m1', { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }, [{ type: 'tool_use', input: { a: 1 } }]),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
    'not json',
    row('m2', { input_tokens: 1, output_tokens: 7, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 0 } }, [{ type: 'tool_use', input: { report: 'x'.repeat(4000) } }]),
  ].join('\n'));
  const s = summarize(t);
  assert.equal(s.requests, 2);
  assert.equal(s.model, 'claude-sonnet-5-5');
  assert.deepEqual([s.usage.input_tokens, s.usage.cache_read_input_tokens, s.usage.cache_creation_input_tokens], [4, 1100, 50]);
  assert.equal(s.usage.output_tokens, 40 + Math.ceil(JSON.stringify({ report: 'x'.repeat(4000) }).length / 4));
  assert.equal(s.estimated, true);
});

function runLedgerHook(input, env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  return spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'ledger.js')], { input: JSON.stringify(input), env: { ...clean, ...env }, encoding: 'utf8' });
}

test('ledger hook: writes a valid ledger line and saves keel agent replies; silent outside keel projects', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-proj-'));
  const transcript = path.join(project, 't.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ message: { id: 'm', role: 'assistant', model: 'claude-haiku-5-5', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }, content: [] } }));
  const input = { session_id: 's', agent_id: 'abc', agent_type: 'keel:context', agent_transcript_path: transcript, last_assistant_message: '# Context map\n- src/a.js', effort: { level: 'high' }, cwd: project };
  let r = runLedgerHook(input, {});
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(!fs.existsSync(path.join(project, '.keel')), 'no .keel folder → nothing written');
  fs.mkdirSync(path.join(project, '.keel'));
  r = runLedgerHook(input, { CLAUDE_PROJECT_DIR: project });
  assert.equal(r.status, 0);
  const line = JSON.parse(fs.readFileSync(path.join(project, '.keel', 'local', 'ledger.jsonl'), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'ledger-entry.schema.json'), 'utf8'));
  assert.deepEqual(validate(line, schema), []);
  assert.equal(line.effort, 'high');
  assert.equal(fs.readFileSync(path.join(project, '.keel', 'local', 'tmp', 'agents', 'context-abc.md'), 'utf8'), input.last_assistant_message);
  assert.ok(fs.existsSync(path.join(project, '.keel', 'local', 'tmp', 'context-map.md')));
  assert.equal(runLedgerHook('garbage', { CLAUDE_PROJECT_DIR: project }).status, 0, 'garbage never breaks the agent');
});

test('ledger report: list-price estimate per agent and total', () => {
  const e = { agent_type: 'keel:qa', model: 'claude-sonnet-5-5', effort: 'high', requests: 3, output_estimated: true,
    usage: { input_tokens: 0, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6, cache_creation_1h_input_tokens: 1e6 } };
  assert.equal(cost(e), 10 + 0.1 + 4);
  assert.equal(cost({ ...e, model: 'mystery' }), null);
  const text = report([e]);
  assert.match(text, /qa \(sonnet, high\): 3 requests/);
  assert.match(text, /output ~1\.00M/);
  assert.match(text, /total: 1 agents, \$14\.10/);
});

test('ledger report re-sums a transcript that grew after the hook ran', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-refresh-'));
  const t = path.join(dir, 'agent.jsonl');
  const row = (id, out) => JSON.stringify({ message: { id, role: 'assistant', model: 'claude-sonnet-5-5', usage: { input_tokens: 1, output_tokens: out, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 }, content: [] } });
  fs.writeFileSync(t, [row('m1', 5), row('m2', 900)].join('\n'));
  const { refresh } = require(path.join(SCRIPTS, 'ledger-report.js'));
  const hookTime = { agent_type: 'keel:verifier', model: 'claude-sonnet-5-5', requests: 1, transcript: t, usage: { input_tokens: 1, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } };
  const r = refresh(hookTime);
  assert.equal(r.requests, 2);
  assert.equal(r.usage.output_tokens, 905);
  assert.deepEqual(refresh({ ...hookTime, transcript: path.join(dir, 'missing.jsonl') }), { ...hookTime, transcript: path.join(dir, 'missing.jsonl') });
});

test('hooks.json registers the ledger on SubagentStop for every agent type', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const h = cfg.SubagentStop[0];
  assert.equal(h.matcher, undefined);
  assert.deepEqual([h.hooks[0].command, ...h.hooks[0].args], ['node', '${CLAUDE_PLUGIN_ROOT}/hooks/ledger.js']);
});

function gitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-verify-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(dir, '.keel', '.gitignore'), 'local/\n');
  fs.mkdirSync(path.join(dir, 'src', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'billing', 'sum.js'), 'function add(a, b) {\n  return a + b;\n}\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  return dir;
}
const node = (script, ...args) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });

test('changes.js end to end: summary, files for agents, secrets never in the diff', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  assert.match(node('changes.js', dir), /proposal: none/);
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), 'function sub(a, b) { return a - b; }\n');
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=super-secret-value\n');
  // A previous run's re-run results must not judge this run's findings (ids like qa-1 repeat).
  fs.mkdirSync(path.join(dir, '.keel', 'local', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.keel', 'local', 'tmp', 'reproduce.json'), '{"qa-1":"not reproduced"}');
  const out = node('changes.js', dir, '--start');
  assert.ok(!fs.existsSync(path.join(dir, '.keel', 'local', 'tmp', 'reproduce.json')), 'a new run starts without old re-runs');
  assert.match(out, /changes: 2 files/);
  assert.match(out, /\.env \(added, secret\)/);
  assert.match(out, /proposal: basic/);
  assert.match(out, /^basic: reviewer:haiku, verifiers up to 3, judge session/m);
  const diff = fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'changes.diff'), 'utf8');
  assert.match(diff, /\+function sub/);
  assert.ok(!diff.includes('super-secret-value'), 'secret content never reaches agents');
  assert.ok(fs.existsSync(path.join(dir, '.keel', 'local', 'tmp', 'verify-run.json')));
  const json = JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'changes.json'), 'utf8'));
  assert.equal(json.levels.standard.judge, 'sonnet');
  assert.doesNotMatch(out, /scanners:/, 'no scanner configured, nothing to report');

  // A configured scanner whose program is not on PATH is reported for the loud warning; leading
  // NAME=value words are not the program.
  const scanners = [
    { name: 'nosuchscan', command: 'nosuchscan-keel-test detect' },
    { name: 'node', command: 'node --version' },
    { name: 'in-docker', command: 'MSYS_NO_PATHCONV=1 node -e 1' },
    { name: 'env-missing', command: 'A=1 B="x y" nosuchscan-keel-test detect' },
  ];
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify({ ...CONFIG, gates: { checks: [], security_scanners: scanners } }));
  assert.match(node('changes.js', dir), /scanners: not installed: nosuchscan, env-missing \(skip them; loud warning in the report\)/);
});

test('changes.js: a scanner given as a path is found from the project folder, not on PATH', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), 'function sub(a, b) { return a - b; }\n');
  fs.writeFileSync(path.join(dir, 'gradlew'), '#!/bin/sh\n');
  fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.venv', 'bin', 'bandit'), '#!/bin/sh\n');
  const scanners = [
    { name: 'wrapper', command: './gradlew dependencyCheckAnalyze' },
    { name: 'venv', command: '.venv/bin/bandit -r src' },
    { name: 'windows-path', command: '.venv\\bin\\bandit -r src' },
    { name: 'no-wrapper', command: './nowrapper scan' },
  ].filter((s) => process.platform === 'win32' || s.name !== 'windows-path');
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify({ ...CONFIG, gates: { checks: [], security_scanners: scanners } }));
  assert.match(node('changes.js', dir), /^scanners: not installed: no-wrapper \(/m);
});

test('changes.js without a config or outside git explains and exits 0', (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-empty-'));
  assert.match(node('changes.js', empty), /changes: unavailable \(keel is not configured here/);
  if (!hasGit) { t.skip('git is not installed'); return; }
  fs.mkdirSync(path.join(empty, '.keel'));
  fs.writeFileSync(path.join(empty, '.keel', 'config.json'), JSON.stringify(CONFIG));
  assert.match(node('changes.js', empty), /changes: unavailable \(not a git repository\)/);
});

test('changes.js: untracked files from before the task are left out unless they change', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  fs.writeFileSync(path.join(dir, 'draft.js'), 'const old = 1;\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'old notes\n');
  // No record yet: every untracked file counts, and the overview says so.
  assert.match(node('changes.js', dir), /untracked with no task-start record, all counted as this change: draft\.js; notes\.txt/);

  assert.match(node('notes.js', dir, 'check', '--begin'), /2 untracked files on record/);
  fs.writeFileSync(path.join(dir, 'src', 'billing', 'tax.js'), 'exports.tax = (n) => n / 5;\n');
  fs.appendFileSync(path.join(dir, 'notes.txt'), 'a line the task added\n');
  const out = node('changes.js', dir);
  assert.match(out, /changes: 2 files/);
  assert.match(out, /untracked before the task, not verified: draft\.js \(advise: commit them or add them to \.gitignore\)/);
  assert.match(out, /untracked before the task and changed since, verified whole: notes\.txt/);
  const diff = fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'changes.diff'), 'utf8');
  assert.ok(!diff.includes('const old'), 'an unchanged older file never reaches agents');
  assert.match(diff, /notes\.txt\nnew file \(untracked; it existed before the task and changed since/);

  // The user's word leaves a file out; a second --begin while the task is open keeps the first record.
  assert.match(node('changes.js', dir, '--skip', 'notes.txt'), /left out on the user's word: notes\.txt/);
  fs.mkdirSync(path.join(dir, '.keel', 'tasks', 'T-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.keel', 'tasks', 'T-1', 'task.md'), '---\nid: T-1\ntitle: Tax\nstatus: active\n---\n## Goal\nTax\n');
  node('notes.js', dir, 'check', '--begin');
  assert.match(node('changes.js', dir), /changes: 2 files/);
});

test('fingerprint: snapshot and compare catch any change; save marks the tree as verified', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), '// a\n');
  assert.match(node('fingerprint.js', dir, 'snapshot', 'before-5b'), /snapshot before-5b: 1 changed files/);
  assert.equal(node('fingerprint.js', dir, 'compare', 'before-5b').trim(), 'same');
  fs.writeFileSync(path.join(dir, 'tmp-output.txt'), 'left behind by an agent');
  assert.equal(node('fingerprint.js', dir, 'compare', 'before-5b').trim(), 'changed: tmp-output.txt');
  fs.rmSync(path.join(dir, 'tmp-output.txt'));
  node('fingerprint.js', dir, 'save', '--tier', 'basic');
  assert.match(node('changes.js', dir), /last verify: .* \(basic\) on this exact tree/);
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), '// b\n');
  assert.doesNotMatch(node('changes.js', dir), /last verify/);
});

test('fingerprint: committing the verified work keeps it verified; a later edit does not', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('branch', '-M', 'main');
  g('switch', '-q', '-c', 'task');
  const { unverified } = require(path.join(SCRIPTS, 'fingerprint.js'));
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), 'function sub(a, b) { return a - b; }\n');
  fs.writeFileSync(path.join(dir, 'src', 'billing', 'new.js'), 'module.exports = 1;\n');
  node('fingerprint.js', dir, 'save', '--tier', 'basic');
  assert.equal(unverified(dir), null);
  g('add', '-A');
  g('commit', '-qm', 'the verified work');
  assert.equal(unverified(dir), null, 'the same content, now committed');
  assert.match(node('changes.js', dir, '--base', 'main'), /last verify: .* \(basic\)/);
  fs.appendFileSync(path.join(dir, 'src', 'billing', 'sum.js'), 'module.exports = { add, sub };\n');
  assert.match(unverified(dir), /^the work changed after the verification at .* \(basic\)$/);
  assert.doesNotMatch(node('changes.js', dir, '--base', 'main'), /last verify/);
  g('add', '-A');
  g('commit', '-qm', 'more');
  assert.match(unverified(dir), /^the work changed after the verification/, 'a commit of new code is still a change');
});

test('votes.js end to end: plan writes one task per verifier, tally reads verdicts from agent replies', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  const agents = path.join(dir, '.keel', 'local', 'tmp', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'bug-hunter-a1.md'), `Report:\n\`\`\`json\n${JSON.stringify(reportOf('bug-hunter', [finding('bug-hunter-1', 'critical')]).json)}\n\`\`\``);
  const plan = node('votes.js', dir, 'plan', '--tier', 'basic');
  assert.match(plan, /v1: sonnet, lens general, bug-hunter-1/);
  const task = JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'verify-tasks', 'v1.json'), 'utf8'));
  assert.equal(task.findings[0].id, 'bug-hunter-1');
  fs.writeFileSync(path.join(agents, 'verifier-b2.md'), JSON.stringify({ verifier: 'v1', verdicts: [{ finding_id: 'bug-hunter-1', lens: 'general', restatement: 'r', verdict: 'REFUTED', evidence: [{ file: 'src/billing/sum.js', line: 2, note: 'guarded' }], reasoning: 'x' }] }));
  assert.match(node('votes.js', dir, 'tally'), /tally: 0 confirmed, 1 refuted/);
});

test('votes.js plan with no search agent reply says nothing was read, never "no findings"', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = gitProject();
  let plan = node('votes.js', dir, 'plan', '--tier', 'basic');
  assert.match(plan, /^plan: no search agent replies read .*not a clean result/);
  assert.doesNotMatch(plan, /no findings|0 findings/);
  const agents = path.join(dir, '.keel', 'local', 'tmp', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'context-a1.md'), '# Context map\n');
  assert.match(node('votes.js', dir, 'plan', '--tier', 'basic'), /not a clean result/, 'a context map is no search');
  fs.writeFileSync(path.join(agents, 'reviewer-a2.md'), JSON.stringify(reportOf('reviewer', []).json));
  plan = node('votes.js', dir, 'plan', '--tier', 'basic');
  assert.match(plan, /^plan: 0 findings/);
  assert.match(plan, /^no findings$/m);
});

test('tally: a QA finding is proven only while its reproduce command still fails when the session runs it again', () => {
  const plan = makePlan([reportOf('qa', [
    finding('qa-1', 'important', { file: 'src/a.js', reproduce: 'node -e a' }),
    finding('qa-2', 'important', { file: 'src/b.js', reproduce: 'node -e b' }),
    finding('qa-3', 'important', { file: 'src/c.js', reproduce: 'node -e c' }),
  ])], 'basic', 3, { default: 'sonnet' });
  assert.deepEqual(plan.proven, ['qa-1', 'qa-2', 'qa-3']);
  const r = tally(plan, [], { 'qa-1': 'reproduced', 'qa-2': 'not reproduced' });
  assert.deepEqual(r.proven.map((f) => [f.id, f.notes[0]]), [['qa-1', 'reproduced again by the session'], ['qa-3', 'not run again']]);
  assert.deepEqual(r.unclear.map((f) => f.id), ['qa-2'], 'a claim that did not reproduce is not shown as proven');
  assert.match(r.unclear[0].notes[0], /did not show the problem/);
  assert.deepEqual(tally(plan, []).proven.map((f) => f.id), ['qa-1', 'qa-2', 'qa-3'], 'no re-run file: as before, marked "not run again"');
});
