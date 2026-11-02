'use strict';
// Export of a feature planned on several repositories: each repository's tickets go into it by its own
// settings and numbers, one overview in all, all or nothing. Throwaway repositories; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const { exportFeature } = require(path.join(SCRIPTS, 'lib', 'plans-export-repos.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (prefix, tickets = 'repo') => ({
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  ...(prefix ? { planning: { ticket_prefix: prefix, tickets } } : {}),
});

const FEATURE = 'message-notify';
const PLAN = `.keel/local/plans/keel/${FEATURE}`;
const OUT = `tickets/${FEATURE}`;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const slash = (p) => p.replace(/\\/g, '/');

function commit(dir, message, files = {}) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

function repo(parent, name, config) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (config) {
    write(dir, '.keel/config.json', JSON.stringify(config));
    write(dir, '.keel/.gitignore', 'local/\n');
  }
  commit(dir, 'init', { 'src/app.js': 'module.exports = 1;\n' });
  return dir;
}

// projects/api (API, plans) and projects/web (WEB, in api's repos map); web has WEB-9 in its history.
function world({ apiTickets = 'repo', webTickets = 'repo' } = {}) {
  const tmp = tempDir('keel-export-repos-');
  const projects = path.join(tmp, 'projects');
  const api = repo(projects, 'api', CONFIG('API', apiTickets));
  const web = repo(projects, 'web', CONFIG('WEB', webTickets));
  commit(web, 'WEB-9 Old badge work', { 'src/badge.js': 'module.exports = 2;\n' });
  run(api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  return { tmp, projects, api, web };
}

const ticketText = (id, where, why = 'D1.') => `# [${id}] Ticket ${id}

## In plain words
A person sees one more thing on the screen.

## Goal
Do one thing.

## Acceptance criteria
- [ ] Given a message, when it arrives, then the count grows

## How to check
\`npm test\`

## Boundaries
- always: keep the old route
- ask first: a new dependency
- never: delete a file

## Where to look
\`${where}\`

## Out of scope

## Why
${why}

## Dependencies
`;

const planText = `# ${FEATURE}

## In plain words
The chat icon counts new messages.

## Level

## Decisions
D1. Count on the server.

## Contract
The event message.created carries the chat id.

## Out of scope

## Design sketch
### API
The event T1 sends.
### WEB
The badge of T2.

## Terms

## What was gathered

## Open questions

## Tickets
T1 event
T2 badge

## Stubs
### mobile: Push on a new message
Stub for the mobile repository: not planned or built here.

The phone buzzes when a message comes.

## Next action
Export.
`;

const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

// A ready draft in api: T1 for api, T2 for web depending on T1; two reports, the web ticket names one.
// web is on the feature branch, clean.
function ready(w) {
  run(w.api, 'new', FEATURE);
  run(w.api, 'set', FEATURE, '--repos', 'WEB');
  run(w.api, 'ticket', FEATURE, '--title', 'Event');
  run(w.api, 'ticket', FEATURE, '--title', 'Badge', '--repo', 'WEB', '--depends', 'T1');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.api, `${PLAN}/tickets/T1-event.md`, ticketText('T1', 'src/app.js:1'));
  body(w.api, `${PLAN}/tickets/T2-badge.md`, ticketText('T2', 'src/badge.js:1', 'D1; research/chart-lib.md.'));
  write(w.api, `${PLAN}/research/chart-lib.md`, '# Chart library\n');
  write(w.api, `${PLAN}/research/queue.md`, '# Queue\n');
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2');
  assert.deepEqual(run(w.api, 'state', FEATURE, 'ready'), ['status: ready']);
  git(w.web, 'switch', '-q', '-c', FEATURE);
}

// What the export leaves in a repository's feature folder, as relative file names.
const listed = (dir, rel) => (fs.existsSync(path.join(dir, rel)) ? fs.readdirSync(path.join(dir, rel), { recursive: true }).map(slash).sort() : []);

gitTest('export puts each repository\'s tickets into it with its own numbers, one overview word for word in all, research by mention', () => {
  const w = world();
  ready(w);
  const out = run(w.api, 'export', FEATURE);
  assert.equal(out[0], `exported: ${OUT}/ (1 tickets)`, out.join('\n'));
  assert.ok(out.includes(`exported: ${slash(w.web)}/${OUT}/ (1 tickets)`), out.join('\n'));
  // web counts from its own history (WEB-9), api from its own (none).
  assert.ok(out.includes(`- T1 -> API-1: ${OUT}/API-1-event.md`), out.join('\n'));
  assert.ok(out.includes(`- T2 -> WEB-10: ${slash(w.web)}/${OUT}/WEB-10-badge.md`), out.join('\n'));
  assert.ok(out.includes('note: WEB: fetch: no remote, skipped; keys from this clone only'), out.join('\n'));
  const webTicket = readRel(w.web, `${OUT}/WEB-10-badge.md`);
  assert.match(webTicket, /^key: WEB-10$/m);
  assert.match(webTicket, /^depends_on: \[API-1\]$/m, 'a dependency on another repository is its key');
  assert.match(webTicket, /^branch: message-notify$/m);
  assert.match(webTicket, /^merge_into: main$/m, 'web\'s own main branch');
  assert.match(webTicket, /^# \[WEB-10\] Ticket WEB-10$/m);
  assert.ok(!/^repo:/m.test(webTicket), 'the draft\'s repo field is not exported');

  const overview = readRel(w.api, `${OUT}/README.md`);
  assert.equal(readRel(w.web, `${OUT}/README.md`), overview, 'the same overview in every repository');
  assert.match(overview, /^---\ntype: feature\nrepos: \[API, WEB\]\n---\n/);
  assert.match(overview, /^- API-1 Ticket API-1 \(api\)$/m);
  assert.match(overview, /^- WEB-10 Ticket WEB-10 \(web\)$/m);
  assert.match(overview, /^## Contract\nThe event message\.created carries the chat id\.$/m);
  assert.match(overview, /## Stubs\n### mobile: Push on a new message\n/);
  assert.match(overview, /## Parts\n### api \(API\)\nThe event API-1 sends\.\n### web \(WEB\)\nThe badge of WEB-10\.\n/);
  assert.ok(overview.indexOf('## Tickets') < overview.indexOf('## Stubs') && overview.indexOf('## Stubs') < overview.indexOf('## Parts'));

  assert.deepEqual(listed(w.api, `${OUT}/research`), ['chart-lib.md', 'queue.md'], 'this project keeps every report');
  assert.deepEqual(listed(w.web, `${OUT}/research`), ['chart-lib.md'], 'web gets the report its ticket names');
  assert.ok(!has(w.api, PLAN), 'the draft went to keel\'s trash');
  assert.ok(!fs.readdirSync(path.join(w.web, 'tickets')).some((n) => n.endsWith('.export-tmp')));
});

gitTest('a neighbour that is not ready stops the whole export with a line per reason; --as-is takes uncommitted changes or another branch, never main', () => {
  const w = world();
  ready(w);
  const nothing = () => {
    assert.ok(!has(w.api, OUT) && !has(w.web, OUT), 'nothing exported');
    assert.equal(run(w.api, 'list')[1].split(':')[1].trim().split(' ')[0], 'ready');
  };
  // On main with a clean tree: the branch is created there.
  git(w.web, 'switch', '-q', 'main');
  git(w.web, 'branch', '-q', '-D', FEATURE);
  let out = run(w.api, 'export', FEATURE);
  assert.equal(out[0], 'plans: export refused (not ready: WEB; nothing exported, the plan stays ready)', out.join('\n'));
  assert.ok(out.includes(`not ready: WEB (${slash(w.web)}): on main, not on ${FEATURE}; create the branch: git -C "${slash(w.web)}" switch -c ${FEATURE}`), out.join('\n'));
  nothing();
  assert.equal(run(w.api, 'export', FEATURE, '--as-is', 'WEB')[0], out[0], 'main is never taken as it is');
  // The branch exists: switch to it.
  git(w.web, 'branch', '-q', FEATURE);
  out = run(w.api, 'export', FEATURE);
  assert.ok(out.includes(`not ready: WEB (${slash(w.web)}): on main, not on ${FEATURE}; switch to it: git -C "${slash(w.web)}" switch ${FEATURE}`), out.join('\n'));
  // Another branch and uncommitted changes: refused, then taken as they are.
  git(w.web, 'switch', '-q', '-c', 'other');
  write(w.web, 'src/badge.js', 'module.exports = 3;\n');
  out = run(w.api, 'export', FEATURE);
  assert.ok(out.includes(`not ready: WEB (${slash(w.web)}): on other, not on ${FEATURE}; switch to it: git -C "${slash(w.web)}" switch ${FEATURE} (or --as-is WEB: the tickets go to other)`), out.join('\n'));
  assert.ok(out.includes(`not ready: WEB (${slash(w.web)}): uncommitted changes; commit or stash them (or --as-is WEB: they stay out of the tickets' commit)`), out.join('\n'));
  nothing();
  out = run(w.api, 'export', FEATURE, '--as-is', 'WEB');
  assert.ok(out.includes(`note: WEB: the tickets go to the open branch other, not ${FEATURE}`), out.join('\n'));
  assert.ok(has(w.web, `${OUT}/WEB-10-badge.md`) && has(w.api, `${OUT}/API-1-event.md`));
});

gitTest('readiness: the neighbour\'s prefix, its active task, a merge in progress, a feature folder or draft there, a repository with no ticket, one not on this machine', () => {
  const w = world();
  ready(w);
  const reason = (out) => out.filter((l) => l.startsWith('not ready: ')).join('\n');
  // No planning settings there.
  write(w.web, '.keel/config.json', JSON.stringify(CONFIG(null)));
  commit(w.web, 'no planning');
  assert.match(reason(run(w.api, 'export', FEATURE)), /no planning settings: open a conversation in .* and run \/keel:configure planning/);
  // This project's prefix there.
  commit(w.web, 'API prefix', { '.keel/config.json': JSON.stringify(CONFIG('API')) });
  assert.match(reason(run(w.api, 'export', FEATURE)), /plans with this project's prefix API/);
  commit(w.web, 'WEB prefix', { '.keel/config.json': JSON.stringify(CONFIG('WEB')) });
  // A task a session works on there now; a marker whose task is gone does not count.
  write(w.web, '.keel/tasks/fix-login/task.md', '---\nid: fix-login\nstatus: active\n---\n# fix-login\n');
  write(w.web, '.keel/local/active/s-1.json', '{"id":"fix-login"}\n');
  write(w.web, '.keel/local/active/s-2.json', '{"id":"gone-task"}\n');
  write(w.web, '.keel/tasks/old-work/task.md', '---\nid: old-work\nstatus: active\n---\n# old-work\n');
  write(w.web, '.keel/local/active/s-3.json', '{"id":"old-work"}\n');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(w.web, '.keel/local/active/s-3.json'), twoDaysAgo, twoDaysAgo);
  let out = reason(run(w.api, 'export', FEATURE));
  assert.match(out, /task fix-login is active there; finish or hand it off/);
  assert.ok(!out.includes('gone-task') && !out.includes('old-work'), `a marker whose task is gone or that is two days old does not count: ${out}`);
  fs.rmSync(path.join(w.web, '.keel', 'local', 'active'), { recursive: true });
  fs.rmSync(path.join(w.web, '.keel', 'tasks'), { recursive: true });
  // The feature folder exists there.
  write(w.web, `${OUT}/notes.md`, 'mine\n');
  commit(w.web, 'notes');
  assert.match(reason(run(w.api, 'export', FEATURE)), new RegExp(`${OUT}/ exists there`));
  git(w.web, 'rm', '-q', '-r', OUT);
  git(w.web, 'commit', '-q', '-m', 'no notes');
  // A merge in progress.
  git(w.web, 'switch', '-q', '-c', 'side');
  commit(w.web, 'side', { 'src/badge.js': 'side\n' });
  git(w.web, 'switch', '-q', FEATURE);
  commit(w.web, 'here', { 'src/badge.js': 'here\n' });
  spawnSync('git', ['-C', w.web, 'merge', 'side'], { stdio: 'ignore' });
  assert.match(reason(run(w.api, 'export', FEATURE)), /merge|rebase|cherry-pick/i);
  git(w.web, 'merge', '--abort');
  // Not on this machine.
  run(w.api, 'settings', 'set', '--repo', `WEB=${slash(w.tmp)}/gone`);
  assert.match(reason(run(w.api, 'export', FEATURE)), /is not on this machine/);
  run(w.api, 'settings', 'set', '--repo', `WEB=${slash(w.web)}`);
  assert.ok(!has(w.api, OUT) && !has(w.web, OUT));
});

gitTest('a repository of repos with no ticket refuses the export', () => {
  const w = world();
  ready(w);
  const t2 = path.join(w.api, PLAN, 'tickets', 'T2-badge.md');
  fs.writeFileSync(t2, fs.readFileSync(t2, 'utf8').replace(/^repo: WEB\n/m, '').replace('src/badge.js:1', 'src/app.js:1'));
  run(w.api, 'reviewed', FEATURE, 'T2');
  run(w.api, 'state', FEATURE, 'ready');
  const out = run(w.api, 'export', FEATURE);
  assert.equal(out[0], `plans: export refused (WEB is in repos but has no ticket: give it one, or leave it out (plans.js set ${FEATURE} --repos); nothing exported, the plan stays ready)`, out.join('\n'));
});

gitTest('an export stopped after the files are written, after the neighbours are renamed, or at this project\'s step leaves nothing anywhere', () => {
  for (const apiTickets of ['repo', 'pc']) {
    for (const step of ['written', 'neighbours', 'moved']) {
      const w = world({ apiTickets });
      ready(w);
      const out = exportFeature(w.api, FEATURE, { stop: (at) => { if (at === step) throw new Error(`interrupted at ${at}`); } });
      assert.match(out[0], new RegExp(`interrupted at ${step}; nothing exported, the plan stays ready`), `${apiTickets} ${step}: ${out.join('\n')}`);
      assert.ok(!has(w.web, OUT), `${apiTickets} ${step}: web has no feature folder`);
      assert.ok(!fs.existsSync(path.join(w.web, 'tickets')) || !fs.readdirSync(path.join(w.web, 'tickets')).length, `${apiTickets} ${step}: no temporary folder in web`);
      assert.ok(!has(w.api, OUT), `${apiTickets} ${step}: api has no feature folder`);
      assert.match(readRel(w.api, `${PLAN}/plan.md`), /^status: ready$/m, `${apiTickets} ${step}: the draft is back, ready`);
      assert.ok(has(w.api, `${PLAN}/tickets/T2-badge.md`), `${apiTickets} ${step}: its tickets too`);
      // The next run exports.
      assert.match(run(w.api, 'export', FEATURE)[0], /^exported: /, `${apiTickets} ${step}`);
    }
  }
});

gitTest('a neighbour keeping tickets on its machine gets them there without a git check; a plan\'s own merge_into goes to every repository', () => {
  const w = world({ webTickets: 'pc' });
  ready(w);
  git(w.web, 'switch', '-q', 'main');
  write(w.web, 'src/badge.js', 'dirty\n');
  run(w.api, 'set', FEATURE, '--merge-into', 'develop');
  git(w.api, 'branch', 'develop');
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2');
  run(w.api, 'state', FEATURE, 'ready');
  const out = run(w.api, 'export', FEATURE);
  const local = `.keel/local/plans/keel/${FEATURE}/tickets`;
  assert.ok(out.includes(`exported: ${slash(w.web)}/${local}/ (1 tickets)`), out.join('\n'));
  assert.ok(out.includes('note: WEB: its tickets are seen on this machine only'), out.join('\n'));
  assert.ok(out.includes('note: WEB: no branch develop there; its tickets merge into it'), out.join('\n'));
  assert.match(readRel(w.web, `${local}/WEB-10-badge.md`), /^merge_into: develop$/m);
  assert.equal(readRel(w.web, `${local}/README.md`), readRel(w.api, `${OUT}/README.md`));
});

gitTest('a link in the other repository\'s ticket folder is never written through', () => {
  const w = world();
  ready(w);
  const outside = path.join(w.tmp, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(w.web, 'tickets'), 'junction');
  const out = run(w.api, 'export', FEATURE);
  assert.match(out[0], /^plans: export refused \(.*tickets is a link: keel does not write through it/, out.join('\n'));
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing written where the link points');
  assert.ok(!has(w.api, OUT), 'nor in this project');
});

gitTest('a neighbour keeping tickets on its machine with a draft of that name there is not ready', () => {
  const w = world({ webTickets: 'pc' });
  ready(w);
  run(w.web, 'new', FEATURE);
  const out = run(w.api, 'export', FEATURE);
  assert.ok(out.some((l) => l.startsWith('not ready: WEB') && l.includes('exists there')), out.join('\n'));
});

// An exported feature: api on its feature branch, both repositories' tickets in their working trees.
function exported(w) {
  ready(w);
  git(w.api, 'switch', '-q', '-c', FEATURE);
  const out = run(w.api, 'export', FEATURE);
  assert.match(out[0], /^exported: /, out.join('\n'));
}

gitTest('commit checks the keys in every repository: a key taken in web gets a new number in web\'s and api\'s files; --repo commits in web', () => {
  const w = world();
  exported(w);
  // Someone else's WEB-10 on another branch of web.
  git(w.web, 'stash', 'push', '-q', '-u', '-m', 'export');
  git(w.web, 'switch', '-q', '-c', 'theirs', 'main');
  commit(w.web, 'Their ticket', { 'tickets/other/WEB-10-theirs.md': '---\ntype: ticket\nkey: WEB-10\n---\n' });
  git(w.web, 'switch', '-q', FEATURE);
  git(w.web, 'stash', 'pop', '-q');
  let out = run(w.api, 'commit', FEATURE);
  assert.match(out[0], /^committed: \S+ Add the message-notify tickets$/, out.join('\n'));
  assert.ok(out.includes('renumbered: WEB-10 -> WEB-11'), out.join('\n'));
  assert.ok(has(w.web, `${OUT}/WEB-11-badge.md`) && !has(w.web, `${OUT}/WEB-10-badge.md`), 'renamed in web');
  for (const dir of [w.api, w.web]) {
    const overview = readRel(dir, `${OUT}/README.md`);
    assert.ok(overview.includes('- WEB-11 Ticket WEB-11 (web)') && !overview.includes('WEB-10'), `${dir}: ${overview}`);
  }
  assert.equal(readRel(w.api, `${OUT}/README.md`), readRel(w.web, `${OUT}/README.md`));
  out = run(w.api, 'commit', FEATURE, '--repo', 'WEB');
  assert.match(out[0], /^committed: \S+ Add the message-notify tickets$/, out.join('\n'));
  assert.match(git(w.web, 'log', '-1', '--name-only', '--format=%s'), /tickets\/message-notify\/WEB-11-badge\.md/);
  assert.equal(git(w.web, 'status', '--porcelain'), '', 'web\'s other changes: none');
});

gitTest('--repo takes another repository only from an untracked repos map and from the feature\'s overview; a failed push names the step to run again', () => {
  const w = world();
  exported(w);
  assert.equal(run(w.api, 'commit', FEATURE, '--repo', 'MOB')[0], `plans: commit refused (--repo: MOB is not a repository of ${FEATURE}'s overview (API, WEB))`);
  git(w.api, 'add', '-f', '.keel/local/plans/keel/settings.json');
  assert.equal(run(w.api, 'commit', FEATURE, '--repo', 'WEB')[0], 'plans: commit refused (the repos map .keel/local/plans/keel/settings.json is in git; keel takes another repository\'s folder only from this machine\'s own map: git rm --cached .keel/local/plans/keel/settings.json)');
  git(w.api, 'rm', '-q', '--cached', '.keel/local/plans/keel/settings.json');
  assert.match(run(w.api, 'commit', FEATURE, '--repo', 'WEB')[0], /^committed: /);
  git(w.web, 'remote', 'add', 'origin', slash(path.join(w.tmp, 'no-such-remote')));
  const out = run(w.api, 'push', FEATURE, '--repo', 'WEB');
  assert.match(out[0], /^plans: push refused \(the push of message-notify was refused \(failed\)/, out.join('\n'));
  assert.equal(out[1], `retry: node "${slash(path.join(SCRIPTS, 'plans.js'))}" "${slash(w.api)}" push ${FEATURE} --repo WEB`);
});

gitTest('a later ticket on a feature of several repositories: --repo gives it the next key there; every overview here gets its line', () => {
  const w = world();
  exported(w);
  let out = run(w.api, 'ticket', FEATURE, '--title', 'Count reset', '--repo', 'WEB', '--depends', 'API-1');
  assert.equal(out[0], `created: ${slash(w.web)}/${OUT}/WEB-11-count-reset.md`, out.join('\n'));
  assert.equal(out[1], 'ticket: WEB-11');
  assert.ok(out.includes(`overview: ${OUT}/README.md`) && out.includes(`overview: ${slash(w.web)}/${OUT}/README.md`), out.join('\n'));
  const added = readRel(w.web, `${OUT}/WEB-11-count-reset.md`);
  assert.match(added, /^branch: message-notify$/m);
  assert.match(added, /^merge_into: main$/m);
  assert.match(added, /^depends_on: \[API-1\]$/m);
  out = run(w.api, 'ticket', FEATURE, '--title', 'Event retry');
  assert.equal(out[1], 'ticket: API-2', out.join('\n'));
  for (const dir of [w.api, w.web]) {
    const overview = readRel(dir, `${OUT}/README.md`);
    assert.match(overview, /^- WEB-10 Ticket WEB-10 \(web\)\n- WEB-11 Count reset \(web\)\n- API-2 Event retry \(api\)$/m, `${dir}: ${overview}`);
  }
  assert.equal(readRel(w.api, `${OUT}/README.md`), readRel(w.web, `${OUT}/README.md`));
  assert.equal(run(w.api, 'ticket', FEATURE, '--title', 'Push', '--repo', 'MOB')[0], `plans: ticket refused (--repo: MOB is not a repository of ${FEATURE}'s overview (API, WEB))`);
  // web not on this machine: the ticket goes here, web's overview is named as not updated.
  run(w.api, 'settings', 'set', '--repo', `WEB=${slash(w.tmp)}/gone`);
  out = run(w.api, 'ticket', FEATURE, '--title', 'Event log');
  assert.ok(out.includes('note: WEB: its overview is not updated (not on this machine)'), out.join('\n'));
});

gitTest('a neighbour keeping tickets on its machine takes a later ticket by --repo, never a commit; a renumbered key reaches its files too', () => {
  const w = world({ webTickets: 'pc' });
  exported(w);
  const local = `.keel/local/plans/keel/${FEATURE}/tickets`;
  let out = run(w.api, 'ticket', FEATURE, '--title', 'Badge reset', '--repo', 'WEB');
  assert.equal(out[0], `created: ${slash(w.web)}/${local}/WEB-11-badge-reset.md`, out.join('\n'));
  assert.equal(readRel(w.web, `${local}/README.md`), readRel(w.api, `${OUT}/README.md`));
  assert.equal(run(w.api, 'commit', FEATURE, '--repo', 'WEB')[0], `plans: commit refused (--repo: WEB keeps the tickets of ${FEATURE} on this machine only: nothing to commit there)`);
  // Someone else's API-1 on another branch of api: renumbered here and in web's files on this machine.
  git(w.api, 'stash', 'push', '-q', '-u', '-m', 'export');
  git(w.api, 'switch', '-q', '-c', 'theirs', 'main');
  commit(w.api, 'Their ticket', { 'tickets/other/API-1-theirs.md': '---\ntype: ticket\nkey: API-1\n---\n' });
  git(w.api, 'switch', '-q', FEATURE);
  git(w.api, 'stash', 'pop', '-q');
  out = run(w.api, 'commit', FEATURE);
  assert.ok(out.includes('renumbered: API-1 -> API-2'), out.join('\n'));
  assert.match(readRel(w.web, `${local}/WEB-10-badge.md`), /^depends_on: \[API-2\]$/m);
  assert.equal(readRel(w.web, `${local}/README.md`), readRel(w.api, `${OUT}/README.md`), 'the overviews stay the same');
  assert.ok(!readRel(w.web, `${local}/README.md`).includes('API-1'));
});

gitTest('commit never renumbers a key another repository already published', () => {
  const w = world();
  exported(w);
  run(w.api, 'commit', FEATURE);
  run(w.api, 'commit', FEATURE, '--repo', 'WEB');
  const remote = path.join(w.tmp, 'web.git');
  git(w.tmp, 'init', '-q', '--bare', remote);
  git(w.web, 'remote', 'add', 'origin', slash(remote));
  git(w.web, 'push', '-q', 'origin', FEATURE);
  git(w.web, 'switch', '-q', '-c', 'theirs', 'main');
  commit(w.web, 'Their ticket', { 'tickets/other/WEB-10-theirs.md': '---\ntype: ticket\nkey: WEB-10\n---\n' });
  git(w.web, 'switch', '-q', FEATURE);
  const out = run(w.api, 'commit', FEATURE);
  assert.match(out[0], /^plans: commit refused \(WEB-10 is also .*a published key is not renumbered/, out.join('\n'));
  assert.ok(has(w.web, `${OUT}/WEB-10-badge.md`) && readRel(w.api, `${OUT}/README.md`).includes('WEB-10'), 'nothing renamed');
});

gitTest('export fetches each repository before counting its keys; a repos map in git is refused; what an earlier export left there is no change', () => {
  const w = world();
  ready(w);
  // A colleague's WEB-12 on web's remote, not fetched yet.
  const remote = path.join(w.tmp, 'web.git');
  git(w.tmp, 'clone', '-q', '--bare', w.web, remote);
  const mate = path.join(w.tmp, 'mate');
  git(w.tmp, 'clone', '-q', slash(remote), mate);
  git(mate, 'config', 'user.name', 'Mate');
  git(mate, 'config', 'user.email', 'mate@example.com');
  git(mate, 'switch', '-q', '-c', 'mate-work');
  commit(mate, 'WEB-12 Their work', { 'src/x.js': '1\n' });
  git(mate, 'push', '-q', 'origin', 'mate-work');
  git(w.web, 'remote', 'add', 'origin', slash(remote));
  // A temporary folder a killed export left in web.
  write(w.web, `${OUT}.export-tmp/WEB-10-badge.md`, 'half\n');
  git(w.api, 'add', '-f', '.keel/local/plans/keel/settings.json');
  assert.equal(run(w.api, 'export', FEATURE)[0], 'plans: export refused (the repos map .keel/local/plans/keel/settings.json is in git; keel takes another repository\'s folder only from this machine\'s own map: git rm --cached .keel/local/plans/keel/settings.json)');
  git(w.api, 'rm', '-q', '--cached', '.keel/local/plans/keel/settings.json');
  const out = run(w.api, 'export', FEATURE);
  assert.ok(out.includes(`- T2 -> WEB-13: ${slash(w.web)}/${OUT}/WEB-13-badge.md`), out.join('\n'));
  assert.ok(out.includes('fetch: no remote, skipped; keys from this clone only'), 'this project has no remote');
  assert.ok(!out.some((l) => l.startsWith('note: WEB: fetch')), 'web fetched');
  assert.ok(!has(w.web, `${OUT}.export-tmp`));
});

gitTest('this project with no ticket of a feature on several repositories is refused as such; Parts keep a sub-heading that names no repository', () => {
  const w = world();
  ready(w);
  const t1 = path.join(w.api, PLAN, 'tickets', 'T1-event.md');
  fs.writeFileSync(t1, fs.readFileSync(t1, 'utf8').replace(/^depends_on:/m, 'repo: WEB\ndepends_on:').replace('src/app.js:1', 'src/badge.js:1'));
  run(w.api, 'reviewed', FEATURE, 'T1');
  run(w.api, 'state', FEATURE, 'ready');
  assert.equal(run(w.api, 'export', FEATURE)[0], 'plans: export refused (this project (API) has no ticket: give it one; nothing exported, the plan stays ready)');
  const w2 = world();
  ready(w2);
  const plan = path.join(w2.api, PLAN, 'plan.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('The event T1 sends.\n', 'The event T1 sends.\n### DB\nA table of counts.\n'));
  run(w2.api, 'state', FEATURE, 'ready');
  assert.match(run(w2.api, 'export', FEATURE)[0], /^exported: /);
  assert.match(readRel(w2.api, `${OUT}/README.md`), /## Parts\n### api \(API\)\nThe event API-1 sends\.\n### DB\nA table of counts\.\n### web \(WEB\)\n/);
});

gitTest('a report the overview names reaches the other repository; --as-is needs prefixes; this project\'s failed push names its retry too', () => {
  const w = world();
  ready(w);
  const plan = path.join(w.api, PLAN, 'plan.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('D1. Count on the server.', 'D1. Count on the server (research/queue.md).'));
  run(w.api, 'state', FEATURE, 'ready');
  assert.deepEqual(run(w.api, 'export', FEATURE, '--as-is', ''), ['plans: export refused (--as-is needs the prefixes: --as-is "WEB,MOB")']);
  git(w.api, 'switch', '-q', '-c', FEATURE);
  assert.match(run(w.api, 'export', FEATURE)[0], /^exported: /);
  assert.deepEqual(listed(w.web, `${OUT}/research`), ['chart-lib.md', 'queue.md']);
  run(w.api, 'commit', FEATURE);
  git(w.api, 'remote', 'add', 'origin', slash(path.join(w.tmp, 'no-such-remote')));
  const out = run(w.api, 'push', FEATURE);
  assert.equal(out[1], `retry: node "${slash(path.join(SCRIPTS, 'plans.js'))}" "${slash(w.api)}" push ${FEATURE}`, out.join('\n'));
});

gitTest('a clone with no planning settings takes its own prefix from the feature\'s tickets: its overview gets a later ticket\'s line', () => {
  const w = world();
  exported(w);
  write(w.api, '.keel/config.json', JSON.stringify(CONFIG(null)));
  const out = run(w.api, 'ticket', FEATURE, '--title', 'Event retry');
  assert.equal(out[1], 'ticket: API-2', out.join('\n'));
  assert.ok(out.includes(`overview: ${OUT}/README.md`) && out.includes(`overview: ${slash(w.web)}/${OUT}/README.md`), out.join('\n'));
  assert.equal(readRel(w.api, `${OUT}/README.md`), readRel(w.web, `${OUT}/README.md`));
});
