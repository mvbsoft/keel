'use strict';
// The planning variants of the shop project: the invoices on main and the csv-export feature as a draft
// or exported into tickets, and a new notification-system draft.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { KEEL, root, git, write, commitAll, SID } = require('./shop-base.js');

// plans.js as the skills run it; a refusal stops the fixture.
const plans = (...a) => {
  const out = execFileSync(process.execPath, [path.join(KEEL, 'scripts', 'plans.js'), root, ...a], { encoding: 'utf8' });
  if (/^plans: /.test(out)) throw new Error(`plans.js ${a.join(' ')}: ${out}`);
  return out;
};
// A planning file's text after its front matter (plans.js writes the front matter, keeps it).
const body = (rel, text) => write(rel, fs.readFileSync(path.join(root, rel), 'utf8').replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

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
  { title: 'CSV export endpoint for invoices', slug: 'csv-endpoint', text: `## In plain words
Today the accountants copy the invoices from the invoices page by hand. The shop gets a new address
that gives the same invoices as a CSV file their accounting program loads: a header row, then one line
per paid order, with the total in two decimals. Unpaid orders are not in it. The invoices page and the
JSON list stay as they are; the button on the page comes in the next ticket.

## Example
- Two paid orders and one unpaid → the file has the header and two lines.
- A total of 1234.5 → the file says 1234.50.

## Goal
GET /invoices.csv returns the invoices GET /invoices returns, as a CSV file. Done when the route answers
with a header row and one line per paid order.

## Acceptance criteria
- [ ] Given two paid orders and one unpaid, when GET /invoices.csv is called, then the answer is 200
  with content type \`text/csv; charset=utf-8\` and three lines: the header and the two paid orders.
- [ ] The header is \`number,date,customer,total\`.
- [ ] A total of 1234.5 is written as 1234.50.
- [ ] A customer name with a comma or a double quote is quoted as CSV requires: \`"Smith, Dana"\` stays
  one field.
- [ ] With no paid orders the file holds the header only.
- [ ] GET /invoices still returns the same JSON as before.

## How to check
- \`npm test\`: the new tests of the route pass, the old ones still pass.
- By hand: start the server with a few orders, open \`http://localhost:3000/invoices.csv\` and load the
  file into a spreadsheet: one invoice per row, totals with two decimals.

## Boundaries
- always: keep GET /invoices and its JSON as they are.
- ask first: a CSV library; the format is small enough to write here.
- never: unpaid orders in the file.

## Correct the priors
Joining the fields with commas is not enough: a name with a comma or a double quote breaks the line
unless that field is quoted.

## Where to look
- \`src/server.js:6\` handle(): the routes; GET /invoices is the model for the new one.
- \`src/invoices.js:3\` list(): the invoices and their fields.
- \`test/cart.test.js:1\`: how the tests here are written (node:test).

## Out of scope
- The download button on the invoices page (T2).
- Filters by date or customer.

## Why
The accountants load invoices into their accounting program, which imports CSV (D1, D2).

## Dependencies
Blocks T2: its button calls this route.
` },
  { title: 'Download button on the invoices page', slug: 'download-button', depends: 'T1', text: `## In plain words
The accountants work from the invoices page. Above the table they get a "Download CSV" button; one click
saves a file invoices.csv with the same invoices as the table, in the same order, ready for their
accounting program. With no invoices the button is still there and the file holds only the header row.
The table itself does not change.

## Goal
The invoices page shows a "Download CSV" button that saves the file GET /invoices.csv gives. Done when a
click saves invoices.csv with the invoices of the table.

## Acceptance criteria
- [ ] Given the invoices page is open, then a "Download CSV" button is shown above the table.
- [ ] When the button is clicked, then the browser saves a file named invoices.csv holding the same
  invoices as the table, in the same order.
- [ ] With no invoices the button is still shown, and the saved file holds the header only.
- [ ] The table and its columns do not change.

## How to check
- \`npm test\` passes.
- By hand: start the server, open the invoices page, click "Download CSV" and open the saved file: its
  rows match the table, and the header comes first.

## Boundaries
- always: the file comes from GET /invoices.csv, not from the table in the page.
- ask first: any change to the table.
- never: a second copy of the CSV format in the page.

## Where to look
- \`public/invoices.html:6\`: the table the button goes above.
- \`src/server.js:6\` handle(): the route the button calls, added by T1.

## Out of scope
- A new look for the page beyond the button.
- Choosing which columns go into the file.

## Why
The accountants work from the invoices page and should not have to type a URL (D1).

## Dependencies
Blocked by T1: the button calls its route.
` },
  { title: 'Date range for the CSV export', slug: 'date-range', depends: 'T1', text: `## In plain words
The accountants close one month at a time. The CSV address learns two optional dates, from and to, and
then gives only the invoices dated between them, both days included. Without the dates it gives every
invoice, as before. A date written wrongly, or a from after the to, gets a clear error instead of a
file.

## Goal
GET /invoices.csv takes an optional date range, from and to, and gives only the invoices dated inside it.
Done when a request with both dates returns only that month's invoices.

## Acceptance criteria
- [ ] Given invoices dated 2026-09-30, 2026-10-01 and 2026-10-31, when GET
  \`/invoices.csv?from=2026-10-01&to=2026-10-31\` is called, then the file holds the two October ones.
- [ ] Both ends are included.
- [ ] Without from and to the file holds every invoice, as before.
- [ ] A date that is not YYYY-MM-DD gives 400 with a message that names the parameter.
- [ ] from after to gives 400.

## How to check
- \`npm test\`: tests for both ends, no range, a bad date and from after to.
- By hand: call the route with the dates of last month and compare the rows with the invoices page.

## Boundaries
- always: dates as YYYY-MM-DD, compared as calendar days.
- ask first: a date library.
- never: a new route for the range; it is the same /invoices.csv.

## Where to look
- \`src/server.js:6\` handle(): reads the request URL.
- \`src/invoices.js:3\` list(): the invoice date field.

## Out of scope
- Filters by customer.
- A date picker on the page.

## Why
The accountants close one month at a time and load only that month (D3).

## Dependencies
Blocked by T1: it adds the route. Blocks T4: the monthly mail takes one month.
` },
  { title: 'Monthly CSV by e-mail', slug: 'monthly-email', depends: 'T3', text: `## In plain words
The accountants asked not to download the file by hand every month. On the first day of each month the
shop sends them one mail with the CSV of the month before attached. A month without invoices still gets
its mail, with a file that holds only the header row. If no address is set, nothing is sent and the
shop writes why into its log.

## Goal
On the first day of each month the shop sends the CSV of the month before to the accountants' address.
Done when the mail with the attached file arrives once per month.

## Acceptance criteria
- [ ] Given the first day of a month, when the monthly job runs, then one mail goes to the configured
  address with invoices.csv of the month before attached.
- [ ] Running the job twice on the same day sends one mail.
- [ ] With no invoices that month the mail still goes, with the header-only file.
- [ ] Without a configured address the job sends nothing and logs why.

## How to check
- \`npm test\`: a test with a fake mailer and a fixed date.
- By hand: run the job with the date set to the first of the month and a test address; one mail with the
  file arrives.

## Boundaries
- always: the file of the mail is the one GET /invoices.csv gives for that month.
- ask first: a mail library, and where the address is set.
- never: real mails from the tests.

## Correct the priors
A job that only checks "is it the first of the month" sends again after every restart that day; it has
to remember the month it already sent.

## Where to look
- \`src/invoices.js:3\` list(): the invoices of the month.
- \`src/server.js:15\` start(): where the shop starts, and with it the job.
- \`package.json\`: no mail library yet.

## Out of scope
- Other mail recipients or a mail per customer.
- PDF invoices.

## Why
The accountants asked not to download the file by hand every month (D4).

## Dependencies
Blocked by T3: the mail takes one month's range.
` },
];

function planText(list, openq, next) {
  const later = list.length > 2 ? '- PDF invoices' : '- Filters by date or customer\n- PDF invoices\n- Sending the file by e-mail';
  const decisions = list.length > 2 ? '\nD3. A from/to date range on the same route - one route to keep, and the accountants close one month at a time.\nD4. A monthly job in the shop process sends the file - no new service to run for one mail a month.' : '';
  return `# csv-export

## In plain words
Today the invoices are only shown on the invoices page and given as JSON by GET /invoices, so the
accountants copy them by hand every month. Now one click on the invoices page gives a CSV file with the
same invoices, which they load into their accounting program without retyping. Done when the file from
the button loads there with one invoice per row.

## Level

## Decisions
D1. The CSV comes from a new route GET /invoices.csv beside GET /invoices - the list stays in one place (src/invoices.js) and the page only links to it.
D2. Comma-separated, UTF-8, a header row, totals in UAH with two decimals - what the accountants' program imports.${decisions}

## Contract

## Out of scope
${later}

## Design sketch
src/server.js gets a route /invoices.csv that turns list(orders) into CSV lines; public/invoices.html gets
a "Download CSV" button above the table that calls it.

## Terms
- Invoice: one paid order, as list() in src/invoices.js gives it.
- CSV: comma-separated values, one invoice per line after the header row.

## What was gathered

## Open questions
${openq ? 'Q1. Should the file use a semicolon, as Excel with a Ukrainian locale expects? - D2 and the T1 acceptance criteria depend on it.\n' : ''}
## Tickets
${list.map((t, i) => `T${i + 1} ${t.title}`).join('\n')}

## Next action
${next || (list.length > 2 ? 'Export the tickets.' : 'Final review of the tickets, then export them.')}
`;
}

// A draft csv-export as start-planning leaves it: the draft place, plan.md and the tickets written in full, each
// ticket reviewed as it is (last, so the review hashes match).
function draft({ where = 'pc', list = TICKETS.slice(0, 2), openq = false, next } = {}) {
  plans('settings', 'set', '--draft', where);
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
  // after_commit is the commit before the invoices: a hand-over has it to bring up to date.
  write(plan, fs.readFileSync(path.join(root, plan), 'utf8').replace(/^after_commit: .*$/m, `after_commit: ${git('rev-parse', '--short', 'HEAD~1')}`));
  plans('mark', 'set', 'csv-export', '--session', SID);
}

function planningReady() {
  write('AGENTS.md', '# Agents\n\nNo ticket or backlog files in this repository: tickets live in Jira.\nRun `npm test` before every commit.\nAmounts are in UAH.\n');
  commitAll('Add AGENTS.md');
  git('push', '-q', 'origin', 'main');
  planning({ next: 'Export the tickets.' });
  plans('state', 'csv-export', 'ready');
}

// A feature just named: start-planning has made its draft and marked the chat, the work not begun.
function planningNew() {
  invoices();
  plans('settings', 'set', '--draft', 'pc');
  plans('new', 'notification-system');
  plans('mark', 'set', 'notification-system', '--session', SID);
}

// A feature start-task handed over in a brief: start-planning made its draft from it and marked the chat.
function planningBrief() {
  invoices();
  plans('settings', 'set', '--draft', 'pc');
  const brief = '.keel/local/plans/briefs/notification-system-brief.md';
  write(brief, fs.readFileSync(path.join(__dirname, 'notification-system-brief.md'), 'utf8'));
  plans('new', 'notification-system');
  plans('brief', 'notification-system', brief);
  plans('mark', 'set', 'notification-system', '--session', SID);
}

// Commits as another person: the in-progress hint names the branch tip's author.
const commitAs = (name, email, msg) => { git('add', '-A'); git('-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg); };

function planned() {
  invoices();
  draft({ list: TICKETS });
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

module.exports = { planning, planningReady, planningNew, planningBrief, planned };
