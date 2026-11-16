'use strict';
// A ticket that lives in another repository (ticket --elsewhere <name>): its file and a minimal plan.md
// with home: there, a type: elsewhere file with the same T-number here; check, tickets, next, the states
// and the done suggestion read its status there through the repos map. Throwaway repositories; no
// network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FEATURE, PLAN, THERE, gitTest, git, write, readRel, has, run, script, slash, head, repo, world, ticketText, planText, body,
} = require('./fixtures/plans-repos.js');

// A draft in api: T1 lives in web (src/badge.js is only there), T2 here depends on it.
function draft(w) {
  run(w.api, 'new', FEATURE);
  const made = run(w.api, 'ticket', FEATURE, '--title', 'Badge', '--elsewhere', 'web');
  run(w.api, 'ticket', FEATURE, '--title', 'Event', '--depends', 'T1');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.web, `${THERE}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));
  body(w.api, `${PLAN}/tickets/T2-event.md`, ticketText('T2', 'src/app.js:1'));
  return made;
}

gitTest('ticket --elsewhere: the ticket and a plan.md with home: in the other repository, a type: elsewhere file here with the same number', () => {
  const w = world();
  const { api, web } = w;
  const made = draft(w);
  assert.deepEqual(made, [
    `created: ${PLAN}/tickets/T1-badge.md`,
    `created: ${slash(web)}/${THERE}/plan.md`,
    `created: ${slash(web)}/${THERE}/tickets/T1-badge.md`,
    'ticket: T1',
    'note: web has new files in its working tree: commit them there',
  ]);
  assert.equal(readRel(api, `${PLAN}/tickets/T1-badge.md`), `---\nid: T1\ntype: elsewhere\nrepo: web\n---\n\n# [T1] Badge\n\nLives in web: ${THERE}/tickets/T1-badge.md\n`);
  assert.match(readRel(web, `${THERE}/plan.md`), new RegExp(`^---\ntype: plan\nstatus: draft\nfeature: ${FEATURE}\nhome: api\n---\n`));
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^---\nid: T1\ntype: ticket\nstatus: draft\ndepends_on:\nreview_hash: -\n---\n/);
  assert.match(readRel(api, `${PLAN}/plan.md`), /^last_ticket: 2$/m);
  assert.match(readRel(api, `${PLAN}/plan.md`), new RegExp(`^after_commit_repos: web=${head(web)}$`, 'm'));
  // A second one goes into the same folder there; the number is still this plan's.
  const next = run(api, 'ticket', FEATURE, '--title', 'Badge colour', '--elsewhere', 'web', '--depends', 'T1');
  assert.deepEqual(next.slice(0, 3), [`created: ${PLAN}/tickets/T3-badge-colour.md`, `created: ${slash(web)}/${THERE}/tickets/T3-badge-colour.md`, 'ticket: T3']);
  assert.match(readRel(web, `${THERE}/tickets/T3-badge-colour.md`), /^depends_on: T1$/m);

  // There, the folder is a feature planned elsewhere: its tickets come from api.
  assert.match(run(web, 'list')[1], new RegExp(`^- ${FEATURE}: draft · open Q 0 · tickets 2 · `));
  assert.equal(run(web, 'ticket', FEATURE, '--title', 'X')[0], `plans: ticket refused (the plan of ${FEATURE} is in api: its tickets are made there (plans.js ticket ${FEATURE} --elsewhere <this repository's name>))`);
  assert.equal(run(web, 'state', FEATURE, 'ready')[0], `plans: state refused (the plan of ${FEATURE} is in api: its state changes there)`);

  const refused = (...args) => run(api, 'ticket', FEATURE, '--title', 'X', ...args)[0];
  run(api, 'settings', 'set', '--repo', `admin=${slash(w.admin)}`);
  assert.equal(refused('--elsewhere', 'admin'), `plans: ticket refused (--elsewhere: ${slash(w.admin)} (admin): no keel; plan the ticket here (--repo admin))`);
  assert.equal(refused('--elsewhere', 'api'), 'plans: ticket refused (--elsewhere: api is this project)');
  assert.equal(refused('--elsewhere', 'web', '--repo', 'web'), 'plans: ticket refused (--repo and --elsewhere: one of --repo, --elsewhere, --stub)');
  // A feature of that name that web plans itself is not this plan's.
  const mobile = repo(w.projects, 'mobile', require('./fixtures/plans-repos.js').CONFIG());
  run(mobile, 'new', FEATURE);
  run(api, 'settings', 'set', '--repo', `mobile=${slash(mobile)}`);
  assert.equal(refused('--elsewhere', 'mobile'), `plans: ticket refused (--elsewhere: mobile has its own feature ${FEATURE} (${slash(mobile)}/.keel/local/plans/keel/${FEATURE}/): plan the ticket here (--repo mobile))`);
  // keel writes into another repository only through this machine's own repos map.
  git(api, 'add', '-f', '.keel/local/plans/keel/settings.json');
  assert.match(refused('--elsewhere', 'web'), /^plans: ticket refused \(--elsewhere: the repos map \.keel\/local\/plans\/keel\/settings\.json is in git;/);
  assert.ok(!has(api, `${PLAN}/tickets/T4-x.md`) && !has(web, `${THERE}/tickets/T4-x.md`));
});

gitTest('check, review, states, tickets and next read an elsewhere ticket in its repository', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  assert.deepEqual(run(api, 'check', FEATURE), ['check: clean (plan.md and 2 tickets)']);
  body(web, `${THERE}/tickets/T1-badge.md`, ticketText('T1', 'src/missing.js:1'));
  assert.ok(run(api, 'check', FEATURE).includes(`- T1: src/missing.js in Where to look does not exist in ${slash(web)}`));
  body(web, `${THERE}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));
  // There, the folder checks as tickets only: its plan.md holds no plan, and T1's depends_on names api's tickets.
  assert.deepEqual(run(web, 'check', FEATURE), ['check: clean (plan.md and 1 tickets)']);

  assert.deepEqual(run(api, 'review', FEATURE).slice(2), [`repos: web=${slash(web)}`, `- T1: never reviewed (in web: ${slash(web)})`, '- T2: never reviewed']);
  assert.deepEqual(run(api, 'reviewed', FEATURE, 'T1', 'T2'), ['reviewed: 2', '- T1: reviewed', '- T2: reviewed']);
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^review_hash: [0-9a-f]{12}$/m);
  assert.doesNotMatch(readRel(api, `${PLAN}/tickets/T1-badge.md`), /review_hash|status/);
  assert.deepEqual(run(api, 'state', FEATURE, 'ready'), ['status: ready', 'ready: T1, T2', 'note: web has changes in its working tree: commit them there']);
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^status: ready$/m);
  assert.match(readRel(web, `${THERE}/plan.md`), /^status: ready$/m, 'the plan\'s status goes there too');

  let out = run(api, 'tickets', FEATURE);
  assert.ok(out.includes('  T1 Ticket T1 — next · in web') && out.includes('  T2 Ticket T2 — ready'), out.join('\n'));
  assert.equal(out[out.length - 1], `next: ${FEATURE}/T1`);
  out = run(api, 'tickets', `${FEATURE}/T1`);
  assert.ok(out.includes(`  file: ${slash(web)}/${THERE}/tickets/T1-badge.md`), out.join('\n'));

  // A session in web works on its ticket there; api reads it.
  assert.deepEqual(run(web, 'status', FEATURE, 'T1', 'in-progress'), ['status: T1 in-progress']);
  assert.match(readRel(api, `${PLAN}/plan.md`), /^status: ready$/m, 'a status there never moves the plan');
  assert.equal(run(api, 'tickets', FEATURE).at(-1), 'next: none', 'T2 waits for T1');
  assert.deepEqual(run(api, 'status', FEATURE, 'T1', 'done'), ['status: T1 done']);
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^status: done$/m);
  assert.equal(run(api, 'tickets', FEATURE).at(-1), `next: ${FEATURE}/T2`);
  run(api, 'status', FEATURE, 'T2', 'in-progress');
  assert.deepEqual(run(api, 'status', FEATURE, 'T2', 'done'), ['status: T2 done', `plan: every ticket is done or abandoned: plans.js state ${FEATURE} done`]);
  assert.ok(run(api, 'check', FEATURE).includes(`plan: every ticket is done or abandoned: plans.js state ${FEATURE} done`));
});

gitTest('next prefers a ticket of this repository; an elsewhere ticket is next only when none here can start', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  write(api, `${PLAN}/tickets/T2-event.md`, readRel(api, `${PLAN}/tickets/T2-event.md`).replace(/^depends_on: T1$/m, 'depends_on:'));
  run(api, 'reviewed', FEATURE, 'T1', 'T2');
  run(api, 'state', FEATURE, 'ready');
  let out = run(api, 'tickets', FEATURE);
  assert.ok(out.includes('  T1 Ticket T1 — ready · in web') && out.includes('  T2 Ticket T2 — next'), out.join('\n'));
  assert.equal(out.at(-1), `next: ${FEATURE}/T2`);
  run(api, 'status', FEATURE, 'T2', 'in-progress');
  out = run(api, 'tickets', FEATURE);
  assert.ok(out.includes('  T1 Ticket T1 — next · in web'), out.join('\n'));
  assert.equal(out.at(-1), `next: ${FEATURE}/T1`);
  assert.equal(readRel(web, `${THERE}/tickets/T1-badge.md`).match(/^status: (.*)$/m)[1], 'ready');
});

gitTest('in the repository an elsewhere ticket lives in, its last ticket done gives no plan: line: the plan is done at home', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  run(api, 'reviewed', FEATURE, 'T1', 'T2');
  run(api, 'state', FEATURE, 'ready');
  run(web, 'status', FEATURE, 'T1', 'in-progress');
  assert.deepEqual(run(web, 'status', FEATURE, 'T1', 'done'), ['status: T1 done']);
  assert.ok(!run(web, 'check', FEATURE).some((l) => l.startsWith('plan:')), run(web, 'check', FEATURE).join('\n'));
  assert.ok(!run(web, 'tickets', FEATURE).some((l) => l.startsWith('plan:')), run(web, 'tickets', FEATURE).join('\n'));
});

gitTest('an elsewhere ticket that cannot be read is unknown: check notes it, next skips it, done needs the user\'s confirmation', () => {
  const w = world();
  const { tmp, api, web } = w;
  draft(w);
  run(api, 'reviewed', FEATURE, 'T1', 'T2');
  run(api, 'state', FEATURE, 'ready');
  run(api, 'status', FEATURE, 'T1', 'abandoned', '--reason', 'not needed');
  run(api, 'settings', 'set', '--repo', `web=${slash(tmp)}/gone`);
  const why = `${slash(tmp)}/gone is not on this machine`;
  assert.deepEqual(run(api, 'check', FEATURE), ['check: clean (plan.md and 2 tickets)', `note: T1: in web, not checked (${why})`]);
  assert.ok(run(api, 'tickets', FEATURE).includes(`  T1 Badge — unknown (${why})`));
  assert.equal(run(api, 'status', FEATURE, 'T1', 'done')[0], `plans: status refused (T1 cannot be read in web (${why}))`);
  assert.equal(run(api, 'reviewed', FEATURE, 'T1')[0], `plans: reviewed refused (T1 cannot be read in web (${why}))`);
  // T2 is done: only T1's status is left to the user.
  fs.writeFileSync(path.join(api, PLAN, 'tickets', 'T2-event.md'), readRel(api, `${PLAN}/tickets/T2-event.md`).replace('status: ready', 'status: done'));
  const hint = `plan: every other ticket is done or abandoned; the status of T1 is unknown (${why}): confirmation needed, ask the user whether it is done, then plans.js state ${FEATURE} done --confirm`;
  assert.ok(run(api, 'check', FEATURE).includes(hint), run(api, 'check', FEATURE).join('\n'));
  assert.ok(run(api, 'tickets', FEATURE).includes(hint));
  assert.equal(run(api, 'state', FEATURE, 'done')[0], `plans: state refused (not every ticket is done or abandoned: T1 unknown (${why}); confirm with the user that they are done or abandoned, then --confirm)`);
  assert.equal(run(api, 'state', FEATURE, 'ready', '--confirm')[0], 'plans: state refused (--confirm takes no value and goes only with done)');
  assert.deepEqual(run(api, 'state', FEATURE, 'done', '--confirm'), ['status: done']);
  // Back on this machine, the status there is as it was.
  run(api, 'settings', 'set', '--repo', `web=${slash(web)}`);
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^status: abandoned$/m);
  assert.match(readRel(web, `${THERE}/plan.md`), /^status: ready$/m, 'the plan there was not reachable when it was done');
});

gitTest('drop and abandon reach an elsewhere ticket; a ticket missing there is unknown', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  assert.equal(run(api, 'drop', FEATURE)[0], `plans: drop refused (not every ticket of ${FEATURE} is done or abandoned: T1 draft, T2 draft)`);
  assert.deepEqual(run(api, 'state', FEATURE, 'abandoned', '--reason', 'no time'), ['status: abandoned', 'abandoned: T1, T2', 'note: web has changes in its working tree: commit them there']);
  assert.match(readRel(web, `${THERE}/tickets/T1-badge.md`), /^reason: no time$/m);
  assert.match(readRel(web, `${THERE}/plan.md`), /^status: abandoned$/m);
  fs.rmSync(path.join(web, THERE, 'tickets', 'T1-badge.md'));
  assert.ok(run(api, 'check', FEATURE).includes(`note: T1: in web, not checked (no T1 in ${slash(web)}/${THERE}/tickets/)`));
  write(web, `${THERE}/plan.md`, readRel(web, `${THERE}/plan.md`).replace('home: api', 'home: shop'));
  assert.ok(run(api, 'check', FEATURE).includes(`note: T1: in web, not checked (${FEATURE} in ${slash(web)} belongs to shop)`));
});

gitTest('the feature page reads an elsewhere ticket in its repository, as plans.js tickets does', () => {
  const w = world();
  draft(w);
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2');
  run(w.api, 'state', FEATURE, 'ready');
  const out = script('feature-page.js')(w.api, FEATURE);
  const file = (out.find((l) => l.startsWith('page: ')) || '').slice(6);
  const data = JSON.parse(/id="feature-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);
  assert.deepEqual(data.tickets.map((t) => [t.key, t.state, t.next, t.repo]), [['T1', 'to do', true, 'web'], ['T2', 'to do', false, 'api']]);
  assert.equal(run(w.api, 'tickets', FEATURE).at(-1), `next: ${FEATURE}/T1`);
});
