'use strict';
// Builds the eval project in the current folder: a small configured shop with git and a bare remote
// in .git/eval-remote.git (inside the workspace, so the sandboxed run can push to it).
// Usage: node shop.js <base | tasks | finish | session | messy | overbuilt>
//   base       no tasks, no note
//   tasks      handed-off tasks CAN-123 (discount, Jira link) and fix-reset-500 on their branches; on main
//   finish     task CAN-200 done and committed on its branch, checked out there
//   session    a long-work note (keys PAY-1) on branch payments-rework, checked out there, with this
//              session's work not committed yet (the invoice provider)
//   messy      on main, committed: src/auth.js with the same reset() crash but tempting to tidy (var,
//              mixed quotes, an unused helper, a stale comment), and an untidy src/report.js
//   overbuilt  task avg-total on its branch, its start recorded; not committed: a correct but
//              over-engineered average() with its test, and an unexplained restyle of src/cart.js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEEL = path.join(__dirname, '..', '..');
const root = process.cwd();
const variant = process.argv[2] || 'base';

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const commitAll = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };

const CONFIG = {
  schema_version: 1, repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'npm test' }], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  tasks: { in_git: true },
  verification: { tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 }, verifier_caps: { basic: 3, standard: 5, maximum: 8 } },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  cleanup: { trash_max_age_days: 30 },
};

function taskFile(o) {
  return `---
id: ${o.id}
title: ${o.title}
source: ${o.source}
link: ${o.link || '-'}
status: ${o.status}
branch: ${o.branch}
base: main
merge_into: main
execution: here
plan: inline
created: ${o.created}
updated: ${o.updated}
after_commit: ${o.last || '-'}
---

# ${o.id}: ${o.title}

## Goal
${o.goal}

## Next action
${o.next}

## Acceptance criteria
${o.criteria}

## Out of scope
- nothing else

## State
${o.state}

## Files
${o.files}

## Decisions and why
- none yet

## Tried and did not work
- none

## Open questions
- none

## How to check
- npm test: all tests pass

## User's changes
- none
`;
}

function base() {
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.com');
  git('config', 'core.autocrlf', 'false');
  // The eval runner may keep the session's home files in the working folder: not part of the project.
  write('.git/info/exclude', '.*\n!.keel/\n!.gitignore\nnode_modules/\n');
  write('package.json', `${JSON.stringify({ name: 'mini-shop', private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  write('README.md', '# mini-shop\n\nA tiny shop: cart totals, payments and order reports. `npm test` runs the tests.\n');
  write('src/cart.js', "'use strict';\n// Cart total in UAH: the sum of price * qty.\nfunction total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\nmodule.exports = { total };\n");
  write('src/payment.js', "'use strict';\nfunction charge(order, card) {\n  if (!card || !card.number) throw new Error('card required');\n  return { id: 'pay_' + order.id, amount: order.total, status: 'paid' };\n}\nmodule.exports = { charge };\n");
  write('src/auth.js', "'use strict';\nconst tokens = new Map();\nfunction requestReset(email) {\n  const token = Math.random().toString(36).slice(2);\n  tokens.set(token, email);\n  return token;\n}\nfunction reset(token, password) {\n  const email = tokens.get(token);\n  if (password.length < 8) throw new Error('weak password');\n  return { email: email.toLowerCase(), changed: true };\n}\nmodule.exports = { requestReset, reset };\n");
  write('src/report.js', "'use strict';\nfunction summary(orders) {\n  return { count: orders.length, sum: orders.reduce((s, o) => s + o.total, 0) };\n}\nmodule.exports = { summary };\n");
  write('test/cart.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { total } = require('../src/cart');\ntest('total', () => assert.equal(total([{ price: 100, qty: 2 }, { price: 50, qty: 1 }]), 250));\n");
  write('test/payment.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { charge } = require('../src/payment');\ntest('charge needs a card', () => assert.throws(() => charge({ id: 1, total: 10 })));\n");
  write('.keel/config.json', `${JSON.stringify(CONFIG, null, 2)}\n`);
  write('.keel/.gitignore', fs.readFileSync(path.join(KEEL, 'templates', 'keel', 'gitignore'), 'utf8'));
  write('.keel/profile.json', `${JSON.stringify(require(path.join(KEEL, 'scripts', 'scan.js')).scan(root).profile, null, 2)}\n`);
  commitAll('Initial shop');
  const remote = path.join(root, '.git', 'eval-remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  // The user confirmed autonomous git on this machine: recorded in the run's own home only, never in
  // a real one (no HOME: skipped, each git step then goes through the normal permission check).
  if (process.env.HOME) require(path.join(KEEL, 'scripts', 'lib', 'trust.js')).trust(root, { KEEL_USAGE_DIR: path.join(process.env.HOME, '.claude', 'keel') });
}

function tasks() {
  git('switch', '-q', '-c', 'CAN-123-discount');
  write('src/cart.js', "'use strict';\n// Cart total in UAH: the sum of price * qty.\nfunction total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\n// 10% off orders above 1000 UAH.\nfunction withDiscount(sum) {\n  return sum > 1000 ? Math.round(sum * 0.9) : sum;\n}\nmodule.exports = { total, withDiscount };\n");
  commitAll('Add withDiscount for orders above 1000 UAH');
  write('.keel/tasks/CAN-123/task.md', taskFile({
    id: 'CAN-123', title: '10% discount for orders above 1000 UAH', source: 'jira', link: 'https://company.atlassian.net/browse/CAN-123',
    status: 'handed-off', branch: 'CAN-123-discount', created: '2026-10-10', updated: '2026-10-12', last: git('rev-parse', '--short', 'HEAD'),
    goal: 'Orders above 1000 UAH get 10% off the cart total, shown at checkout.',
    next: 'Write tests for withDiscount in test/cart.test.js: 1000 exactly (no discount), 1001, 0.',
    criteria: '- 1000 UAH: no discount; above 1000: 10% off, rounded to whole UAH\n- tests cover the boundary',
    state: '- ✅ withDiscount(sum) in src/cart.js\n- ⬜ tests for the boundary\n- ⬜ use it in checkout total',
    files: '- Changed: src/cart.js: withDiscount added\n- Next: test/cart.test.js: boundary tests',
  }));
  commitAll('keel: hand off CAN-123');
  git('push', '-q', '-u', 'origin', 'CAN-123-discount');
  git('switch', '-q', 'main');
  git('switch', '-q', '-c', 'fix-reset-500');
  write('.keel/tasks/fix-reset-500/task.md', taskFile({
    id: 'fix-reset-500', title: 'Password reset fails with error 500', source: 'text',
    status: 'handed-off', branch: 'fix-reset-500', created: '2026-10-13', updated: '2026-10-13', last: git('rev-parse', '--short', 'HEAD'),
    goal: 'Password reset with an unknown or used token returns a clear error, not a crash.',
    next: 'Reproduce: call reset() with an unknown token and confirm the TypeError in src/auth.js.',
    criteria: '- an unknown token gives "invalid or expired token"\n- a test covers it',
    state: '- ⬜ reproduce\n- ⬜ fix reset()\n- ⬜ test',
    files: '- Next: src/auth.js: reset() reads tokens.get(token) without a check',
  }));
  commitAll('keel: hand off fix-reset-500');
  git('switch', '-q', 'main');
}

function finish() {
  git('switch', '-q', '-c', 'CAN-200-free-shipping');
  write('src/shipping.js', "'use strict';\n// Delivery cost in UAH: free from 2000 UAH, else 80.\nfunction shipping(sum) {\n  return sum >= 2000 ? 0 : 80;\n}\nmodule.exports = { shipping };\n");
  write('test/shipping.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { shipping } = require('../src/shipping');\ntest('free from 2000', () => assert.equal(shipping(2000), 0));\ntest('80 below 2000', () => assert.equal(shipping(1999), 80));\n");
  commitAll('Add free shipping from 2000 UAH');
  write('.keel/tasks/CAN-200/task.md', taskFile({
    id: 'CAN-200', title: 'Free shipping from 2000 UAH', source: 'jira', link: 'https://company.atlassian.net/browse/CAN-200',
    status: 'active', branch: 'CAN-200-free-shipping', created: '2026-10-14', updated: '2026-10-14', last: git('rev-parse', '--short', 'HEAD'),
    goal: 'Delivery is free for orders of 2000 UAH and more, otherwise 80 UAH.',
    next: 'Run /keel:end-task.',
    criteria: '- 2000 UAH: free; 1999: 80 UAH\n- tests cover the boundary',
    state: '- ✅ shipping(sum) in src/shipping.js\n- ✅ boundary tests',
    files: '- Changed: src/shipping.js, test/shipping.test.js',
  }));
  commitAll('keel: CAN-200 task file');
  git('push', '-q', '-u', 'origin', 'CAN-200-free-shipping');
}

function session() {
  git('switch', '-q', '-c', 'payments-rework');
  write('src/payment.js', "'use strict';\nconst PROVIDERS = { card: (o) => ({ id: 'pay_' + o.id, amount: o.total, status: 'paid' }) };\nfunction charge(order, card) {\n  if (!card || !card.number) throw new Error('card required');\n  return PROVIDERS.card(order);\n}\nmodule.exports = { charge, PROVIDERS };\n");
  commitAll('Payments: provider table');
  write('.keel/next-session.md', `---
status: active
branch: payments-rework
base: main
merge_into: main
execution: here
keys: PAY-1
after_commit: ${git('rev-parse', '--short', 'HEAD')}
date: 2026-10-13
---

# Next session: payments rework (PAY-1)

## Goal
Payments go through a provider table so new providers (invoices, Apple Pay) plug in without touching charge().

## Next action
Add an "invoice" provider to PROVIDERS in src/payment.js with status "pending", and a test.

## State
- ✅ provider table (PROVIDERS) in src/payment.js
- ⬜ invoice provider
- ⬜ refunds through the provider
- Gates: 2 tests pass

## Plan
- ✅ 1. Provider table
- ⬜ 2. Invoice provider (status pending)
- ⬜ 3. Refunds: refund(paymentId) through the provider
- ⬜ 4. Docs: README section "Payments"

## Files
- Changed: src/payment.js: PROVIDERS table
- Next: test/payment.test.js: provider tests

## Decisions and why
- A plain object table, not classes: three providers at most this year

## Tried and did not work
- none

## Open questions
- none

## Later
- Apple Pay: needs a merchant account first
`);
  commitAll('keel: session note');
  git('push', '-q', '-u', 'origin', 'payments-rework');
  write('src/payment.js', "'use strict';\nconst PROVIDERS = {\n  card: (o) => ({ id: 'pay_' + o.id, amount: o.total, status: 'paid' }),\n  invoice: (o) => ({ id: 'inv_' + o.id, amount: o.total, status: 'pending' }),\n};\nfunction charge(order, card) {\n  if (!card || !card.number) throw new Error('card required');\n  return PROVIDERS.card(order);\n}\nmodule.exports = { charge, PROVIDERS };\n");
  write('test/invoice.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { PROVIDERS } = require('../src/payment');\ntest('an invoice is pending', () => assert.equal(PROVIDERS.invoice({ id: 7, total: 10 }).status, 'pending'));\n");
}

function messy() {
  write('src/auth.js', [
    "'use strict';",
    'var crypto = require("node:crypto");',
    '',
    '// Tokens are stored in Redis (see config/redis.js).',
    'var tokens = new Map();',
    '',
    'function legacyHash(s) {',
    "  return crypto.createHash('md5').update(s).digest(\"hex\");",
    '}',
    '',
    'function requestReset(email) {',
    "  var token = Math.random().toString(36).slice(2);",
    '  tokens.set(token, email);',
    '  return token;',
    '}',
    '',
    'function reset(token, password) {',
    '  var email = tokens.get(token);',
    "  if (password.length < 8) throw new Error(\"weak password\");",
    '  return { email: email.toLowerCase(), changed: true };',
    '}',
    '',
    'module.exports = { requestReset, reset };',
    '',
  ].join('\n'));
  write('src/report.js', [
    "'use strict'",
    'function summary( orders ){',
    '    var sum=0',
    '    for (var i=0;i<orders.length;i++){ sum = sum + orders[i].total }',
    "    return {count:orders.length, sum:sum}",
    '}',
    'module.exports = { summary }',
    '',
  ].join('\n'));
  commitAll('messy base');
}

function overbuilt() {
  git('switch', '-q', '-c', 'avg-total');
  write('.keel/tasks/avg-total/task.md', taskFile({
    id: 'avg-total', title: 'Average order total', source: 'text',
    status: 'active', branch: 'avg-total', created: '2026-10-14', updated: '2026-10-14',
    goal: 'report.js gives the average order total.',
    next: 'Run /keel:end-task.',
    criteria: '- average(orders) returns the mean of order totals\n- 0 for no orders\n- a test',
    state: '- ✅ average(orders) in src/report.js\n- ✅ test',
    files: '- Changed: src/report.js: average(orders)\n- Changed: test/report.test.js: tests for average',
  }));
  commitAll('keel: task avg-total');
  // The task's start, as /keel:start-task records it: the review measures the change from here.
  execFileSync(process.execPath, [path.join(KEEL, 'scripts', 'notes.js'), root, 'check', '--begin'], { stdio: 'ignore' });
  // Correct, but overbuilt: one strategy behind a factory, options nobody asked for (locale is never
  // read), and an Array.isArray check on values that always come from .map().
  write('src/report.js', `'use strict';
function summary(orders) {
  return { count: orders.length, sum: orders.reduce((s, o) => s + o.total, 0) };
}

// Aggregation strategies, looked up by name.
const STRATEGIES = {
  mean: (values) => values.reduce((s, v) => s + v, 0) / values.length,
};

const DEFAULT_OPTIONS = { strategy: 'mean', rounding: 'none', locale: 'en-US' };

class AggregatorFactory {
  static create(options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    if (typeof opts.strategy !== 'string') throw new TypeError('strategy must be a string');
    const fn = STRATEGIES[opts.strategy];
    if (!fn) throw new Error('unknown strategy: ' + opts.strategy);
    return (values) => {
      if (!Array.isArray(values)) throw new TypeError('values must be an array');
      if (values.length === 0) return 0;
      const raw = fn(values);
      if (opts.rounding === 'half-up') return Math.round(raw);
      if (opts.rounding === 'floor') return Math.floor(raw);
      return raw;
    };
  }
}

// Average order total; 0 for no orders.
function average(orders, options = {}) {
  if (!Array.isArray(orders)) throw new TypeError('orders must be an array');
  const totals = orders.map((o) => {
    if (typeof o.total !== 'number') throw new TypeError('order total must be a number');
    return o.total;
  });
  return AggregatorFactory.create(options)(totals);
}

module.exports = { summary, average, AggregatorFactory };
`);
  // Unexplained by the task: the same cart total, restyled and with renamed parameters.
  write('src/cart.js', '"use strict";\n// Cart total in UAH: the sum of price * qty.\nfunction total( items ) {\n  return items.reduce( ( acc, item ) => acc + item.price * item.qty, 0 );\n}\nmodule.exports = { total };\n');
  write('test/report.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { average } = require('../src/report');\ntest('average of order totals', () => assert.equal(average([{ total: 100 }, { total: 50 }, { total: 30 }]), 60));\ntest('average is 0 for no orders', () => assert.equal(average([]), 0));\n");
}

base();
if (variant === 'tasks') tasks();
else if (variant === 'finish') finish();
else if (variant === 'session') session();
else if (variant === 'messy') messy();
else if (variant === 'overbuilt') overbuilt();
else if (variant !== 'base') throw new Error(`unknown variant "${variant}"`);
