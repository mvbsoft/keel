'use strict';
// Builds the eval project in the current folder: a small configured shop with git and a bare remote
// in .git/eval-remote.git (inside the workspace, so the sandboxed run can push to it).
// Usage: node shop.js <base | tasks | finish | session | messy | overbuilt | planning | planning-openq |
//                      planning-ready | planning-repo | planned | task-active>
//   base            no tasks, no note
//   tasks           handed-off tasks CAN-123 (discount, Jira link) and fix-reset-500 on their branches; on main
//   finish          task CAN-200 done and committed on its branch, checked out there
//   session         a long-work note (keys PAY-1) on branch payments-rework, checked out there, with this
//                   session's work not committed yet (the invoice provider)
//   messy           on main, committed: src/auth.js with the same reset() crash but tempting to tidy (var,
//                   mixed quotes, an unused helper, a stale comment), and an untidy src/report.js
//   overbuilt       task avg-total on its branch, its start recorded; not committed: a correct but
//                   over-engineered average() with its test, and an unexplained restyle of src/cart.js
// The planning variants add the invoices (src/invoices.js, src/server.js, public/invoices.html) on main:
//   planning        a draft csv-export on this machine (settings: language en, draft pc; no export, no
//                   prefix): plan.md and tickets T1, T2 (T2 depends on T1) written, both reviewed as they
//                   are, check clean, no open question; the chat SID plans csv-export; on main
//   planning-openq  as planning, with one open question Q1 in plan.md
//   planning-ready  as planning, the plan ready, prefix INV (export still unset), and a committed AGENTS.md
//                   that says tickets live in Jira
//   planning-repo   as planning, the draft in the repository (draft repo): tickets/csv-export/ not committed
//   planned         csv-export exported into tickets/csv-export/ (INV-1..INV-4, branch csv-export, merge_into
//                   main) and merged into main: INV-1 done on origin/main, INV-2 in progress (branch
//                   INV-2-download-button, its tip by Dana Smith), INV-3 done on its branch INV-3-date-range
//                   only (waiting for merge into the feature branch), INV-4 to do (depends on INV-3); on main
//   task-active     tasks, with CAN-123 active again for the chat SID (status active, started recorded,
//                   committed), checked out on CAN-123-discount
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEEL = path.join(__dirname, '..', '..');
const root = process.cwd();
const variant = process.argv[2] || 'base';

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const commitAll = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
// The chat a case resumes (its history.jsonl keeps this session id): the planning and task marks are
// written for it, so the run is a conversation that plans a feature or works on a task.
const SID = '11111111-2222-4333-8444-555555555555';
// plans.js as the skills run it; a refusal stops the fixture.
const plans = (...a) => {
  const out = execFileSync(process.execPath, [path.join(KEEL, 'scripts', 'plans.js'), root, ...a], { encoding: 'utf8' });
  if (/^plans: /.test(out)) throw new Error(`plans.js ${a.join(' ')}: ${out}`);
  return out;
};
// A planning file's text after its front matter (plans.js writes the front matter, keeps it).
const body = (rel, text) => write(rel, fs.readFileSync(path.join(root, rel), 'utf8').replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

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

// --- planning ---

const INVOICES = [
  "'use strict';",
  '// Invoices: one per paid order, amounts in UAH.',
  'function list(orders) {',
  "  return orders.filter((o) => o.status === 'paid').map((o) => ({ number: String(o.id), date: o.date, customer: o.customer, total: o.total }));",
  '}',
];
const SERVER = [
  "'use strict';",
  '// The shop\'s HTTP routes: GET /invoices gives the invoice list as JSON.',
  "const http = require('node:http');",
  "const { list } = require('./invoices');",
  '',
  'function handle(req, res, orders) {',
  "  if (req.method === 'GET' && req.url === '/invoices') {",
  "    res.writeHead(200, { 'content-type': 'application/json' });",
  '    return res.end(JSON.stringify(list(orders)));',
  '  }',
  '  res.writeHead(404);',
  '  return res.end();',
  '}',
  '',
  'function start(orders, port = 3000) {',
  '  return http.createServer((req, res) => handle(req, res, orders)).listen(port);',
  '}',
  'module.exports = { handle, start };',
  '',
];
const PAGE = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Invoices</title></head>',
  '<body>',
  '  <h1>Invoices</h1>',
  '  <table id="invoices">',
  '    <thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Total, UAH</th></tr></thead>',
  '    <tbody></tbody>',
  '  </table>',
  '  <script>fetch(\'/invoices\').then((r) => r.json()).then((list) => { /* rows */ });</script>',
  '</body>',
  '</html>',
  '',
];

// The code the plan is about, committed on main and pushed.
function invoices() {
  write('src/invoices.js', [...INVOICES, 'module.exports = { list };', ''].join('\n'));
  write('src/server.js', SERVER.join('\n'));
  write('public/invoices.html', PAGE.join('\n'));
  commitAll('Invoices: the list, GET /invoices and the invoices page');
  git('push', '-q', 'origin', 'main');
}

// The tickets of csv-export: the planning variants take the first two, planned all four.
const TICKETS = [
  { title: 'CSV export endpoint for invoices', slug: 'csv-endpoint', text: `## Goal
GET /invoices.csv returns the invoices GET /invoices returns, as a CSV file. Done when the route answers
with a header row and one line per paid order.

## Why
The accountants load invoices into their accounting program, which imports CSV (D1, D2).

## Acceptance criteria
- Given two paid orders and one unpaid, when GET /invoices.csv is called, then the answer is 200 with
  content type \`text/csv; charset=utf-8\` and three lines: the header and the two paid orders.
- The header is \`number,date,customer,total\`.
- A total of 1234.5 is written as 1234.50.
- A customer name with a comma or a double quote is quoted as CSV requires: \`"Smith, Dana"\` stays one
  field.
- With no paid orders the file holds the header only.
- GET /invoices still returns the same JSON as before.

## Where to look
- \`src/server.js:6\` handle(): the routes; GET /invoices is the model for the new one.
- \`src/invoices.js:3\` list(): the invoices and their fields.
- \`test/cart.test.js:1\`: how the tests here are written (node:test).

## Out of scope
- The download button on the invoices page (T2).
- Filters by date or customer.

## Dependencies
Blocks T2.

## How to check
- \`npm test\`: the new tests of the route pass, the old ones still pass.
- By hand: start the server with a few orders, open \`http://localhost:3000/invoices.csv\` and load the
  file into a spreadsheet: one invoice per row, totals with two decimals.
` },
  { title: 'Download button on the invoices page', slug: 'download-button', depends: 'T1', text: `## Goal
The invoices page shows a "Download CSV" button that saves the file GET /invoices.csv gives. Done when a
click saves invoices.csv with the invoices of the table.

## Why
The accountants work from the invoices page and should not have to type a URL (D1).

## Acceptance criteria
- Given the invoices page is open, then a "Download CSV" button is shown above the table.
- When the button is clicked, then the browser saves a file named invoices.csv holding the same invoices
  as the table, in the same order.
- With no invoices the button is still shown, and the saved file holds the header only.
- The table and its columns do not change.

## Where to look
- \`public/invoices.html:6\`: the table the button goes above.
- \`src/server.js:6\` handle(): the route the button calls, added by T1.

## Out of scope
- A new look for the page beyond the button.
- Choosing which columns go into the file.

## Dependencies
Blocked by T1.

## How to check
- \`npm test\` passes.
- By hand: start the server, open the invoices page, click "Download CSV" and open the saved file: its
  rows match the table, and the header comes first.
` },
  { title: 'Date range for the CSV export', slug: 'date-range', depends: 'T1', text: `## Goal
GET /invoices.csv takes an optional date range, from and to, and gives only the invoices dated inside it.
Done when a request with both dates returns only that month's invoices.

## Why
The accountants close one month at a time and load only that month (D3).

## Acceptance criteria
- Given invoices dated 2026-09-30, 2026-10-01 and 2026-10-31, when GET
  \`/invoices.csv?from=2026-10-01&to=2026-10-31\` is called, then the file holds the two October ones.
- Both ends are included.
- Without from and to the file holds every invoice, as before.
- A date that is not YYYY-MM-DD gives 400 with a message that names the parameter.
- from after to gives 400.

## Where to look
- \`src/server.js:6\` handle(): reads the request URL.
- \`src/invoices.js:3\` list(): the invoice date field.

## Out of scope
- Filters by customer.
- A date picker on the page.

## Dependencies
Blocked by T1. Blocks T4.

## How to check
- \`npm test\`: tests for both ends, no range, a bad date and from after to.
- By hand: call the route with the dates of last month and compare the rows with the invoices page.
` },
  { title: 'Monthly CSV by e-mail', slug: 'monthly-email', depends: 'T3', text: `## Goal
On the first day of each month the shop sends the CSV of the month before to the accountants' address.
Done when the mail with the attached file arrives once per month.

## Why
The accountants asked not to download the file by hand every month (D4).

## Acceptance criteria
- Given the first day of a month, when the monthly job runs, then one mail goes to the configured
  address with invoices.csv of the month before attached.
- Running the job twice on the same day sends one mail.
- With no invoices that month the mail still goes, with the header-only file.
- Without a configured address the job sends nothing and logs why.

## Where to look
- \`src/invoices.js:3\` list(): the invoices of the month.
- \`src/server.js:15\` start(): where the shop starts, and with it the job.
- \`package.json\`: no mail library yet.

## Out of scope
- Other mail recipients or a mail per customer.
- PDF invoices.

## Dependencies
Blocked by T3.

## How to check
- \`npm test\`: a test with a fake mailer and a fixed date.
- By hand: run the job with the date set to the first of the month and a test address; one mail with the
  file arrives.
` },
];

function planText(list, openq, next) {
  const later = list.length > 2 ? '- PDF invoices' : '- Filters by date or customer\n- PDF invoices\n- Sending the file by e-mail';
  const decisions = list.length > 2 ? '\nD3. A from/to date range on the same route - one route to keep, and the accountants close one month at a time.\nD4. A monthly job in the shop process sends the file - no new service to run for one mail a month.' : '';
  return `# csv-export

## Summary
The accountants download the invoices as a CSV file from the invoices page and load it into their
accounting program, without retyping.

## Problem / Goal
Today the invoices are only shown on the invoices page and given as JSON by GET /invoices, so the
accountants copy them by hand every month. Goal: one click on the invoices page gives a CSV file with
the same invoices.

## Decisions
D1. The CSV comes from a new route GET /invoices.csv beside GET /invoices - the list stays in one place (src/invoices.js) and the page only links to it.
D2. Comma-separated, UTF-8, a header row, totals in UAH with two decimals - what the accountants' program imports.${decisions}

## Out of scope
${later}

## Design sketch
src/server.js gets a route /invoices.csv that turns list(orders) into CSV lines; public/invoices.html gets
a "Download CSV" button above the table that calls it.

## Terms
- Invoice: one paid order, as list() in src/invoices.js gives it.
- CSV: comma-separated values, one invoice per line after the header row.

## Open questions
${openq ? 'Q1. Should the file use a semicolon, as Excel with a Ukrainian locale expects? - D2 and the T1 acceptance criteria depend on it.\n' : ''}
## Tickets
${list.map((t, i) => `T${i + 1} ${t.title}`).join('\n')}

## Next action
${next || (list.length > 2 ? 'Export the tickets.' : 'Final review of the tickets, then export them.')}
`;
}

// A draft csv-export as start-planning leaves it: settings, plan.md and the tickets written in full, each
// ticket reviewed as it is (last, so the review hashes match).
function draft({ where = 'pc', list = TICKETS.slice(0, 2), openq = false, next } = {}) {
  plans('settings', 'set', '--language', 'en', '--draft', where);
  const plan = /^created: (.+)$/m.exec(plans('new', 'csv-export'))[1];
  const files = list.map((t) => /^created: (.+)$/m.exec(plans('ticket', 'csv-export', '--title', t.title, '--slug', t.slug, ...(t.depends ? ['--depends', t.depends] : [])))[1]);
  body(plan, planText(list, openq, next));
  list.forEach((t, i) => body(files[i], `# [T${i + 1}] ${t.title}\n\n${t.text}`));
  plans('reviewed', 'csv-export', ...list.map((t, i) => `T${i + 1}`));
  return plan;
}

function planning({ openq = false, where = 'pc', next } = {}) {
  invoices();
  const plan = draft({ where, openq, next });
  // Written before the invoices: a hand-over has its after_commit to bring up to date.
  write(plan, fs.readFileSync(path.join(root, plan), 'utf8').replace(/^after_commit: .*$/m, `after_commit: ${git('rev-parse', '--short', 'HEAD~1')}`));
  plans('mark', 'set', 'csv-export', '--session', SID);
}

function planningReady() {
  write('AGENTS.md', '# Agents\n\nNo ticket or backlog files in this repository: tickets live in Jira.\nRun `npm test` before every commit.\nAmounts are in UAH.\n');
  commitAll('Add AGENTS.md');
  git('push', '-q', 'origin', 'main');
  planning({ next: 'Export the tickets.' });
  plans('state', 'csv-export', 'ready');
  plans('settings', 'set', '--prefix', 'INV');
}

// Commits as another person: the in-progress hint names the branch tip's author.
const commitAs = (name, email, msg) => { git('add', '-A'); git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg); };

function planned() {
  invoices();
  draft({ list: TICKETS });
  plans('settings', 'set', '--export', 'repo', '--prefix', 'INV');
  plans('state', 'csv-export', 'ready');
  git('switch', '-q', '-c', 'csv-export');
  plans('export', 'csv-export');
  plans('commit', 'csv-export');
  // INV-1: the route, done, and the feature branch merged into main (done reads from origin/main).
  write('src/invoices.js', [...INVOICES,
    '// The invoices as CSV: a header row, then one line per invoice; totals with two decimals.',
    'function toCsv(invoices) {',
    '  const field = (v) => (/[",\\n]/.test(String(v)) ? \'"\' + String(v).replace(/"/g, \'""\') + \'"\' : String(v));',
    "  const rows = invoices.map((i) => [i.number, i.date, i.customer, i.total.toFixed(2)].map(field).join(','));",
    "  return ['number,date,customer,total', ...rows].join('\\n') + '\\n';",
    '}',
    'module.exports = { list, toCsv };', ''].join('\n'));
  write('test/invoices.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { list, toCsv } = require('../src/invoices');\ntest('csv of the paid orders', () => assert.equal(toCsv(list([{ id: 1, status: 'paid', date: '2026-10-01', customer: 'Smith, Dana', total: 1234.5 }, { id: 2, status: 'new', date: '2026-10-02', customer: 'Lee', total: 5 }])), 'number,date,customer,total\\n1,2026-10-01,\"Smith, Dana\",1234.50\\n'));\n");
  plans('done', 'INV-1');
  commitAll('INV-1: GET /invoices.csv');
  git('push', '-q', '-u', 'origin', 'csv-export');
  git('switch', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', "Merge branch 'csv-export'", 'csv-export');
  git('push', '-q', 'origin', 'main');
  // INV-2: work in progress by a colleague, status not written.
  git('switch', '-q', '-c', 'INV-2-download-button', 'csv-export');
  write('public/invoices.html', PAGE.map((l) => (l === '  <table id="invoices">' ? '  <a href="/invoices.csv" download="invoices.csv"><button>Download CSV</button></a>\n' + l : l)).join('\n'));
  commitAs('Dana Smith', 'dana@example.com', 'INV-2: Download CSV button on the invoices page');
  git('push', '-q', '-u', 'origin', 'INV-2-download-button');
  // INV-3: done on its ticket branch, not merged into csv-export yet.
  git('switch', '-q', '-c', 'INV-3-date-range', 'csv-export');
  write('src/server.js', SERVER.map((l) => (l.startsWith('// The shop') ? `${l}\n// GET /invoices.csv?from=YYYY-MM-DD&to=YYYY-MM-DD: the invoices dated inside the range.` : l)).join('\n'));
  commitAll('INV-3: date range for the CSV export');
  plans('done', 'INV-3');
  commitAll('INV-3: status done');
  git('push', '-q', '-u', 'origin', 'INV-3-date-range');
  git('switch', '-q', 'main');
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

base();
if (variant === 'tasks') tasks();
else if (variant === 'finish') finish();
else if (variant === 'session') session();
else if (variant === 'messy') messy();
else if (variant === 'overbuilt') overbuilt();
else if (variant === 'planning') planning();
else if (variant === 'planning-openq') planning({ openq: true });
else if (variant === 'planning-ready') planningReady();
else if (variant === 'planning-repo') planning({ where: 'repo' });
else if (variant === 'planned') planned();
else if (variant === 'task-active') taskActive();
else if (variant !== 'base') throw new Error(`unknown variant "${variant}"`);
