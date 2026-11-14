'use strict';
// Stubs at their edges: several stubs of one repository, a conversion that fails or runs twice at once,
// a plan of stubs only, the end of a feature with a stub left, stub keys of other features and projects,
// a stub's repository not fetched since its conversion, and stubs that depend on stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  SCRIPTS, gitTest, FEATURE, PLAN, OUT, git, write, readRel, has, run, page, slash, line,
  repo, planText, ticketText, stubText, body, world, draft, exported, adminHere,
} = require('./fixtures/plans-stubs.js');

const runAsync = (dir, ...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { env: { ...process.env, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'en' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.on('close', () => resolve(out.trim().split('\n')));
});
const commit = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };
const done = (dir, rel) => write(dir, rel, readRel(dir, rel).replace('status: todo', 'status: done'));
const pageData = (dir, feature) => JSON.parse(/id="feature-data">([\s\S]*?)<\/script>/.exec(fs.readFileSync(line(page(dir, feature), 'page'), 'utf8'))[1]);

// A whole plan in project `dir`: T1 an event, T2 the admin's stub on T1, T3 a ticket on the stub; exported.
function planned(dir, feature) {
  const at = `.keel/local/plans/keel/${feature}`;
  run(dir, 'new', feature);
  run(dir, 'ticket', feature, '--title', 'Event');
  run(dir, 'ticket', feature, '--title', 'Admin counter', '--stub', 'ADM', '--depends', 'T1');
  run(dir, 'ticket', feature, '--title', 'Event for the admin', '--slug', 'admin-event', '--depends', 'T2');
  body(dir, `${at}/plan.md`, planText.replace(`# ${FEATURE}`, `# ${feature}`));
  body(dir, `${at}/tickets/T1-event.md`, ticketText('T1'));
  body(dir, `${at}/tickets/T2-admin-counter.md`, stubText('T2'));
  body(dir, `${at}/tickets/T3-admin-event.md`, ticketText('T3'));
  run(dir, 'reviewed', feature, 'T1', 'T2', 'T3');
  run(dir, 'state', feature, 'ready');
  return run(dir, 'export', feature);
}

gitTest('two stubs of one repository convert one after the other into its feature folder; a failed one takes back only what it wrote', () => {
  const w = world();
  draft(w);
  // T4: a second admin stub, which T2 needs; T2 names a research report.
  run(w.api, 'ticket', FEATURE, '--title', 'Admin archive', '--stub', 'ADM');
  body(w.api, `${PLAN}/tickets/T4-admin-archive.md`, stubText('T4').replace('Admin counter', 'Admin archive'));
  write(w.api, `${PLAN}/tickets/T2-admin-counter.md`, readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`)
    .replace('depends_on: [T1]', 'depends_on: [T1, T4]').replace('Needs the event of T1.', 'Needs the event of T1 and T4; see research/notes.md.'));
  write(w.api, `${PLAN}/research/notes.md`, '# Notes\n\nThe admin polls.\n');
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3', 'T4');
  assert.deepEqual(run(w.api, 'state', FEATURE, 'ready'), ['status: ready']);
  const out = run(w.api, 'export', FEATURE);
  assert.equal(out[0], `exported: ${OUT}/ (2 tickets, 2 stubs)`, out.join('\n'));
  commit(w.api, 'Add the tickets');
  const admin = adminHere(w);

  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S2')[0], 'converted: ADM-S2 -> ADM-1');
  commit(admin, 'Add ADM-1');
  // On the page the stub that needs it reads the ticket that replaced it.
  const s1 = pageData(w.api, FEATURE).tickets.find((t) => t.key === 'ADM-S1');
  assert.deepEqual(s1.depends.map((d) => [d.key, d.state]), [['API-1', 'to do'], ['ADM-1', 'to do']]);

  // The second stub of the same repository goes into the folder the first made. A write that fails
  // there (a file where research/ should be) takes back its own files only.
  const overview = readRel(w.api, `${OUT}/README.md`);
  const theirs = readRel(admin, `${OUT}/README.md`);
  write(admin, `${OUT}/research`, 'not a folder\n');
  const failed = run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1');
  assert.match(failed[0], /^plans: ticket refused \(.*; nothing converted\)$/, failed.join('\n'));
  assert.ok(has(admin, `${OUT}/ADM-1-admin-archive.md`), 'the ticket converted before stays');
  assert.ok(!has(admin, `${OUT}/ADM-2-admin-counter.md`));
  assert.equal(readRel(admin, `${OUT}/README.md`), theirs);
  assert.equal(readRel(w.api, `${OUT}/README.md`), overview);
  assert.ok(has(w.api, `${OUT}/ADM-S1-admin-counter.md`), 'the stub is back');
  fs.rmSync(path.join(admin, OUT, 'research'));

  const second = run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1');
  assert.equal(second[0], 'converted: ADM-S1 -> ADM-2', second.join('\n'));
  assert.match(readRel(admin, `${OUT}/ADM-2-admin-counter.md`), /^depends_on: \[API-1, ADM-S2\]\nreplaces: ADM-S1$/m);
  assert.ok(has(admin, `${OUT}/research/notes.md`));
  assert.equal(readRel(admin, `${OUT}/README.md`), readRel(w.api, `${OUT}/README.md`));
  assert.match(readRel(admin, `${OUT}/README.md`), /^## Tickets\n- API-1 Event \(api\)\n- ADM-2 Admin counter \(admin\)\n- API-2 Event \(api\)\n- ADM-1 Admin archive \(admin\)$/m);
  // In the admin repository its own stub key reads the ticket there that replaced it: ADM-2 waits.
  commit(admin, 'Add ADM-2');
  const there = run(admin, 'tickets', 'ADM-2');
  assert.ok(there.some((l) => /^ {2}depends: API-1 not checked \(.*\), ADM-1 to do \(/.test(l)), there.join('\n'));
  assert.equal(line(there, 'next'), `ADM-1 (${FEATURE})`);
  assert.ok(!run(admin, 'check', FEATURE).some((l) => l.includes('no folder for ADM')));
});

gitTest('in the stub\'s own repository a ticket on a sibling stub not converted yet is not held back', () => {
  const w = world();
  draft(w);
  run(w.api, 'ticket', FEATURE, '--title', 'Admin archive', '--stub', 'ADM');
  body(w.api, `${PLAN}/tickets/T4-admin-archive.md`, stubText('T4').replace('Admin counter', 'Admin archive'));
  write(w.api, `${PLAN}/tickets/T2-admin-counter.md`, readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`).replace('depends_on: [T1]', 'depends_on: [T1, T4]'));
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3', 'T4');
  run(w.api, 'state', FEATURE, 'ready');
  run(w.api, 'export', FEATURE);
  commit(w.api, 'Add the tickets');
  const admin = adminHere(w);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1')[0], 'converted: ADM-S1 -> ADM-1');
  commit(admin, 'Add ADM-1');
  const view = run(admin, 'tickets', 'ADM-1');
  assert.ok(view.some((l) => /^ {2}depends: .*ADM-S2 stub$/.test(l)), view.join('\n'));
  assert.equal(line(view, 'next'), `ADM-1 (${FEATURE})`);
  assert.ok(!run(admin, 'check', FEATURE).some((l) => l.includes('ADM-S2, which does not exist')), run(admin, 'check', FEATURE).join('\n'));
});

gitTest('the page reads a converted stub for a stub whose own repository is not here', () => {
  const w = world();
  draft(w);
  run(w.api, 'ticket', FEATURE, '--title', 'Mobile badge', '--stub', 'MOB', '--depends', 'T2');
  body(w.api, `${PLAN}/tickets/T4-mobile-badge.md`, stubText('T4').replace('Admin counter', 'Mobile badge'));
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3', 'T4');
  run(w.api, 'state', FEATURE, 'ready');
  run(w.api, 'export', FEATURE);
  commit(w.api, 'Add the tickets');
  adminHere(w);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1')[0], 'converted: ADM-S1 -> ADM-1');
  const mob = pageData(w.api, FEATURE).tickets.find((t) => t.key === 'MOB-S1');
  assert.deepEqual(mob.depends.map((d) => [d.key, d.state]), [['ADM-1', 'to do']]);
});

gitTest('two conversions of one stub at once: one converts, the other writes nothing', async () => {
  const w = world();
  exported(w);
  commit(w.api, 'Add the tickets');
  const admin = adminHere(w);
  const outs = await Promise.all([runAsync(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1'), runAsync(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1')]);
  const firsts = outs.map((o) => o[0]);
  assert.equal(firsts.filter((l) => l === 'converted: ADM-S1 -> ADM-1').length, 1, firsts.join('\n'));
  assert.equal(firsts.filter((l) => l.startsWith('plans: ticket refused (')).length, 1, firsts.join('\n'));
  assert.ok(has(admin, `${OUT}/ADM-1-admin-counter.md`));
  assert.ok(!has(admin, `${OUT}/ADM-2-admin-counter.md`));
  assert.equal(run(w.api, 'check', FEATURE)[0], `check: clean (2 tickets in ${OUT}/)`, run(w.api, 'check', FEATURE).join('\n'));
});

gitTest('a plan of stubs only is not exported: an exported feature is found by its tickets', () => {
  const w = world();
  const only = 'admin-only';
  run(w.api, 'new', only);
  run(w.api, 'ticket', only, '--title', 'Admin counter', '--stub', 'ADM');
  body(w.api, `.keel/local/plans/keel/${only}/plan.md`, planText.replace(`# ${FEATURE}`, `# ${only}`).replace('T1 event\nT2 admin counter', 'T1 admin counter'));
  body(w.api, `.keel/local/plans/keel/${only}/tickets/T1-admin-counter.md`, stubText('T1'));
  run(w.api, 'reviewed', only, 'T1');
  assert.deepEqual(run(w.api, 'state', only, 'ready'), ['status: ready']);
  assert.deepEqual(run(w.api, 'export', only), ['plans: export refused (this project (API) has no ticket: give it one; nothing exported, the plan stays ready)']);
  assert.ok(!has(w.api, `tickets/${only}`));
});

gitTest('a feature with a stub left is not complete: done says so, drop refuses', () => {
  const w = world();
  exported(w);
  git(w.api, 'switch', '-q', '-c', FEATURE);
  done(w.api, `${OUT}/API-1-event.md`);
  const last = run(w.api, 'done', 'API-2');
  assert.deepEqual(last, [`done: API-2 (${OUT}/API-2-admin-event.md)`, `done: feature ${FEATURE} has stubs left: ADM-S1 (plans.js ticket ${FEATURE} --from-stub <key> once its repository is here)`]);
  commit(w.api, 'Done');
  assert.deepEqual(run(w.api, 'drop', FEATURE), [`plans: drop refused (${FEATURE} still has stubs: ADM-S1; turn each into a ticket once its repository is here (plans.js ticket ${FEATURE} --from-stub <key>), or remove it)`]);
  assert.ok(has(w.api, `${OUT}/ADM-S1-admin-counter.md`));
});

gitTest('a stub key reads only a ticket of its own feature: another project\'s ADM-S1 converted elsewhere holds nothing back', () => {
  const w = world();
  const web = repo(w.projects, 'web', 'WEB');
  planned(w.api, FEATURE);
  const theirs = planned(web, 'chat-web');
  assert.ok(theirs.includes('- T2 -> ADM-S1: tickets/chat-web/ADM-S1-admin-counter.md (stub)'), theirs.join('\n'));
  commit(w.api, 'Plan');
  commit(web, 'Plan');
  const admin = adminHere(w);
  run(web, 'settings', 'set', '--repo', `ADM=${slash(admin)}`);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1')[0], 'converted: ADM-S1 -> ADM-1');
  commit(admin, 'Add ADM-1');
  done(web, 'tickets/chat-web/WEB-1-event.md');
  commit(web, 'Done');
  const view = run(web, 'tickets', 'WEB-2');
  assert.ok(view.includes('  depends: ADM-S1 stub'), view.join('\n'));
  assert.equal(line(view, 'next'), 'WEB-2 (chat-web)');
  const dep = pageData(web, 'chat-web').tickets.find((t) => t.key === 'WEB-2').depends;
  assert.deepEqual(dep, [{ key: 'ADM-S1', met: null, state: 'state unknown', feature: null, where: null }]);
});

gitTest('after a conversion the dependency waits for the ticket, also written in small letters; a clone of the stub\'s repository without it holds the ticket back', () => {
  const w = world();
  exported(w);
  write(w.api, `${OUT}/API-2-admin-event.md`, readRel(w.api, `${OUT}/API-2-admin-event.md`).replace('depends_on: [ADM-S1]', 'depends_on: [adm-s1]'));
  done(w.api, `${OUT}/API-1-event.md`);
  commit(w.api, 'Add the tickets');
  assert.ok(run(w.api, 'tickets', 'API-2').includes('  depends: ADM-S1 stub'));
  const admin = adminHere(w);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'ADM-S1')[0], 'converted: ADM-S1 -> ADM-1');
  commit(w.api, 'Convert');
  commit(admin, 'Add ADM-1');
  let view = run(w.api, 'tickets', 'API-2');
  assert.ok(view.some((l) => /^ {2}depends: ADM-1 to do \(/.test(l)), view.join('\n'));
  assert.equal(line(view, 'next'), 'none');
  // Once ADM-1 is done on the feature branch there, API-2 is next.
  done(admin, `${OUT}/ADM-1-admin-counter.md`);
  commit(admin, 'Done');
  assert.equal(line(run(w.api, 'tickets', 'API-2'), 'next'), `API-2 (${FEATURE})`);
  // Another machine: its admin clone has no ADM-1 yet, and the stub is gone from the feature folder.
  const old = repo(w.projects, 'admin-old', 'ADM');
  run(w.api, 'settings', 'set', '--repo', `ADM=${slash(old)}`);
  view = run(w.api, 'tickets', 'API-2');
  assert.ok(view.some((l) => /^ {2}depends: ADM-S1 not found \(/.test(l)), view.join('\n'));
  assert.equal(line(view, 'next'), 'none');
});

gitTest('the S-number goes on past a stub that left the working tree; a stub\'s repo in small letters is the same sequence', () => {
  const w = world();
  draft(w);
  write(w.api, `${PLAN}/tickets/T2-admin-counter.md`, readRel(w.api, `${PLAN}/tickets/T2-admin-counter.md`).replace('repo: ADM', 'repo: adm'));
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3');
  run(w.api, 'state', FEATURE, 'ready');
  assert.ok(run(w.api, 'export', FEATURE).includes(`- T2 -> ADM-S1: ${OUT}/ADM-S1-admin-counter.md (stub)`));
  commit(w.api, 'Add the tickets');
  // Converted on another machine: the stub left in a commit.
  git(w.api, 'rm', '-q', `${OUT}/ADM-S1-admin-counter.md`);
  git(w.api, 'commit', '-q', '-m', 'Convert ADM-S1');
  assert.ok(planned(w.api, 'chat-archive').includes('- T2 -> ADM-S2: tickets/chat-archive/ADM-S2-admin-counter.md (stub)'));
});

gitTest('a ready plan whose stub is converted is a draft again; check: a stub of this project, a cycle through a stub, an exported dependency on a stub nobody has', () => {
  const w = world();
  draft(w);
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3');
  assert.deepEqual(run(w.api, 'state', FEATURE, 'ready'), ['status: ready']);
  const admin = adminHere(w);
  assert.equal(run(w.api, 'ticket', FEATURE, '--from-stub', 'T2')[0], 'converted: T2 (stub -> ticket for ADM)');
  const plan = readRel(w.api, `${PLAN}/plan.md`);
  assert.match(plan, /^status: draft$/m);
  assert.match(plan, /^ready_hash: -$/m);

  const v = world();
  draft(v);
  // A plan from before stubs were tickets: its "## Stubs" would be lost on export.
  write(v.api, `${PLAN}/plan.md`, readRel(v.api, `${PLAN}/plan.md`).replace('## Next action', '## Stubs\nADM: the admin counter.\n\n## Next action'));
  assert.ok(run(v.api, 'check', FEATURE).includes('- plan.md: "## Stubs" is no section any more: make each stub a ticket (plans.js ticket <feature> --title <t> --stub <PREFIX>), then remove the section'), run(v.api, 'check', FEATURE).join('\n'));
  write(v.api, `${PLAN}/plan.md`, readRel(v.api, `${PLAN}/plan.md`).replace('## Stubs\nADM: the admin counter.\n\n', ''));
  const stubFile = `${PLAN}/tickets/T2-admin-counter.md`;
  write(v.api, stubFile, readRel(v.api, stubFile).replace('repo: ADM', 'repo: API'));
  assert.ok(run(v.api, 'check', FEATURE).includes('- T2: a stub\'s repo "API" is not another repository\'s ticket prefix'));
  write(v.api, stubFile, readRel(v.api, stubFile).replace('repo: API', 'repo: ADM').replace('depends_on: [T1]', 'depends_on: [T3]'));
  assert.ok(run(v.api, 'check', FEATURE).some((l) => /dependency cycle: .*T2.*T3|dependency cycle: .*T3.*T2/.test(l)), run(v.api, 'check', FEATURE).join('\n'));

  const u = world();
  exported(u);
  const there = adminHere(u);
  assert.equal(run(u.api, 'ticket', FEATURE, '--title', 'More', '--depends', 'ADM-S9')[0],
    `plans: ticket refused (--depends: no ticket ADM-S9 (no stub here, and no ticket in ${slash(there)} replaces it))`);
  assert.ok(admin);
});

gitTest('the page template draws a stub\'s mark and note', () => {
  // The page's script lives in page.js beside index.html.
  const script = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'feature-page', 'page.js'), 'utf8');
  for (const key of ["'stub'", "'stub_title'", "'stub_note'"]) assert.ok(script.includes(key), key);
});
