'use strict';
// A feature on several repositories, each named by its repository name: plans.js repos, the repos map,
// ticket --repo, and check, stale, review and set --after-commit reading another repository's tickets in
// its folder. Throwaway repositories under one temporary folder; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');
const {
  gitTest, CONFIG, FEATURE, PLAN, git, write, readRel, run, slash, front, head, commit, repo, world, ticketText, planText, body,
} = require('./fixtures/plans-repos.js');

// A draft in api that passes check: T1 for web (src/badge.js is only there), T2 for api.
function draft(w) {
  run(w.api, 'new', FEATURE);
  run(w.api, 'ticket', FEATURE, '--title', 'Badge', '--repo', 'web');
  run(w.api, 'ticket', FEATURE, '--title', 'Event');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.api, `${PLAN}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));
  body(w.api, `${PLAN}/tickets/T2-event.md`, ticketText('T2', 'src/app.js:1'));
}

gitTest('repos: the repos map and the git repositories next to the project by name; never this project, its worktrees, hidden or plain folders', () => {
  const { tmp, projects, api, web, admin } = world();
  fs.mkdirSync(path.join(projects, 'notes'));
  repo(projects, '.hidden');
  git(api, 'worktree', 'add', '-q', path.join(projects, 'api-wt'), '-b', 'wt');
  repo(projects, 'old', CONFIG({ schema_version: 0 }));
  let out = run(api, 'repos');
  assert.equal(out[0], 'repos: 3 (repos map 1, next to this project 2)', out.join('\n'));
  assert.equal(out[1], `this project: api (${slash(api)})`);
  assert.ok(out.includes(`- ${slash(web)}: repos map web, keel set up`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(admin)}: next to this project, admin, no keel`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(path.join(projects, 'old'))}: next to this project, old, .keel/config.json outdated`), out.join('\n'));
  // web is in the map and next to the project: one line.
  assert.equal(out.filter((l) => l.includes(slash(web))).length, 1);
  for (const gone of ['api-wt', 'notes', '.hidden']) assert.ok(!out.some((l) => l.includes(`/${gone}:`)), `${gone} is not a candidate`);
  assert.ok(!out.some((l) => l.startsWith(`- ${slash(api)}:`)), 'this project is not its own neighbour');

  // The map says what it knows about each folder; an entry under another name (a map of keel 2.0.0's
  // prefixes) says the repository's name.
  run(api, 'settings', 'set', '--repo', `gone=${slash(tmp)}/gone`);
  run(api, 'settings', 'set', '--repo', `notes=${slash(projects)}/notes`);
  // A folder inside a repository is not one: git answers for it from its parent's.
  run(api, 'settings', 'set', '--repo', `src=${slash(web)}/src`);
  const file = '.keel/local/plans/keel/settings.json';
  write(api, file, JSON.stringify({ repos: { ...JSON.parse(readRel(api, file)).repos, WEB: slash(web) } }));
  out = run(api, 'repos');
  assert.ok(out.includes(`- ${slash(tmp)}/gone: repos map gone, not on this machine`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(projects)}/notes: repos map notes, not a git repository`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(web)}/src: repos map src, not a git repository`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(web)}: repos map WEB, keel set up, named web (not WEB)`), out.join('\n'));

  // Two of one name: the one next to the project goes by owner/name, from its remote.
  const other = repo(projects, 'web2', CONFIG());
  git(other, 'remote', 'add', 'origin', 'git@example.com:team/web.git');
  out = run(api, 'repos');
  assert.ok(out.includes(`- ${slash(other)}: next to this project, team/web, keel set up`), out.join('\n'));

  // A worktree elsewhere: its own parent and the main worktree's parent, never its repository.
  const steps = path.join(tmp, 'steps');
  fs.mkdirSync(steps);
  git(api, 'worktree', 'add', '-q', path.join(steps, 's1'), '-b', 's1');
  out = run(path.join(steps, 's1'), 'repos');
  // The repos map is this machine's, the main checkout's (lib/project-dir.js): the worktree sees it too.
  assert.ok(out.includes(`- ${slash(web)}: repos map web, keel set up`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(projects)}/admin: next to this project, admin, no keel`), out.join('\n'));
  assert.ok(!out.some((l) => l.includes(`${slash(api)}:`) || l.includes('/api-wt:')), out.join('\n'));

  // Nothing near and no map.
  const solo = repo(path.join(tmp, 'alone'), 'solo', CONFIG());
  assert.deepEqual(run(solo, 'repos'), ['repos: 0 (repos map 0, next to this project 0)', `this project: solo (${slash(solo)})`]);
});

// git prints real paths: through a link (macOS /var -> /private/var) the main worktree's parent is
// spelled otherwise than the folders the user gave.
gitTest('repos: a worktree reached through a link lists each neighbour once, spelled as given', () => {
  const tmp = tempDir('keel-repos-');
  const link = path.join(tmp, 'link');
  fs.mkdirSync(path.join(tmp, 'real'));
  fs.symlinkSync(path.join(tmp, 'real'), link, 'junction');
  const projects = path.join(link, 'projects');
  const api = repo(projects, 'api', CONFIG());
  const web = repo(projects, 'web', CONFIG());
  const admin = repo(projects, 'admin');
  const s1 = path.join(link, 'steps', 's1');
  fs.mkdirSync(path.dirname(s1));
  git(api, 'worktree', 'add', '-q', s1, '-b', 's1');
  run(s1, 'settings', 'set', '--repo', `web=${slash(web)}`);
  const out = run(s1, 'repos');
  assert.equal(out[0], 'repos: 2 (repos map 1, next to this project 1)', out.join('\n'));
  assert.equal(out[1], `this project: s1 (${slash(s1)})`);
  assert.ok(out.includes(`- ${slash(web)}: repos map web, keel set up`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(admin)}: next to this project, admin, no keel`), out.join('\n'));
  assert.equal(out.filter((l) => l.includes('/web:')).length, 1, out.join('\n'));
  assert.equal(out.filter((l) => l.includes('/admin:')).length, 1, out.join('\n'));
});

gitTest('settings set --repo: a repository on this machine goes under its own name or owner/name', () => {
  const { api, web } = world();
  assert.equal(run(api, 'settings', 'set', '--repo', `frontend=${slash(web)}`)[0], `plans: settings set refused (--repo: ${slash(web)} is named web (or projects/web): --repo web=<folder>)`);
  assert.ok(run(api, 'settings', 'set', '--repo', `projects/web=${slash(web)}`).includes(`repos: web=${slash(web)}, projects/web=${slash(web)}`));
  git(web, 'remote', 'add', 'origin', 'https://example.com/team/web-app.git');
  assert.match(run(api, 'settings', 'set', '--repo', `web=${slash(web)}`)[0], /is named web-app \(or team\/web-app\): --repo web-app=<folder>\)$/);
  assert.ok(run(api, 'settings', 'set', '--repo', `team/web-app=${slash(web)}`).some((l) => l.includes(`team/web-app=${slash(web)}`)));
});

gitTest('ticket --repo: another repository on this machine gets repo: and its commit recorded; this project none', () => {
  const { tmp, projects, api, web } = world();
  run(api, 'new', FEATURE);
  assert.deepEqual(run(api, 'ticket', FEATURE, '--title', 'Badge', '--repo', 'web'), [`created: ${PLAN}/tickets/T1-badge.md`, 'ticket: T1']);
  assert.match(readRel(api, `${PLAN}/tickets/T1-badge.md`), /^---\nid: T1\ntype: ticket\nstatus: draft\nrepo: web\ndepends_on:\nreview_hash: -\n---\n/);
  assert.match(readRel(api, `${PLAN}/plan.md`), new RegExp(`^after_commit_repos: web=${head(web)}$`, 'm'));
  assert.doesNotMatch(readRel(api, `${PLAN}/plan.md`), /^repos:/m, 'a plan has no repos: field');
  run(api, 'ticket', FEATURE, '--title', 'Event');
  run(api, 'ticket', FEATURE, '--title', 'Own', '--repo', 'api');
  for (const name of ['T2-event.md', 'T3-own.md']) assert.doesNotMatch(readRel(api, `${PLAN}/tickets/${name}`), /^repo:/m);
  // The recorded commit stays when web moves on.
  const first = head(web);
  commit(web, 'more', { 'src/more.js': '1\n' });
  run(api, 'ticket', FEATURE, '--title', 'Badge two', '--repo', 'web');
  assert.match(readRel(api, `${PLAN}/plan.md`), new RegExp(`^after_commit_repos: web=${first}$`, 'm'));

  const refused = (...args) => run(api, 'ticket', FEATURE, '--title', 'Phone', ...args)[0];
  assert.equal(refused('--repo', 'mobile'), 'plans: ticket refused (--repo: no folder for mobile in the repos map: plans.js settings set --repo mobile=<folder>)');
  assert.equal(refused('--repo'), 'plans: ticket refused (--repo needs a repository name: --repo <name> (plans.js repos lists them))');
  assert.equal(refused('--repo', 'my web'), 'plans: ticket refused (--repo: "my web" is not a repository name (plans.js repos lists them))');
  run(api, 'settings', 'set', '--repo', `gone=${slash(tmp)}/gone`);
  assert.equal(refused('--repo', 'gone'), `plans: ticket refused (--repo: ${slash(tmp)}/gone (gone) is not on this machine: plan a stub for it (--stub gone))`);
  fs.mkdirSync(path.join(projects, 'notes'));
  run(api, 'settings', 'set', '--repo', `notes=${slash(projects)}/notes`);
  assert.equal(refused('--repo', 'notes'), `plans: ticket refused (--repo: ${slash(projects)}/notes (notes) is not a git repository)`);
  assert.equal(refused('--repo', 'web', '--stub', 'web'), 'plans: ticket refused (--repo and --stub: one of --repo, --elsewhere, --stub)');
  assert.ok(!fs.existsSync(path.join(api, PLAN, 'tickets', 'T5-phone.md')));
});

gitTest('check: another repository\'s ticket is looked up in its folder; no folder is a note; a repo: that is no name is a problem', () => {
  const w = world();
  const { tmp, api, web } = w;
  draft(w);
  // src/badge.js is only in web: checked in this project it would not exist.
  assert.deepEqual(run(api, 'check', FEATURE), ['check: clean (plan.md and 2 tickets)']);
  body(api, `${PLAN}/tickets/T1-badge.md`, ticketText('T1', 'src/missing.js:1'));
  assert.ok(run(api, 'check', FEATURE).includes(`- T1: src/missing.js in Where to look does not exist in ${slash(web)}`));
  // This project's ticket is still checked here.
  body(api, `${PLAN}/tickets/T2-event.md`, ticketText('T2', 'src/badge.js:1'));
  assert.ok(run(api, 'check', FEATURE).includes('- T2: src/badge.js in Where to look does not exist'));
  body(api, `${PLAN}/tickets/T2-event.md`, ticketText('T2', 'src/app.js:1'));

  // web's folder is gone: T1's files are not checked, which is a note, not a problem.
  run(api, 'settings', 'set', '--repo', `web=${slash(tmp)}/gone`);
  assert.deepEqual(run(api, 'check', FEATURE), ['check: clean (plan.md and 2 tickets)', `note: T1: Where to look not checked (${slash(tmp)}/gone is not on this machine)`]);
  run(api, 'settings', 'set', '--repo', `web=${slash(web)}`);
  body(api, `${PLAN}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));

  front(api, `${PLAN}/tickets/T1-badge.md`, 'repo', 'my web');
  assert.ok(run(api, 'check', FEATURE).includes('- T1: repo "my web" is not a repository name'));
  // Its own name is this project.
  front(api, `${PLAN}/tickets/T1-badge.md`, 'repo', 'api');
  assert.ok(run(api, 'check', FEATURE).includes('- T1: src/badge.js in Where to look does not exist'));
});

gitTest('stale: another repository\'s tickets against its own commit in its folder; a file changed only here does not count for them', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  const since = (key) => readRel(api, `${PLAN}/plan.md`).match(new RegExp(`^${key}: (.*)$`, 'm'))[1];
  const apiAt = since('after_commit');
  const webAt = since('after_commit_repos').replace('web=', '');
  // A file named like web's, changed only in api: neither line moves.
  commit(api, 'badge here', { 'src/badge.js': 'here\n' });
  assert.deepEqual(run(api, 'stale', FEATURE), [`stale: none of 1 named files changed since ${apiAt}`, `stale (web): none of 1 named files changed since ${webAt}`]);
  commit(web, 'badge', { 'src/badge.js': 'changed\n' });
  assert.deepEqual(run(api, 'stale', FEATURE), [`stale: none of 1 named files changed since ${apiAt}`, `stale (web): 1 of 1 named files changed since ${webAt}: src/badge.js`]);
  run(api, 'settings', 'set', '--repo', `web=${slash(w.tmp)}/gone`);
  assert.equal(run(api, 'stale', FEATURE)[1], `stale (web): not checked (${slash(w.tmp)}/gone is not on this machine)`);
  run(api, 'settings', 'set', '--repo', `web=${slash(web)}`);
  // No commit recorded for web, none for this project: each line says so on its own.
  front(api, `${PLAN}/plan.md`, 'after_commit_repos', '-');
  front(api, `${PLAN}/plan.md`, 'after_commit', '-');
  assert.deepEqual(run(api, 'stale', FEATURE), ['stale: unknown (no after_commit)', `stale (web): not checked (no commit recorded for web: plans.js set ${FEATURE} --after-commit)`]);
});

gitTest('set --after-commit: this project\'s HEAD and that of each repository the tickets name; --repos is gone', () => {
  const w = world();
  const { api, web, projects } = w;
  draft(w);
  commit(web, 'more', { 'src/more.js': '1\n' });
  commit(api, 'more', { 'src/more.js': '1\n' });
  let out = run(api, 'set', FEATURE, '--after-commit');
  assert.deepEqual(out, ['branch: message-notify', 'merge_into: main', `after_commit: ${head(api)}`, `after_commit_repos: web=${head(web)}`]);
  assert.equal(run(api, 'set', FEATURE, '--after-commit', 'abc')[0], 'plans: set refused (--after-commit takes no value)');
  assert.equal(run(api, 'set', FEATURE, '--repos', 'web')[0], 'plans: set refused (nothing to set: --branch, --merge-into, --after-commit)');
  // A repository with no commit yet: stale cannot check it until it has one.
  const empty = path.join(projects, 'empty');
  fs.mkdirSync(empty);
  git(empty, 'init', '-q', '-b', 'main');
  run(api, 'settings', 'set', '--repo', `empty=${slash(empty)}`);
  front(api, `${PLAN}/tickets/T2-event.md`, 'id', 'T2\nrepo: empty');
  out = run(api, 'set', FEATURE, '--after-commit');
  assert.ok(out.includes('note: empty has no commit yet: stale cannot check its tickets until it has one'), out.join('\n'));
});

gitTest('review names another repository\'s folder', () => {
  const w = world();
  const { tmp, api, web } = w;
  draft(w);
  assert.deepEqual(run(api, 'review', FEATURE), ['review: 2 of 2 tickets to review', '- plan: draft', `repos: web=${slash(web)}`, `- T1: never reviewed (web: ${slash(web)})`, '- T2: never reviewed']);
  run(api, 'settings', 'set', '--repo', `web=${slash(tmp)}/gone`);
  let out = run(api, 'review', FEATURE);
  assert.ok(out.includes('- T1: never reviewed (web: not on this machine)') && out.includes('repos: web=not on this machine'), out.join('\n'));
  run(api, 'settings', 'set', '--repo', `web=${slash(web)}`);
  front(api, `${PLAN}/tickets/T1-badge.md`, 'repo', 'my web');
  out = run(api, 'review', FEATURE);
  assert.ok(out.includes('- T1: never reviewed (my web: not a repository name)'), out.join('\n'));
});
