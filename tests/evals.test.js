'use strict';
// The behaviour eval suite (plugins/keel/evals, run with `npm run eval`): every case loads, every
// fixture variant builds the project its cases expect. The runs themselves cost money and are not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const EVALS = path.join(PLUGIN, 'evals');
const SHOP = path.join(EVALS, '_fixtures', 'shop.js');
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// The chat the planning cases resume: shop.js marks it, each case's history.jsonl keeps its id.
const SID = /^const SID = '([^']+)';$/m.exec(fs.readFileSync(SHOP, 'utf8'))[1];
const VARIANTS = ['base', 'tasks', 'finish', 'session', 'messy', 'overbuilt', 'planning', 'planning-openq', 'planning-ready', 'planning-repo', 'planning-new', 'planning-brief', 'planned', 'task-active'];

const tagList = (tags) => (tags || '').replace(/[[\]\s]/g, '').split(',');
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
    // conversation, not a command. One tagged lanes may also give a plain request or a bare /name: the
    // lane guards stop both; a command it names is one of keel's.
    const yaml = fs.existsSync(path.join(dir, 'case.yaml')) ? fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8') : '';
    if (/\bstandards\b/.test(p.keys.tags || '')) assert.doesNotMatch(p.body, /^\/keel:/, `${name}: a plain request`);
    // One tagged start-planning goes on in a planning conversation its history started: keel refuses
    // /keel:start-planning in every eval run, so the prompt is the person's next words.
    else if (tagList(p.keys.tags).includes('start-planning')) {
      assert.match(yaml, /^\s*history_file:/m, `${name}: resumes a written conversation`);
      assert.doesNotMatch(p.body, /^\//, `${name}: the person's words, not a command`);
    } else if (/\blanes\b/.test(p.keys.tags || '')) {
      const command = /^\/(?:keel:)?([a-z][a-z-]*)/.exec(p.body);
      if (p.body.startsWith('/')) assert.ok(command && fs.existsSync(path.join(PLUGIN, 'skills', command[1], 'SKILL.md')), `${name}: /${command ? command[1] : ''} is a keel command`);
    } else assert.match(p.body, /^\/keel:/, `${name}: the prompt is a keel command`);
    const graders = fs.readdirSync(path.join(dir, 'graders'));
    assert.ok(graders.length, `${name}: graders`);
    for (const g of graders) {
      const { keys } = front(path.join(dir, 'graders', g));
      assert.ok(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm'].includes(keys.type), `${name}/${g}: type ${keys.type}`);
      for (const re of [keys.pattern, keys.input_match].filter(Boolean)) new RegExp(re.replace(/^'|'$/g, '')); // compiles
    }
    if (yaml) {
      assert.match(yaml, /^schema_version: "1\.1"$/m, name);
      assert.match(yaml, new RegExp(`^name: ${name}$`, 'm'), name);
      assert.match(yaml, /scaffold_script: fixture\.sh/, name);
      assert.match(fs.readFileSync(path.join(dir, 'fixture.sh'), 'utf8'), new RegExp(`node "\\$\\(dirname "\\$0"\\)/\\.\\./_fixtures/shop\\.js" (${VARIANTS.join('|')})\\n$`), name);
      // A written conversation the run resumes: every line a JSON record of the chat shop.js marks.
      const history = /^\s*history_file:\s*["']?([^"'\s]+)["']?\s*$/m.exec(yaml);
      if (history) {
        const file = path.join(dir, history[1]);
        assert.ok(fs.existsSync(file), `${name}: ${history[1]} exists`);
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
        assert.ok(lines.length, `${name}: ${history[1]} has lines`);
        for (const [i, l] of lines.entries()) {
          let r;
          assert.doesNotThrow(() => { r = JSON.parse(l); }, `${name}: ${history[1]} line ${i + 1} is JSON`);
          assert.equal(r.sessionId, SID, `${name}: ${history[1]} line ${i + 1} is the chat shop.js marks`);
        }
      }
    }
  }
});

// A planning case's history holds /keel:start-planning as Claude Code expanded it, keel at /work/plugins/keel
// (the Docker command mounts the repository at /work): its steps must be the command's current ones.
test('a planning case resumes the current /keel:start-planning instructions', () => {
  const refresh = 'run node plugins/keel/evals/_fixtures/start-planning-history.js';
  const { CASES } = require(path.join(EVALS, '_fixtures', 'start-planning-history.js'));
  const steps = (text) => text.slice(text.indexOf('\n1. Read '));
  const skill = steps(fs.readFileSync(path.join(PLUGIN, 'skills', 'start-planning', 'SKILL.md'), 'utf8')).replaceAll('${CLAUDE_PLUGIN_ROOT}', '/work/plugins/keel');
  const planning = cases.filter((n) => tagList(front(path.join(EVALS, n, 'prompt.md')).keys.tags).includes('start-planning'));
  assert.ok(planning.length >= 2, planning.join(', '));
  assert.deepEqual(Object.keys(CASES).sort(), [...planning].sort(), 'the history builder writes every start-planning case');
  for (const name of planning) {
    const text = fs.readFileSync(path.join(EVALS, name, 'history.jsonl'), 'utf8');
    assert.equal(text, CASES[name](), `${name}: history.jsonl is stale: ${refresh}`);
    const records = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const expanded = records.find((r) => r.isMeta && Array.isArray(r.message.content) && /^Base directory for this skill: \/work\/plugins\/keel\/skills\/start-planning\n/.test(r.message.content[0].text));
    assert.ok(expanded, `${name}: start-planning expanded in the history`);
    // A resumed run sees only the history: the planning rules are there as the command read them.
    const reads = records.filter((r) => r.type === 'assistant').flatMap((r) => r.message.content).filter((b) => b.type === 'tool_use' && b.name === 'Read');
    assert.ok(reads.some((b) => b.input.file_path === '/work/plugins/keel/skills/_shared/planning.md'), `${name}: the history reads planning.md`);
    // keel's first reply states what its steps found; without their calls in the history the resumed
    // run takes those claims as unchecked and runs the steps (and the code search) again.
    const calls = records.slice(0, records.findIndex((r) => r.type === 'assistant' && r.message.stop_reason === 'end_turn'))
      .filter((r) => r.type === 'assistant').flatMap((r) => r.message.content).filter((b) => b.type === 'tool_use');
    const ran = (re) => calls.some((b) => b.name === 'Bash' && re.test(b.input.command));
    assert.ok(reads.some((b) => b.input.file_path === '/work/plugins/keel/skills/_shared/preflight.md'), `${name}: the history reads preflight.md`);
    assert.ok(ran(/scripts\/notes\.js" "\." check --session /), `${name}: the history runs the lane check`);
    assert.ok(calls.some((b) => b.name === 'Grep'), `${name}: the history checks the premise in the code`);
    assert.ok(ran(/scripts\/plans\.js" "\." new notification-system$/), `${name}: the history makes the draft`);
    assert.ok(ran(/scripts\/plans\.js" "\." mark set notification-system --session /), `${name}: the history marks the chat`);
    assert.match(expanded.message.content[0].text, /^- `<keel>` \(the plugin folder\): `\/work\/plugins\/keel`$/m, name);
    assert.equal(steps(expanded.message.content[0].text), skill, `${name}: the history's start-planning steps are not the command's`);
  }
});

const script = (name, work, ...a) => spawnSync(process.execPath, [path.join(PLUGIN, 'scripts', name), work, ...a], { encoding: 'utf8' }).stdout;

// A draft csv-export the chat SID plans, with nothing for /keel:end-planning to review again.
const draftState = (state, where) => (work) => {
  assert.match(script('plans.js', work, 'check', 'csv-export'), /^check: clean \(plan\.md and 2 tickets\)$/m, 'check');
  assert.match(script('plans.js', work, 'review', 'csv-export'), /^review: 0 of 2 tickets to review$/m, 'review');
  assert.match(script('plans.js', work, 'mark', 'get', '--session', SID), /^planning: csv-export$/m, 'the chat mark');
  assert.match(script('plans.js', work, 'list'), new RegExp(`^- csv-export: ${state} · .* · ${where}$`, 'm'), 'the draft');
};

// What each variant beyond the branch, tasks and changes must give the scripts the skills run.
const STATE = {
  planning: draftState('draft · open Q 0', '\\.keel/local/plans/keel/csv-export/ \\(this machine only\\)'),
  'planning-openq': draftState('draft · open Q 1', '\\.keel/local/plans/keel/csv-export/ \\(this machine only\\)'),
  'planning-ready': (work, git) => {
    draftState('ready · open Q 0', '\\.keel/local/plans/keel/csv-export/ \\(this machine only\\)')(work);
    const settings = script('plans.js', work, 'settings');
    assert.match(settings, /^tickets: repo$/m);
    assert.match(settings, /^ticket_prefix: INV$/m);
    assert.match(git('show', 'HEAD:AGENTS.md'), /^No ticket or backlog files in this repository: tickets live in Jira\.$/m);
  },
  'planning-repo': draftState('draft · open Q 0', 'tickets/csv-export/'),
  'planning-new': (work) => {
    assert.match(script('plans.js', work, 'list'), /^- notification-system: draft · open Q 0 · tickets 0 · .* \(this machine only\)$/m);
    assert.match(script('plans.js', work, 'mark', 'get', '--session', SID), /^planning: notification-system$/m);
  },
  // The draft made from the brief: its open question counts, the brief is in keel's trash.
  'planning-brief': (work) => {
    assert.match(script('plans.js', work, 'list'), /^- notification-system: draft · open Q 1 · tickets 0 · .* \(this machine only\)$/m);
    assert.match(script('plans.js', work, 'mark', 'get', '--session', SID), /^planning: notification-system$/m);
    const plan = fs.readFileSync(path.join(work, '.keel', 'local', 'plans', 'keel', 'notification-system', 'plan.md'), 'utf8');
    assert.match(plan, /^D1\. Mail goes through the company's SMTP server - no new mail service account$/m);
    assert.match(plan, /^- src\/payment\.js:4 charge\(\) returns status paid/m, 'Files went into What was gathered');
    assert.ok(!fs.existsSync(path.join(work, '.keel', 'local', 'plans', 'briefs', 'notification-system-brief.md')), 'the brief left for the trash');
  },
  planned: (work) => {
    const out = script('plans.js', work, 'tickets', '--fetch');
    assert.match(out, /^ {2}INV-1 .* — done$/m, out);
    assert.match(out, /^ {2}INV-2 .* — in progress · branch INV-2-[\w-]+, Dana Smith, /m, out);
    assert.match(out, /^ {2}INV-3 .* — waiting for merge into the feature branch · /m, out);
    assert.match(out, /^ {2}INV-4 .* — to do · INV-3 only in ticket branch INV-3-[\w-]+$/m, out);
    assert.match(script('plans.js', work, 'tickets', 'INV-4', '--fetch'), /^ {2}depends: INV-3 waiting for merge into the feature branch$/m);
  },
  'task-active': (work, git) => {
    assert.match(script('notes.js', work, 'task', 'active', '--session', SID), /^active task: CAN-123$/m);
    const task = fs.readFileSync(path.join(work, '.keel', 'tasks', 'CAN-123', 'task.md'), 'utf8');
    assert.match(task, /^status: active$/m);
    // started: main before the task branch, so the task's code shows in git diff <started>.
    const started = /^started: ([0-9a-f]{40})$/m.exec(task);
    assert.ok(started, 'started');
    assert.equal(started[1], git('rev-parse', 'main'));
    assert.match(git('diff', '--name-only', started[1]), /^src\/cart\.js$/m);
  },
};

test('the shop fixture builds each variant with git, a remote inside the workspace, trust only in the run\'s home and the state its cases read', { skip: !hasGit && 'git is not installed' }, () => {
  const expect = { base: ['main', 0, ''], tasks: ['main', 0, ''], finish: ['CAN-200-free-shipping', 1, ''], session: ['payments-rework', 0, 'M src/payment.js\n?? test/invoice.test.js'],
    messy: ['main', 0, ''], overbuilt: ['avg-total', 1, 'M src/cart.js\n M src/report.js\n?? test/report.test.js'],
    planning: ['main', 0, ''], 'planning-openq': ['main', 0, ''], 'planning-ready': ['main', 0, ''], 'planning-repo': ['main', 0, '?? tickets/'], 'planning-new': ['main', 0, ''],
    'planning-brief': ['main', 0, ''], planned: ['main', 0, ''], 'task-active': ['CAN-123-discount', 1, ''] };
  assert.deepEqual(Object.keys(expect), VARIANTS);
  for (const [variant, [branch, tasks, changed]] of Object.entries(expect)) {
    const work = tempDir(`keel-eval-${variant}-`);
    const home = tempDir('keel-eval-home-');
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
    if (STATE[variant]) STATE[variant](work, git);
  }
  const work = tempDir('keel-eval-tasks-');
  execFileSync(process.execPath, [SHOP, 'tasks'], { cwd: work, env: { ...process.env, HOME: tempDir('keel-eval-home-') } });
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
  // A resumed history gets each run's transcript beside it, in the case folder.
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^plugins\/keel\/evals\/\*\/\*-\*-\*-\*-\*\.jsonl$/m);
  // A run that calls an agent also gets a folder of the same name with the agents' transcripts.
  assert.match(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8'), /^plugins\/keel\/evals\/\*\/\*-\*-\*-\*-\*\/$/m);
});
