'use strict';
// The task and session variants of the shop project: task files, a session note, a task in progress.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KEEL, root, git, write, commitAll, SID } = require('./shop-base.js');

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
execution: ${o.execution || 'here'}
plan: ${o.plan || 'inline'}
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

function session({ level } = {}) {
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
${level ? `Then end the session with ${level} verification: it is enough for this line.
` : ''}
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

// CAN-123 resumed in the chat SID, as start-task leaves it: status active, its start (main before the
// branch) recorded, committed on the task branch.
function taskActive() {
  tasks();
  const started = git('rev-parse', 'main');
  git('switch', '-q', 'CAN-123-discount');
  const out = execFileSync(process.execPath, [path.join(KEEL, 'scripts', 'notes.js'), root, 'task', 'activate', 'CAN-123', '--session', SID], { encoding: 'utf8' });
  if (!/^active task: CAN-123/.test(out)) throw new Error(`notes.js task activate: ${out}`);
  const file = '.keel/tasks/CAN-123/task.md';
  write(file, fs.readFileSync(path.join(root, file), 'utf8').replace(/^(after_commit: .*)$/m, (l) => `${l}\nstarted: ${started}`));
  commitAll('keel: CAN-123 active');
}

// A plan of n steps as the plan template writes them, each step a module and its test.
function stepsPlan(id, title, n) {
  const step = (i) => `### Step ${i}: report part ${i}
- files: \`src/report/part${i}.js\`, \`test/report-part${i}.test.js\`
- model: sonnet
- effort: high
- do: add part ${i} of the monthly report in src/report/part${i}.js, export build(orders)
- done when:
  1. \`npm test\` passes the new test/report-part${i}.test.js
- status: ⬜ not done
`;
  return `# ${id}: ${title}

## Goal and acceptance criteria
A monthly CSV report of orders, in ${n} parts.

## Steps
${Array.from({ length: n }, (_, i) => step(i + 1)).join('\n')}
## Execution
3. Execution: fresh.
`;
}

function taskFresh() {
  tasks();
  git('switch', '-q', '-c', 'csv-report');
  write('.keel/tasks/csv-report/plan.md', stepsPlan('csv-report', 'Monthly CSV report of orders', 9));
  write('.keel/tasks/csv-report/task.md', taskFile({
    id: 'csv-report', title: 'Monthly CSV report of orders', source: 'text', execution: 'fresh', plan: 'plan.md',
    status: 'handed-off', branch: 'csv-report', created: '2026-11-05', updated: '2026-11-05', last: git('rev-parse', '--short', 'HEAD'),
    goal: 'A monthly CSV report of orders, built in 9 parts (see plan.md).',
    next: 'Step 1 of plan.md.',
    criteria: '- every part of plan.md is done and tested',
    state: '- see plan.md',
    files: '- Next: src/report/: the parts of plan.md',
  }));
  commitAll('keel: csv-report planned for a fresh conversation');
  git('push', '-q', '-u', 'origin', 'csv-report');
  git('switch', '-q', 'main');
}

module.exports = { tasks, finish, session, overbuilt, taskActive, taskFresh };
