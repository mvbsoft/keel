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
// The chat the planning cases resume: its id is SID in shop-base.js, each case's history.jsonl keeps it.
const SID = /^const SID = '([^']+)';$/m.exec(fs.readFileSync(path.join(EVALS, '_fixtures', 'shop-base.js'), 'utf8'))[1];
const VARIANTS = ['base', 'tasks', 'finish', 'session', 'session-level', 'messy', 'overbuilt', 'planning', 'planning-openq', 'planning-ready', 'planning-repo', 'planning-new', 'planning-brief', 'planned', 'task-active', 'task-fresh', 'task-on-main', 'ticket-on-feature', 'worktree', 'db', 'db-rule', 'db-big', 'db-renamed', 'db-renamed-open', 'planning-db', 'adr-journal', 'adr-mixed', 'adr-living', 'adr-journal-breach', 'adr-living-breach'];

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
      const { keys, body } = front(path.join(dir, 'graders', g));
      // The runner reads one front-matter block per file; a second one is silently dropped.
      assert.doesNotMatch(body, /^---$/m, `${name}/${g}: one grader per file`);
      assert.ok(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm'].includes(keys.type), `${name}/${g}: type ${keys.type}`);
      for (const re of [keys.pattern, keys.input_match].filter(Boolean)) new RegExp(re.replace(/^'|'$/g, '')); // compiles
    }
    if (yaml) {
      assert.match(yaml, /^schema_version: "1\.1"$/m, name);
      assert.match(yaml, new RegExp(`^name: ${name}$`, 'm'), name);
      assert.match(yaml, /scaffold_script: fixture\.sh/, name);
      assert.match(fs.readFileSync(path.join(dir, 'fixture.sh'), 'utf8'), new RegExp(`node "\\$\\(dirname "\\$0"\\)/\\.\\./_fixtures/shop\\.js" (${VARIANTS.join('|')})\\n$`), name);
      // A written conversation the run resumes: every line a JSON record of the chat with shop-base.js's SID.
      const history = /^\s*history_file:\s*["']?([^"'\s]+)["']?\s*$/m.exec(yaml);
      if (history) {
        const file = path.join(dir, history[1]);
        assert.ok(fs.existsSync(file), `${name}: ${history[1]} exists`);
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
        assert.ok(lines.length, `${name}: ${history[1]} has lines`);
        for (const [i, l] of lines.entries()) {
          let r;
          assert.doesNotThrow(() => { r = JSON.parse(l); }, `${name}: ${history[1]} line ${i + 1} is JSON`);
          assert.equal(r.sessionId, SID, `${name}: ${history[1]} line ${i + 1} is the chat with shop-base.js's SID`);
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

const read = (work, rel) => fs.readFileSync(path.join(work, rel), 'utf8');
const pushed = (git, branch) => assert.equal(git('rev-parse', `origin/${branch}`), git('rev-parse', branch), `${branch} is pushed`);
// The tests behind the npm test gate the end-task cases run (the shop's test script is `node --test`):
// a red one would turn their review into a test failure.
// Without NODE_TEST_CONTEXT: this runner sets it, and a nested `node --test` that inherits it reports to
// the parent instead and always exits 0.
const testsPass = (work) => {
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--test'], { cwd: work, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `node --test passes: ${r.stdout.slice(-400)}`);
};

// A long-work line on PAY-1 with this session's invoice provider not committed yet.
const sessionState = (work, git) => {
  assert.match(script('notes.js', work, 'check'), /^note: present, status active, branch payments-rework, /m);
  assert.match(script('notes.js', work, 'lane', 'PAY-1'), /^lane: session \(the note \.keel\/next-session\.md names PAY-1/m);
  const note = read(work, '.keel/next-session.md');
  assert.match(note, /^keys: PAY-1$/m);
  assert.match(note, /^date: 2026-10-13$/m, 'the old date end-session-prepare-only must see replaced');
  assert.match(note, /^## Next action\nAdd an "invoice" provider to PROVIDERS in src\/payment\.js/m);
  assert.match(read(work, 'src/payment.js'), /^ {2}invoice: \(o\) => /m, 'the uncommitted work is the invoice provider');
  pushed(git, 'payments-rework');
};

const dbState = (work, git) => {
  assert.match(read(work, 'db/migrations/001_users.sql'), /name text NOT NULL[\s\S]*phone text/);
  assert.match(read(work, 'src/api.js'), /x-api-key/);
  assert.match(read(work, 'README.md'), /About 2,000 customers/);
  assert.deepEqual(git('ls-files', 'db/migrations').split('\n'), ['db/migrations/001_users.sql', 'db/migrations/002_orders.sql']);
  // The schema cases expect no maintenance mode to offer as ready; CLAUDE.md names it only to rule it out.
  for (const f of git('ls-files').split('\n').filter((f) => !f.startsWith('.keel/') && f !== 'CLAUDE.md')) assert.doesNotMatch(read(work, f), /maintenance|artisan down/i, f);
};

// Docs profile 2, the ADR style (undefined: not chosen) and, when given, the records as the scan counts them.
const adrState = (work, style, records) => {
  const docs = JSON.parse(read(work, '.keel/config.json')).docs;
  assert.equal(docs.profile, 2);
  assert.equal(docs.adr_style, style);
  if (records) assert.deepEqual(require('../plugins/keel/scripts/scan.js').scan(work).findings.docs.adr_records, records);
};

// What each variant beyond the branch, tasks and changes must give the scripts the skills run.
const STATE = {
  // Nothing to continue, and no discount rule anywhere for the start-task cases to find.
  base: (work, git) => {
    const check = script('notes.js', work, 'check');
    assert.match(check, /^note: missing$/m);
    assert.match(check, /^tasks: 0 unfinished$/m);
    assert.match(script('plans.js', work, 'list'), /^drafts: 0$/m);
    // Not .keel/: its config holds 1000 as line limits.
    for (const f of git('ls-files').split('\n').filter((f) => !f.startsWith('.keel/'))) assert.doesNotMatch(read(work, f), /discount|1000/i, f);
  },
  // CAN-123 is the unfinished task a "10% off over 1000 UAH" request must be matched with.
  tasks: (work, git) => {
    assert.match(script('notes.js', work, 'tasks'), /^tasks: 2 unfinished \((CAN-123, fix-reset-500|fix-reset-500, CAN-123)\)/);
    assert.match(script('notes.js', work, 'lane', 'CAN-123'), /^lane: task \(CAN-123 is an unfinished keel task, on CAN-123-discount/m);
    const task = git('show', 'CAN-123-discount:.keel/tasks/CAN-123/task.md');
    assert.match(task, /^status: handed-off\nbranch: CAN-123-discount$/m);
    assert.match(task, /^link: https:\/\/company\.atlassian\.net\/browse\/CAN-123$/m);
    assert.match(git('show', 'CAN-123-discount:src/cart.js'), /^function withDiscount\(sum\) \{\n {2}return sum > 1000 \? Math\.round\(sum \* 0\.9\) : sum;$/m);
    pushed(git, 'CAN-123-discount');
  },
  // CAN-200 done, committed and pushed on its branch: only the end-task step is left.
  finish: (work, git) => {
    assert.match(script('notes.js', work, 'lane', 'CAN-200'), /^lane: task \(CAN-200 is an unfinished keel task, on CAN-200-free-shipping \(working tree\)/m);
    assert.match(read(work, '.keel/tasks/CAN-200/task.md'), /^status: active\nbranch: CAN-200-free-shipping$/m);
    assert.equal(git('diff', '--name-only', 'main'), '.keel/tasks/CAN-200/task.md\nsrc/shipping.js\ntest/shipping.test.js');
    pushed(git, 'CAN-200-free-shipping');
    testsPass(work);
  },
  session: sessionState,
  // The untidy code bug-fix-stays-surgical's graders expect untouched, and the crash it fixes.
  messy: (work) => {
    const auth = read(work, 'src/auth.js');
    for (const line of ['var crypto = require("node:crypto");', '// Tokens are stored in Redis (see config/redis.js).', 'function legacyHash(s) {', 'var token = Math.random().toString(36).slice(2);']) {
      assert.ok(auth.includes(line), `src/auth.js keeps: ${line}`);
    }
    assert.match(read(work, 'src/report.js'), /^ {4}var sum=0$/m);
    const { reset } = require(path.join(work, 'src', 'auth.js'));
    assert.throws(() => reset('unknown', 'long enough'), { name: 'TypeError', message: /toLowerCase/ });
    assert.deepEqual(fs.readdirSync(path.join(work, 'test')).filter((f) => /auth|reset/.test(f)), [], 'reset() has no test yet');
  },
  // A correct but overbuilt average() and an unexplained cart.js edit, measured from the task's start.
  overbuilt: (work, git) => {
    assert.match(script('notes.js', work, 'check'), new RegExp(`^session start: ${git('rev-parse', '--short', 'HEAD')} at `, 'm'), 'the task start the review measures from');
    assert.match(read(work, '.keel/tasks/avg-total/task.md'), /^status: active\nbranch: avg-total$/m);
    const report = read(work, 'src/report.js');
    assert.match(report, /^class AggregatorFactory \{$/m);
    assert.match(report, /^const DEFAULT_OPTIONS = \{ strategy: 'mean', rounding: 'none', locale: 'en-US' \};$/m);
    assert.match(git('diff', 'src/cart.js'), /^\+function total\( items \) \{$/m, 'the cart edit the task does not explain');
    const { average } = require(path.join(work, 'src', 'report.js'));
    assert.equal(average([{ total: 100 }, { total: 50 }, { total: 30 }]), 60);
    assert.equal(average([]), 0);
    testsPass(work);
  },
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
  // The level is only in the note, never in the command: the run must still ask it.
  'session-level': (work, git) => {
    sessionState(work, git);
    assert.match(fs.readFileSync(path.join(work, '.keel', 'next-session.md'), 'utf8'), /^Then end the session with Basic verification/m);
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
  // The plan was approved for a fresh conversation: the run is that one and asks delegate or here.
  'task-fresh': (work, git) => {
    git('switch', '-q', 'csv-report');
    assert.match(fs.readFileSync(path.join(work, '.keel', 'tasks', 'csv-report', 'task.md'), 'utf8'), /^execution: fresh$/m);
    const out = script('plan-steps.js', work, '.keel/tasks/csv-report/plan.md', '--remaining');
    assert.match(out, /^suggest: delegate \(9 steps >= 8, 18 files >= 15\)$/m, out);
    assert.match(out, /^ask: Left: 9 steps, ~18 files, at or over 8 steps or 15 files: .* delegate to implementers, or here\?/m);
    assert.match(out, /^problems: none$/m, out);
  },
  // A task working directly on the shared main: a half of it moved to planning must not land there.
  'task-on-main': (work, git) => {
    assert.match(script('notes.js', work, 'task', 'active', '--session', SID), /^active task: order-history$/m);
    const task = fs.readFileSync(path.join(work, '.keel', 'tasks', 'order-history', 'task.md'), 'utf8');
    assert.match(task, /^status: active$/m);
    assert.match(task, /^branch: main\nbase: main$/m);
    assert.equal(/^started: ([0-9a-f]{40})$/m.exec(task)?.[1], git('rev-parse', 'main~2'), 'started: main before the task');
    assert.equal(git('rev-parse', 'origin/main'), git('rev-parse', 'main'), 'the task is pushed');
    assert.equal(fs.readdirSync(path.join(work, 'test')).filter((f) => /history/.test(f)).length, 0, 'history() has no tests');
  },
  // The same on a shared feature branch, where the rule against committing on main does not reach.
  'ticket-on-feature': (work, git) => {
    assert.match(script('notes.js', work, 'task', 'active', '--session', SID), /^active task: INV-1$/m);
    assert.match(fs.readFileSync(path.join(work, '.keel', 'tasks', 'INV-1', 'task.md'), 'utf8'), /^status: active\nbranch: csv-export\nbase: csv-export\nmerge_into: main$/m);
    assert.match(script('plans.js', work, 'tickets', 'INV-1'), /^  branch: csv-export -> main$/m);
    assert.match(script('plans.js', work, 'mark', 'get', '--session', SID), /^planning: none$/m, 'the chat works on a task, it plans nothing');
    assert.equal(git('rev-parse', 'origin/csv-export'), git('rev-parse', 'csv-export'), 'the task is pushed');
  },
  // A linked worktree on its own branch, with keel's committed config, and no session start anywhere yet.
  worktree: (work, git) => {
    const wt = path.join(work, '.claude', 'worktrees', 'wt');
    assert.equal(execFileSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'wt');
    assert.equal(git('symbolic-ref', '--short', 'HEAD'), 'main');
    assert.ok(fs.existsSync(path.join(wt, '.keel', 'config.json')), 'the worktree has keel\'s config');
    assert.equal(git('status', '--porcelain'), '', '.claude/ stays out of the project');
    for (const dir of [work, wt]) assert.ok(!fs.existsSync(path.join(dir, '.keel', 'local', 'session-start.json')), dir);
  },
  // The risky-change cases: users with data, a partner API, forward-only migrations, no maintenance mode.
  db: dbState,
  // The project's rule settles the deploy style.
  'db-rule': (work, git) => { dbState(work, git); assert.match(read(work, 'CLAUDE.md'), /one release/); },
  // The rule, and a table it would lock for long.
  'db-big': (work, git) => { dbState(work, git); assert.match(read(work, 'README.md'), /3\.5\s+million rows/); },
  // A one-release rename the project's rule asks for, for a reviewer to judge.
  'db-renamed': (work, git) => {
    assert.match(read(work, 'CLAUDE.md'), /one release/);
    assert.equal(read(work, 'db/migrations/003_users_full_name.sql'), 'ALTER TABLE users RENAME COLUMN name TO full_name;\n');
    assert.doesNotMatch(read(work, 'src/users.js'), /\bname\b/);
    assert.match(read(work, '.keel/local/tmp/keel/protocols/database.md'), /risky-changes\.md/, "keel's current review rules, readable inside the run");
  },
  // The same rename with no rule: the way to ship it was never chosen.
  'db-renamed-open': (work) => {
    assert.ok(!fs.existsSync(path.join(work, 'CLAUDE.md')), 'no rule settles it');
    assert.equal(read(work, 'db/migrations/003_users_full_name.sql'), 'ALTER TABLE users RENAME COLUMN name TO full_name;\n');
    assert.match(read(work, '.keel/local/tmp/keel/protocols/database.md'), /risky-changes\.md/);
  },
  // Planning a feature in the database shop.
  'planning-db': (work, git) => {
    dbState(work, git);
    assert.match(script('plans.js', work, 'mark', 'get', '--session', SID), /^planning: notification-system$/m);
  },
  // The ADR-style cases: how the scan reads the records decides what configure says is there now.
  'adr-journal': (work) => adrState(work, undefined, { records: 3, superseded: 1, amended: 0 }),
  'adr-mixed': (work) => adrState(work, undefined, { records: 3, superseded: 0, amended: 2 }),
  'adr-living': (work) => adrState(work, 'living', { records: 3, superseded: 0, amended: 0 }),
  'adr-journal-breach': (work) => {
    adrState(work, 'journal');
    assert.match(read(work, 'docs/adr/0002-job-queue.md'), /Status: Accepted[\s\S]*retried 5 times/);
    assert.match(read(work, 'docs/adr/0004-queue-retries.md'), /Supersedes the "Decision" part of 0002/);
    assert.match(read(work, 'docs/ops.md'), /0001-database\.md/);
    assert.match(read(work, '.keel/local/tmp/keel/protocols/docs.md'), /adr-journal\.md/, "keel's current review rules, readable inside the run");
    assert.match(read(work, '.keel/local/tmp/keel/skills/_shared/adr-journal.md'), /## Reviewers check/);
  },
  'adr-living-breach': (work) => {
    adrState(work, 'living');
    assert.match(read(work, 'docs/adr/0001-database.md'), /Amended[\s\S]*was: PostgreSQL 16/);
    assert.match(read(work, 'docs/adr/0004-queue-retries.md'), /Amends 0002/);
    assert.ok(!fs.existsSync(path.join(work, 'docs', 'adr', '0003-price-cache.md')));
    assert.match(read(work, 'CLAUDE.md'), /0003-price-cache\.md/, 'the rules still link the deleted record');
    assert.match(read(work, '.keel/local/tmp/keel/skills/_shared/adr-living.md'), /## Reviewers check/);
  },
};

test('the shop fixture builds each variant with git, a remote inside the workspace, trust only in the run\'s home and the state its cases read', { skip: !hasGit && 'git is not installed' }, () => {
  const expect = { base: ['main', 0, ''], tasks: ['main', 0, ''], finish: ['CAN-200-free-shipping', 1, ''], session: ['payments-rework', 0, 'M src/payment.js\n?? test/invoice.test.js'],
    'session-level': ['payments-rework', 0, 'M src/payment.js\n?? test/invoice.test.js'],
    messy: ['main', 0, ''], overbuilt: ['avg-total', 1, 'M src/cart.js\n M src/report.js\n?? test/report.test.js'],
    planning: ['main', 0, ''], 'planning-openq': ['main', 0, ''], 'planning-ready': ['main', 0, ''], 'planning-repo': ['main', 0, '?? tickets/'], 'planning-new': ['main', 0, ''],
    'planning-brief': ['main', 0, ''], planned: ['main', 0, ''], 'task-active': ['CAN-123-discount', 1, ''], 'task-fresh': ['main', 0, ''],
    'task-on-main': ['main', 1, '?? src/history.js'], 'ticket-on-feature': ['csv-export', 1, 'M src/invoices.js'], worktree: ['main', 0, ''],
    db: ['main', 0, ''], 'db-rule': ['main', 0, ''], 'db-big': ['main', 0, ''], 'db-renamed': ['main', 0, 'M src/users.js\n?? db/migrations/003_users_full_name.sql'],
    'db-renamed-open': ['main', 0, 'M src/users.js\n?? db/migrations/003_users_full_name.sql'], 'planning-db': ['main', 0, ''],
    'adr-journal': ['main', 0, ''], 'adr-mixed': ['main', 0, ''], 'adr-living': ['main', 0, ''],
    'adr-journal-breach': ['main', 0, 'M docs/adr/0002-job-queue.md\n?? docs/adr/0004-queue-retries.md\n?? docs/ops.md'],
    'adr-living-breach': ['main', 0, 'M docs/adr/0001-database.md\n D docs/adr/0003-price-cache.md\n?? docs/adr/0004-queue-retries.md'] };
  assert.deepEqual(Object.keys(expect), VARIANTS);
  assert.deepEqual(Object.keys(STATE).sort(), [...VARIANTS].sort(), 'every variant checks the state its cases read');
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
    STATE[variant](work, git);
  }
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
