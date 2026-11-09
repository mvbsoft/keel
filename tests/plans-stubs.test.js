'use strict';
// Stubs: tickets for a repository that is not on this machine. Planned in a draft, exported into this
// project's feature folder as <PREFIX>-S<n>, shown on the feature page with state unknown, never holding
// a ticket back, and turned into a full ticket once the repository is here. Throwaway repositories; no
// network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SCRIPTS, gitTest, FEATURE, PLAN, OUT, git, write, readRel, has, run, page, slash, line,
  repo, ticketText, stubText, planText, body, world, draft, exported, adminHere,
} = require('./fixtures/plans-stubs.js');
const { withCodeSections } = require(path.join(SCRIPTS, 'lib', 'plans-stubs.js'));
const { byKey } = require(path.join(SCRIPTS, 'lib', 'plans-state-read.js'));
const { ticketStructure } = require(path.join(SCRIPTS, 'lib', 'plans-format.js'));

test('a stub has the sections that need no code, and none of those that do', () => {
  const stub = `---\nid: T2\ntype: stub\nrepo: ADM\n---\n\n${stubText('T2')}`;
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
  assert.deepEqual(['ADM-S2', 'API-10', 'ADM-3', 'ADM-S1', 'API-9'].sort(byKey), ['ADM-3', 'ADM-S1', 'ADM-S2', 'API-9', 'API-10']);
});

gitTest('plans.js ticket --stub: a T-number of type stub for a repository not here; check takes it without the plan\'s repos', () => {
  const w = world();
  const made = draft(w);
  assert.deepEqual(made, [`created: ${PLAN}/tickets/T2-admin-counter.md`, 'ticket: T2']);
  const stub = readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`);
  assert.match(stub, /^---\nid: T2\ntype: stub\nrepo: ADM\ndepends_on: \[T1\]\nreview_hash: -\n---\n/);
  assert.equal(run(w.api, 'check', FEATURE)[0], 'check: clean (plan.md and 3 tickets)', run(w.api, 'check', FEATURE).join('\n'));
  // A stub with a section that needs the code is a problem.
  body(w.api, `${PLAN}/tickets/T2-admin-counter.md`, `${stubText('T2')}\n## Where to look\n\`src/admin.js\`\n`);
  assert.ok(run(w.api, 'check', FEATURE).includes('- T2: a stub has no "## Where to look" (it needs the code of the stub\'s repository)'));
  // Refused: this project, a repository on this machine, no prefix, with --repo, and in an exported feature.
  const web = repo(w.projects, 'web', 'WEB');
  run(w.api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  const refused = (...args) => run(w.api, 'ticket', FEATURE, '--title', 'X', ...args)[0];
  assert.equal(refused('--stub', 'API'), 'plans: ticket refused (--stub: API is this project: plan a ticket)');
  assert.equal(refused('--stub', 'WEB'), `plans: ticket refused (--stub: WEB is on this machine (${slash(web)}): plan a ticket for it (plans.js set ${FEATURE} --repos, then --repo WEB))`);
  assert.match(refused('--stub', 'x-1'), /^plans: ticket refused \(--stub: "X-1" is not a ticket prefix/);
  assert.match(refused('--stub'), /^plans: ticket refused \(--stub needs the prefix/);
  assert.equal(refused('--stub', 'ADM', '--repo', 'ADM'), 'plans: ticket refused (--stub names the repository itself: --stub WEB, without --repo)');
  assert.ok(!has(w.api, `${PLAN}/tickets/T4-x.md`));
  // Its repository arrives: check says to turn the stub into a ticket.
  const admin = repo(w.projects, 'admin', 'ADM');
  run(w.api, 'settings', 'set', '--repo', `ADM=${slash(admin)}`);
  assert.ok(run(w.api, 'check', FEATURE).includes(`note: T2: ADM is on this machine now: turn the stub into a ticket (plans.js ticket ${FEATURE} --from-stub T2)`));
});

gitTest('export: a stub goes into this project\'s feature folder as <PREFIX>-S<n>, listed in the overview, and never holds a ticket back', () => {
  const w = world();
  const out = exported(w);
  assert.equal(out[0], `exported: ${OUT}/ (2 tickets, 1 stub)`, out.join('\n'));
  assert.ok(out.includes(`- T2 -> ADM-S1: ${OUT}/ADM-S1-admin-counter.md (stub)`), out.join('\n'));
  assert.ok(out.includes(`- T3 -> API-2: ${OUT}/API-2-admin-event.md`), out.join('\n'));
  const stub = readRel(w.api, `${OUT}/ADM-S1-admin-counter.md`);
  assert.match(stub, /^---\ntype: stub\nkey: ADM-S1\nrepo: ADM\nfeature: message-notify\npage: [0-9a-f]{8}\ndepends_on: \[API-1\]\n---\n\n# \[ADM-S1\] Admin counter\n/);
  assert.match(stub, /^Needs the event of API-1\.$/m);
  assert.match(readRel(w.api, `${OUT}/API-2-admin-event.md`), /^depends_on: \[ADM-S1\]$/m);
  const readme = readRel(w.api, `${OUT}/README.md`);
  assert.match(readme, /^---\ntype: feature\n---\n/, 'the stub\'s repository is not one of the overview\'s repos');
  assert.match(readme, /^## Tickets\n- API-1 Event \(api\)\n- ADM-S1 Admin counter \(ADM\)\n- API-2 Event \(api\)$/m);
  assert.equal(run(w.api, 'check', FEATURE)[0], `check: clean (2 tickets in ${OUT}/)`, run(w.api, 'check', FEATURE).join('\n'));
  // The stub is no ticket: no state, not counted; a dependency on it lets API-2 start.
  write(w.api, `${OUT}/API-1-event.md`, readRel(w.api, `${OUT}/API-1-event.md`).replace('status: todo', 'status: done'));
  git(w.api, 'add', '-A');
  git(w.api, 'commit', '-q', '-m', 'Add the tickets');
  const view = run(w.api, 'tickets', 'API-2');
  assert.equal(view[1], `${FEATURE} (1 of 2 done)`, view.join('\n'));
  assert.ok(view.includes('  depends: ADM-S1 stub'), view.join('\n'));
  assert.equal(line(view, 'next'), `API-2 (${FEATURE})`);
  assert.ok(run(w.api, 'tickets', FEATURE).includes('  ADM-S1 Admin counter — stub (its repository is not on this machine)'));
  // A later stub of the same repository takes the next S-number.
  const second = 'chat-archive';
  run(w.api, 'new', second);
  run(w.api, 'ticket', second, '--title', 'Event');
  run(w.api, 'ticket', second, '--title', 'Admin archive', '--stub', 'ADM');
  body(w.api, `.keel/local/plans/keel/${second}/plan.md`, planText.replace(`# ${FEATURE}`, `# ${second}`));
  body(w.api, `.keel/local/plans/keel/${second}/tickets/T1-event.md`, ticketText('T1'));
  body(w.api, `.keel/local/plans/keel/${second}/tickets/T2-admin-archive.md`, stubText('T2'));
  run(w.api, 'reviewed', second, 'T1', 'T2');
  run(w.api, 'state', second, 'ready');
  assert.ok(run(w.api, 'export', second).includes(`- T2 -> ADM-S2: tickets/${second}/ADM-S2-admin-archive.md (stub)`));
});

gitTest('the feature page: a stub with its text, state unknown and its mark; a dependency on it unknown', () => {
  const w = world();
  exported(w);
  const out = page(w.api, FEATURE);
  const html = fs.readFileSync(line(out, 'page'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="feature-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.match(data.title, /^\[API, ADM\] - /);
  assert.deepEqual(data.tickets.map((t) => t.key), ['API-1', 'API-2', 'ADM-S1']);
  const stub = data.tickets[2];
  assert.equal(stub.stub, true);
  assert.equal(stub.state, 'state unknown');
  assert.equal(stub.repo, 'ADM');
  assert.deepEqual(stub.sections.map((s) => s.name), ['In plain words', 'Example', 'Goal', 'Acceptance criteria', 'How to check', 'Out of scope', 'Why', 'Dependencies']);
  assert.deepEqual(stub.depends.map((d) => [d.key, d.met]), [['API-1', false]]);
  assert.deepEqual(data.tickets[1].depends, [{ key: 'ADM-S1', met: null, state: 'state unknown', feature: null, where: null }]);
  assert.equal(data.labels.stub, 'stub');
  assert.match(data.labels.stub_title, /\{repo\}/);
  // A draft's stub is marked too.
  const w2 = world();
  draft(w2);
  const drafted = JSON.parse(/id="feature-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(line(page(w2.api, FEATURE), 'page'), 'utf8'))[1]);
  assert.deepEqual(drafted.tickets.map((t) => [t.key, Boolean(t.stub)]), [['T1', false], ['T2', true], ['T3', false]]);
  // As on the exported page: its state unknown, and a dependency on it unknown.
  assert.equal(drafted.tickets[1].state, 'state unknown');
  assert.deepEqual(drafted.tickets[2].depends, [{ key: 'T2', met: null, state: 'state unknown', feature: null, where: null }]);
});

gitTest('--from-stub in a draft: the stub becomes a ticket in place, its repository joins the plan, and check stops until the code sections are written', () => {
  const w = world();
  draft(w);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T2')[0], 'plans: ticket refused (--from-stub: ADM is not on this machine yet: plans.js settings set --repo ADM=<folder>)');
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T1')[0], 'plans: ticket refused (--from-stub: T1 is no stub)');
  const admin = adminHere(w);
  const out = run(w.api, 'ticket', FEATURE, '--from-stub', 't2');
  assert.equal(out[0], 'converted: T2 (stub -> ticket for ADM)', out.join('\n'));
  assert.ok(out.includes('repos: [API, ADM]'), out.join('\n'));
  assert.equal(out[out.length - 1], `next: write Boundaries, Correct the priors, Where to look from ${slash(admin)}, then plans.js check ${FEATURE} and a review of T2`);
  const ticket = readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`);
  assert.match(ticket, /^---\nid: T2\nrepo: ADM\ndepends_on: \[T1\]\nreview_hash: -\n---\n/);
  assert.match(ticket, /^## Where to look\n<file:line/m);
  assert.match(readRel(w.api, `${PLAN}/plan.md`), /^repos: \[API, ADM\]$/m);
  const check = run(w.api, 'check', FEATURE);
  assert.ok(check.some((l) => /^- T2: placeholder /.test(l)), check.join('\n'));
});

gitTest('--from-stub in an exported feature: the ticket goes to the stub\'s repository with replaces:, the overview follows, and a dependency on the stub reads it', () => {
  const w = world();
  exported(w);
  git(w.api, 'add', '-A');
  git(w.api, 'commit', '-q', '-m', 'Add the tickets');
  assert.equal(line(run(w.api, 'tickets', FEATURE), 'next'), `API-1 (${FEATURE})`);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S9')[0], `plans: ticket refused (--from-stub: no stub ADM-S9 in ${OUT}/)`);
  const admin = adminHere(w);
  assert.ok(run(w.api, 'check', FEATURE).includes(`note: ADM-S1: ADM is on this machine now: turn the stub into a ticket (plans.js ticket ${FEATURE} --from-stub ADM-S1)`));
  assert.ok(run(w.api, 'tickets', FEATURE).includes(`  ADM-S1 Admin counter — stub (ADM is on this machine now: plans.js ticket ${FEATURE} --from-stub ADM-S1)`));
  // Not ready there: uncommitted changes stop it, nothing is written.
  write(admin, 'src/wip.js', '1;\n');
  const stopped = run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1');
  assert.equal(stopped[0], 'plans: ticket refused (--from-stub: ADM is not ready)', stopped.join('\n'));
  assert.ok(has(w.api, `${OUT}/ADM-S1-admin-counter.md`) && !has(admin, OUT));
  fs.rmSync(path.join(admin, 'src', 'wip.js'));

  const out = run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1');
  assert.equal(out[0], 'converted: ADM-S1 -> ADM-1', out.join('\n'));
  assert.ok(out.includes(`created: ${slash(admin)}/${OUT}/ADM-1-admin-counter.md`), out.join('\n'));
  assert.match(line(out, 'stub'), /^moved to keel's trash: batch \d{8}-\d{6}/);
  const ticket = readRel(admin, `${OUT}/ADM-1-admin-counter.md`);
  assert.match(ticket, /^---\ntype: ticket\nkey: ADM-1\nstatus: todo\nfeature: message-notify\npage: [0-9a-f]{8}\nbranch: message-notify\nmerge_into: main\ndepends_on: \[API-1\]\nreplaces: ADM-S1\n---\n\n# \[ADM-1\] Admin counter\n/);
  assert.match(ticket, /^## Boundaries\n- always: </m);
  assert.ok(!has(w.api, `${OUT}/ADM-S1-admin-counter.md`), 'the stub left');
  const overview = readRel(w.api, `${OUT}/README.md`);
  assert.equal(readRel(admin, `${OUT}/README.md`), overview, 'the same overview in both');
  assert.match(overview, /^---\ntype: feature\nrepos: \[API, ADM\]\n---\n/);
  assert.match(overview, /^- ADM-1 Admin counter \(admin\)$/m);
  assert.doesNotMatch(overview, /ADM-S1/);
  // API-2 still says ADM-S1: it now waits for ADM-1, which is to do.
  assert.equal(run(w.api, 'check', FEATURE)[0], `check: clean (2 tickets in ${OUT}/)`, run(w.api, 'check', FEATURE).join('\n'));
  write(w.api, `${OUT}/API-1-event.md`, readRel(w.api, `${OUT}/API-1-event.md`).replace('status: todo', 'status: done'));
  git(w.api, 'add', '-A');
  git(w.api, 'commit', '-q', '-m', 'Convert the stub');
  git(admin, 'add', '-A');
  git(admin, 'commit', '-q', '-m', 'Add the ticket');
  const view = run(w.api, 'tickets', 'API-2');
  assert.ok(view.some((l) => /^ {2}depends: ADM-1 to do \(/.test(l)), view.join('\n'));
  assert.equal(line(view, 'next'), 'none');
});
