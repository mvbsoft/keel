'use strict';
// Stubs: tickets for a repository that is not on this machine, named by that repository's name. Planned
// as T<n> of type stub, noted by check once the repository is here, and turned into a full ticket in
// place. Throwaway repositories; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SCRIPTS, gitTest, CONFIG, FEATURE, PLAN, readRel, has, script, run, slash, head, repo, world, ticketText, planText, body,
} = require('./fixtures/plans-repos.js');
const { withCodeSections } = require(path.join(SCRIPTS, 'lib', 'plans-stubs.js'));
const { ticketStructure } = require(path.join(SCRIPTS, 'lib', 'plans-format.js'));

const page = script('feature-page.js');
const line = (out, name) => (out.find((l) => l.startsWith(`${name}: `)) || '').slice(name.length + 2);

const stubText = (id) => `# [${id}] Admin counter

## In plain words
The operator sees the number of new messages next to Chats.

## Example
- A client writes to support -> the admin shows 1 next to Chats.

## Goal
The admin shows the unread messages and updates them on the event.

## Acceptance criteria
- [ ] A client writes, then the number grows by one

## How to check
Open the admin as an operator, write to support from another account: 1 shows next to Chats.

## Out of scope
Sounds.

## Why
D1.

## Dependencies
Needs the event of T1.
`;

// A draft: T1 the event, T2 the admin's stub depending on it, T3 an api ticket that needs the stub.
function draft(w) {
  run(w.api, 'new', FEATURE);
  run(w.api, 'ticket', FEATURE, '--title', 'Event');
  const made = run(w.api, 'ticket', FEATURE, '--title', 'Admin counter', '--stub', 'admin-ui', '--depends', 'T1');
  run(w.api, 'ticket', FEATURE, '--title', 'Event for the admin', '--slug', 'admin-event', '--depends', 'T2');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.api, `${PLAN}/tickets/T1-event.md`, ticketText('T1', 'src/app.js:1'));
  body(w.api, `${PLAN}/tickets/T2-admin-counter.md`, stubText('T2'));
  body(w.api, `${PLAN}/tickets/T3-admin-event.md`, ticketText('T3', 'src/app.js:1'));
  return made;
}

// The admin repository arrives: on this machine and in the repos map.
function adminHere(w) {
  const admin = repo(w.projects, 'admin-ui', CONFIG());
  run(w.api, 'settings', 'set', '--repo', `admin-ui=${slash(admin)}`);
  return admin;
}

test('a stub has the sections that need no code, and none of those that do', () => {
  const stub = `---\nid: T2\ntype: stub\nrepo: admin-ui\n---\n\n${stubText('T2')}`;
  assert.deepEqual(ticketStructure('T2', stub), []);
  const asTicket = ticketStructure('T2', stub.replace('type: stub\n', ''));
  assert.ok(asTicket.includes('T2: no section "## Boundaries"') && asTicket.includes('T2: no section "## Where to look"'), asTicket.join('\n'));
  const full = withCodeSections(stubText('T2'));
  assert.deepEqual(ticketStructure('T2', `---\nid: T2\ntype: stub\n---\n\n${full}`), [
    'T2: a stub has no "## Boundaries" (it needs the code of the stub\'s repository)',
    'T2: a stub has no "## Correct the priors" (it needs the code of the stub\'s repository)',
    'T2: a stub has no "## Where to look" (it needs the code of the stub\'s repository)',
  ]);
  // The code sections come in their places, as the ticket template has them.
  const heads = [...full.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(heads, ['In plain words', 'Example', 'Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Correct the priors', 'Where to look', 'Out of scope', 'Why', 'Dependencies']);
  assert.deepEqual(ticketStructure('T2', `---\nid: T2\n---\n\n${full}`), []);
  assert.match(full, /^- always: <what to do every time in this ticket>/m, 'a placeholder check stops on');
});

gitTest('plans.js ticket --stub <name>: a T-number of type stub for a repository not here; check notes it once the repository is here', () => {
  const w = world();
  const made = draft(w);
  assert.deepEqual(made, [`created: ${PLAN}/tickets/T2-admin-counter.md`, 'ticket: T2']);
  assert.match(readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`), /^---\nid: T2\ntype: stub\nstatus: draft\nrepo: admin-ui\ndepends_on: T1\nreview_hash: -\n---\n/);
  assert.doesNotMatch(readRel(w.api, `${PLAN}/plan.md`), /admin-ui/, 'a stub records no commit: its repository is not here');
  assert.deepEqual(run(w.api, 'check', FEATURE), ['check: clean (plan.md and 3 tickets)']);
  // A stub with a section that needs the code is a problem; so is a repo: of this project.
  const stubFile = `${PLAN}/tickets/T2-admin-counter.md`;
  body(w.api, stubFile, `${stubText('T2')}\n## Where to look\n\`src/admin.js\`\n`);
  assert.ok(run(w.api, 'check', FEATURE).includes('- T2: a stub has no "## Where to look" (it needs the code of the stub\'s repository)'));
  body(w.api, stubFile, stubText('T2'));
  fs.writeFileSync(path.join(w.api, stubFile), readRel(w.api, stubFile).replace('repo: admin-ui', 'repo: api'));
  assert.ok(run(w.api, 'check', FEATURE).includes('- T2: a stub\'s repo "api" is not another repository\'s name'));
  fs.writeFileSync(path.join(w.api, stubFile), readRel(w.api, stubFile).replace('repo: api', 'repo: admin-ui'));
  // Refused: this project, a repository on this machine, no name, with --repo.
  const refused = (...args) => run(w.api, 'ticket', FEATURE, '--title', 'X', ...args)[0];
  assert.equal(refused('--stub', 'api'), 'plans: ticket refused (--stub: api is this project: plan a ticket)');
  assert.equal(refused('--stub', 'web'), `plans: ticket refused (--stub: web is on this machine (${slash(w.web)}): plan a ticket for it (--repo web))`);
  assert.equal(refused('--stub', 'my admin'), 'plans: ticket refused (--stub: "my admin" is not a repository name)');
  assert.equal(refused('--stub'), 'plans: ticket refused (--stub needs the name of the repository that is not here: --stub <name>)');
  assert.equal(refused('--stub', 'admin-ui', '--repo', 'admin-ui'), 'plans: ticket refused (--repo and --stub: one of --repo, --elsewhere, --stub)');
  assert.ok(!has(w.api, `${PLAN}/tickets/T4-x.md`));
  // Its repository arrives: check says the stub can become a full ticket; a stub is never a problem for it.
  adminHere(w);
  assert.deepEqual(run(w.api, 'check', FEATURE), ['check: clean (plan.md and 3 tickets)', `note: stub T2 can become a full ticket: admin-ui is on this machine now (plans.js ticket ${FEATURE} --from-stub T2)`]);
});

gitTest('--from-stub: the stub becomes a full ticket in place once its repository is here; check stops until the code sections are written; the plan keeps its state', () => {
  const w = world();
  draft(w);
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3');
  assert.deepEqual(run(w.api, 'state', FEATURE, 'ready'), ['status: ready', 'ready: T1, T2, T3']);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T2')[0], 'plans: ticket refused (--from-stub: admin-ui is not on this machine yet: plans.js settings set --repo admin-ui=<folder>)');
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T1')[0], 'plans: ticket refused (--from-stub: T1 is no stub)');
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T9')[0], `plans: ticket refused (--from-stub: no ticket T9 in ${FEATURE})`);
  const admin = adminHere(w);
  const out = run(w.api, 'ticket', FEATURE, '--from-stub', 't2');
  assert.deepEqual(out, [
    'converted: T2 (stub -> ticket for admin-ui)',
    `file: ${PLAN}/tickets/T2-admin-counter.md`,
    `next: write Boundaries, Correct the priors, Where to look from ${slash(admin)}, then plans.js check ${FEATURE} and a review of T2`,
  ]);
  const ticket = readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`);
  assert.match(ticket, /^---\nid: T2\nstatus: ready\nrepo: admin-ui\ndepends_on: T1\nreview_hash: [0-9a-f]{12}\n---\n/);
  assert.match(ticket, /^## Where to look\n<file:line/m);
  const plan = readRel(w.api, `${PLAN}/plan.md`);
  assert.match(plan, /^status: ready$/m, 'the plan keeps its state');
  assert.match(plan, new RegExp(`^after_commit_repos: admin-ui=${head(admin)}$`, 'm'));
  const check = run(w.api, 'check', FEATURE);
  assert.ok(check.some((l) => /^- T2: placeholder /.test(l)), check.join('\n'));
  assert.ok(run(w.api, 'review', FEATURE).includes(`- T2: changed since review (admin-ui: ${slash(admin)})`), 'the ticket needs a review');
});

gitTest('the feature page marks a stub', () => {
  const w = world();
  draft(w);
  const data = JSON.parse(/id="feature-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(line(page(w.api, FEATURE), 'page'), 'utf8'))[1]);
  assert.deepEqual(data.tickets.map((t) => [t.key, Boolean(t.stub)]), [['T1', false], ['T2', true], ['T3', false]]);
  assert.equal(data.tickets[1].repo, 'admin-ui');
  assert.deepEqual(data.tickets[1].sections.map((s) => s.name), ['In plain words', 'Example', 'Goal', 'Acceptance criteria', 'How to check', 'Out of scope', 'Why', 'Dependencies']);
});

test('the page template draws a stub\'s mark and note', () => {
  // The page's script lives in page.js beside index.html.
  const script = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'feature-page', 'page.js'), 'utf8');
  for (const key of ["'stub'", "'stub_title'", "'stub_note'"]) assert.ok(script.includes(key), key);
});
