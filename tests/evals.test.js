'use strict';
// The behaviour eval suite (plugins/keel/evals, run with `npm run eval`): every case loads, every
// fixture variant builds the project its cases expect. The runs themselves cost money and are not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const EVALS = path.join(PLUGIN, 'evals');
const SHOP = path.join(EVALS, '_fixtures', 'shop.js');
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const cases = fs.readdirSync(EVALS).filter((n) => fs.existsSync(path.join(EVALS, n, 'prompt.md')));
const front = (file) => {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file}: front matter`);
  return { keys: Object.fromEntries(m[1].split('\n').map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((x) => [x[1], x[2]])), body: m[2].trim() };
};

test('every eval case has a prompt, graders of known types and, when it needs a project, a fixture variant that exists', () => {
  assert.ok(cases.length >= 12, `${cases.length} cases`);
  const PROMPT_KEYS = new Set(['model', 'runs', 'max_turns', 'timeout_seconds', 'allowed_tools', 'tags']);
  for (const name of cases) {
    const dir = path.join(EVALS, name);
    const p = front(path.join(dir, 'prompt.md'));
    for (const k of Object.keys(p.keys)) assert.ok(PROMPT_KEYS.has(k), `${name}: prompt.md key ${k}`);
    assert.equal(p.keys.model, 'sonnet', name);
    // A case tagged standards gives a plain request: it checks the coding standards keel adds to every
    // conversation, not a command.
    if (/\bstandards\b/.test(p.keys.tags || '')) assert.doesNotMatch(p.body, /^\/keel:/, `${name}: a plain request`);
    else assert.match(p.body, /^\/keel:/, `${name}: the prompt is a keel command`);
    const graders = fs.readdirSync(path.join(dir, 'graders'));
    assert.ok(graders.length, `${name}: graders`);
    for (const g of graders) {
      const { keys } = front(path.join(dir, 'graders', g));
      assert.ok(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm'].includes(keys.type), `${name}/${g}: type ${keys.type}`);
      for (const re of [keys.pattern, keys.input_match].filter(Boolean)) new RegExp(re.replace(/^'|'$/g, '')); // compiles
    }
    if (fs.existsSync(path.join(dir, 'case.yaml'))) {
      const yaml = fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8');
      assert.match(yaml, /^schema_version: "1\.1"$/m, name);
      assert.match(yaml, new RegExp(`^name: ${name}$`, 'm'), name);
      assert.match(yaml, /scaffold_script: fixture\.sh/, name);
      assert.match(fs.readFileSync(path.join(dir, 'fixture.sh'), 'utf8'), /node "\$\(dirname "\$0"\)\/\.\.\/_fixtures\/shop\.js" (base|tasks|finish|session|messy|overbuilt)\n$/, name);
    }
  }
});

test('the shop fixture builds each variant with git, a remote inside the workspace and trust only in the run\'s home', { skip: !hasGit && 'git is not installed' }, () => {
  const expect = { base: ['main', 0, ''], tasks: ['main', 0, ''], finish: ['CAN-200-free-shipping', 1, ''], session: ['payments-rework', 0, 'M src/payment.js\n?? test/invoice.test.js'],
    messy: ['main', 0, ''], overbuilt: ['avg-total', 1, 'M src/cart.js\n M src/report.js\n?? test/report.test.js'] };
  for (const [variant, [branch, tasks, changed]] of Object.entries(expect)) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `keel-eval-${variant}-`));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-eval-home-'));
    const r = spawnSync(process.execPath, [SHOP, variant], { cwd: work, env: { ...process.env, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, `${variant}: ${r.stderr}`);
    const git = (...a) => execFileSync('git', ['-C', work, ...a], { encoding: 'utf8' }).trim();
    assert.equal(git('branch', '--show-current'), branch, variant);
    assert.equal(git('status', '--porcelain'), changed, `${variant}: the uncommitted work`);
    assert.match(git('remote', 'get-url', 'origin'), /eval-remote\.git$/);
    const dirs = fs.existsSync(path.join(work, '.keel', 'tasks')) ? fs.readdirSync(path.join(work, '.keel', 'tasks'), { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
    assert.equal(dirs.length, tasks, variant);
    assert.ok(fs.existsSync(path.join(home, '.claude', 'keel', 'trusted-git.json')), `${variant}: trust in the run's home`);
    const check = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'check-config.js'), work], { encoding: 'utf8' }).stdout;
    assert.match(check, /^keel-config: ok/, variant);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-eval-tasks-'));
  execFileSync(process.execPath, [SHOP, 'tasks'], { cwd: work, env: { ...process.env, HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'keel-eval-home-')) } });
  const listed = spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', 'notes.js'), work, 'tasks'], { encoding: 'utf8' }).stdout;
  assert.match(listed, /^tasks: 2 unfinished \((CAN-123, fix-reset-500|fix-reset-500, CAN-123)\)/);
});

test('npm run eval runs the suite once per release, never in CI by default', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.eval, /^claude plugin eval plugins\/keel .*--scaffold/);
  assert.match(pkg.scripts.eval, /--max-cost-usd \d+/);
  for (const wf of fs.readdirSync(path.join(__dirname, '..', '.github', 'workflows'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', wf), 'utf8'), /plugin eval|npm run eval/, wf);
  }
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^plugins\/keel\/evals\/results\/$/m);
});
