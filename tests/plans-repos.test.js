'use strict';
// A feature on several repositories while it is a draft: plans.js repos, set --repos and --after-commit,
// ticket --repo, and check, stale, review and export reading another repository's tickets in its folder.
// Throwaway repositories under one temporary folder; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (prefix, extra = {}) => ({
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  ...(prefix ? { planning: { ticket_prefix: prefix, tickets: 'repo' } } : {}),
  ...extra,
});

const FEATURE = 'message-notify';
const PLAN = `.keel/local/plans/keel/${FEATURE}`;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const slash = (p) => p.replace(/\\/g, '/');
const front = (dir, rel, key, value) => write(dir, rel, readRel(dir, rel).replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));

function commit(dir, message, files = {}) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

// A git repository `name` in `parent` with one commit on main; keel's config when `config` is given.
function repo(parent, name, config) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (config !== undefined) {
    write(dir, '.keel/config.json', typeof config === 'string' ? config : JSON.stringify(config));
    write(dir, '.keel/.gitignore', 'local/\n');
  }
  commit(dir, 'init', { 'src/app.js': 'module.exports = 1;\n' });
  return dir;
}

// projects/: api (API), web (WEB), admin (git, no keel), notes (a plain folder), .hidden (git) and
// api-wt, a worktree of api. api's repos map has WEB.
function world() {
  const tmp = tempDir('keel-repos-');
  const projects = path.join(tmp, 'projects');
  const api = repo(projects, 'api', CONFIG('API'));
  const web = repo(projects, 'web', CONFIG('WEB'));
  commit(web, 'badge', { 'src/badge.js': 'module.exports = 2;\n' });
  const admin = repo(projects, 'admin');
  fs.mkdirSync(path.join(projects, 'notes'));
  repo(projects, '.hidden');
  git(api, 'worktree', 'add', '-q', path.join(projects, 'api-wt'), '-b', 'wt');
  run(api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  return { tmp, projects, api, web, admin };
}

const ticketText = (id, where) => `# [${id}] Ticket ${id}

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
D1.

## Dependencies
`;

const planText = `# ${FEATURE}

## In plain words
The chat icon counts new messages.

## Level

## Decisions
D1. Count on the server.

## Contract

## Out of scope

## Design sketch
### API
The event.
### WEB
The badge.

## Terms

## What was gathered

## Open questions

## Tickets
T1 badge
T2 event

## Next action
Review.
`;

// The body of a file plans.js made, its front matter kept.
const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

// A draft in api for api and web that passes check: T1 for web (src/badge.js is only there), T2 for api.
function draft(w) {
  run(w.api, 'new', FEATURE);
  run(w.api, 'set', FEATURE, '--repos', 'WEB');
  run(w.api, 'ticket', FEATURE, '--title', 'Badge', '--repo', 'WEB');
  run(w.api, 'ticket', FEATURE, '--title', 'Event');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.api, `${PLAN}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));
  body(w.api, `${PLAN}/tickets/T2-event.md`, ticketText('T2', 'src/app.js:1'));
}

gitTest('repos: the repos map and the git repositories next to the project; never this project, its worktrees, hidden or plain folders', () => {
  const { tmp, projects, api, web, admin } = world();
  repo(projects, 'old', CONFIG('OLD', { schema_version: 0 }));
  let out = run(api, 'repos');
  assert.equal(out[0], 'repos: 3 (repos map 1, next to this project 2)', out.join('\n'));
  assert.equal(out[1], `this project: API (${slash(api)})`);
  assert.ok(out.includes(`- ${slash(web)}: repos map WEB, planning prefix WEB`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(admin)}: next to this project, no planning prefix`), out.join('\n'));
  // An older keel's config still names its prefix.
  assert.ok(out.includes(`- ${slash(path.join(projects, 'old'))}: next to this project, planning prefix OLD`), out.join('\n'));
  // web is in the map and next to the project: one line.
  assert.equal(out.filter((l) => l.includes(slash(web))).length, 1);
  for (const gone of ['api-wt', 'notes', '.hidden']) assert.ok(!out.some((l) => l.includes(`/${gone}:`)), `${gone} is not a candidate`);
  assert.ok(!out.some((l) => l.startsWith(`- ${slash(api)}:`)), 'this project is not its own neighbour');

  // The map says what it knows about each folder.
  run(api, 'settings', 'set', '--repo', `GONE=${slash(tmp)}/gone`);
  run(api, 'settings', 'set', '--repo', `NOTE=${slash(projects)}/notes`);
  run(api, 'settings', 'set', '--repo', `FE=${slash(web)}`);
  // A folder inside a repository is not one: git answers for it from its parent's.
  run(api, 'settings', 'set', '--repo', `SRC=${slash(web)}/src`);
  out = run(api, 'repos');
  assert.ok(out.includes(`- ${slash(tmp)}/gone: repos map GONE, not on this machine`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(projects)}/notes: repos map NOTE, not a git repository`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(web)}/src: repos map SRC, not a git repository`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(web)}: repos map FE, planning prefix WEB (not FE)`), out.join('\n'));

  // A worktree elsewhere: its own parent and the main worktree's parent, never its repository.
  const steps = path.join(tmp, 'steps');
  fs.mkdirSync(steps);
  git(api, 'worktree', 'add', '-q', path.join(steps, 's1'), '-b', 's1');
  out = run(path.join(steps, 's1'), 'repos');
  // The repos map is this machine's, the main checkout's (lib/project-dir.js): the worktree sees it too.
  assert.ok(out.includes(`- ${slash(web)}: repos map WEB, planning prefix WEB`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(projects)}/admin: next to this project, no planning prefix`), out.join('\n'));
  assert.ok(!out.some((l) => l.includes(`${slash(api)}:`) || l.includes('/api-wt:')), out.join('\n'));

  // Nothing near and no map.
  const solo = repo(path.join(tmp, 'alone'), 'solo', CONFIG('SOLO'));
  assert.deepEqual(run(solo, 'repos'), ['repos: 0 (repos map 0, next to this project 0)', `this project: SOLO (${slash(solo)})`]);
});

// git prints real paths: through a link (macOS /var -> /private/var) the main worktree's parent is
// spelled otherwise than the folders the user gave.
gitTest('repos: a worktree reached through a link lists each neighbour once, spelled as given', () => {
  const tmp = tempDir('keel-repos-');
  const link = path.join(tmp, 'link');
  fs.mkdirSync(path.join(tmp, 'real'));
  fs.symlinkSync(path.join(tmp, 'real'), link, 'junction');
  const projects = path.join(link, 'projects');
  const api = repo(projects, 'api', CONFIG('API'));
  const web = repo(projects, 'web', CONFIG('WEB'));
  const admin = repo(projects, 'admin');
  const s1 = path.join(link, 'steps', 's1');
  fs.mkdirSync(path.dirname(s1));
  git(api, 'worktree', 'add', '-q', s1, '-b', 's1');
  run(s1, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  const out = run(s1, 'repos');
  assert.equal(out[0], 'repos: 2 (repos map 1, next to this project 1)', out.join('\n'));
  assert.equal(out[1], `this project: API (${slash(s1)})`);
  assert.ok(out.includes(`- ${slash(web)}: repos map WEB, planning prefix WEB`), out.join('\n'));
  assert.ok(out.includes(`- ${slash(admin)}: next to this project, no planning prefix`), out.join('\n'));
  assert.equal(out.filter((l) => l.includes('/web:')).length, 1, out.join('\n'));
  assert.equal(out.filter((l) => l.includes('/admin:')).length, 1, out.join('\n'));
});

gitTest('set --repos: this project first, each other one from the repos map on this machine; its commit recorded', () => {
  const w = world();
  const { tmp, projects, api, web, admin } = w;
  run(api, 'new', FEATURE);
  const head = (dir) => git(dir, 'rev-parse', '--short', 'HEAD');
  let out = run(api, 'set', FEATURE, '--repos', 'web');
  assert.ok(out.includes('repos: [API, WEB]'), out.join('\n'));
  assert.ok(out.includes(`after_commit_repos: WEB=${head(web)}`), out.join('\n'));
  assert.match(readRel(api, `${PLAN}/plan.md`), /^repos: \[API, WEB\]$/m);
  // --branch alone still prints only its own lines.
  assert.deepEqual(run(api, 'set', FEATURE, '--branch', 'notify'), ['branch: notify', 'merge_into: main']);

  const refused = (value) => run(api, 'set', FEATURE, '--repos', ...(value === null ? [] : [value]))[0];
  assert.match(refused(null), /^plans: set refused \(--repos: give the prefixes/);
  assert.match(refused('MOB'), /--repos: no folder for MOB in the repos map: plans\.js settings set --repo MOB=<folder>\)$/);
  assert.match(refused('WEB,WEB'), /--repos: WEB is named twice\)$/);
  assert.match(refused('w'), /--repos: "W" is not a ticket prefix/);
  run(api, 'settings', 'set', '--repo', `GONE=${slash(tmp)}/gone`);
  assert.match(refused('GONE'), /is not on this machine: plan stubs for it instead\)$/);
  run(api, 'settings', 'set', '--repo', `NOTE=${slash(projects)}/notes`);
  assert.match(refused('NOTE'), /\(NOTE\) is not a git repository\)$/);
  run(api, 'settings', 'set', '--repo', `SRC=${slash(web)}/src`);
  assert.match(refused('SRC'), /\(SRC\) is not a git repository\)$/);
  run(api, 'settings', 'set', '--repo', `FE=${slash(web)}`);
  assert.match(refused('FE'), new RegExp(`--repos: ${slash(web)} plans with the prefix WEB, not FE`));
  const twin = repo(projects, 'twin', CONFIG('API'));
  run(api, 'settings', 'set', '--repo', `TWIN=${slash(twin)}`);
  assert.match(refused('TWIN'), /\(TWIN\) plans with this project's prefix API: two repositories in one plan need different prefixes \(\/keel:configure planning there\)\)$/);
  run(api, 'settings', 'set', '--repo', `API=${slash(twin)}`);
  assert.match(refused('API'), /the repos map gives this project's prefix API to .*twin: two repositories in one plan need different prefixes/);
  run(api, 'settings', 'set', '--repo', `API=${slash(api)}`);
  run(api, 'settings', 'set', '--repo', `SELF=${slash(api)}`);
  assert.match(refused('SELF'), /\(SELF\) is this project\)$/);
  const broken = repo(projects, 'broken', '{ not json');
  run(api, 'settings', 'set', '--repo', `BRK=${slash(broken)}`);
  assert.match(refused('BRK'), /\.keel\/config\.json cannot be read/);
  // A repository whose planning prefix is not set yet: the user named it, the export checks it.
  run(api, 'settings', 'set', '--repo', `ADM=${slash(admin)}`);
  assert.ok(run(api, 'set', FEATURE, '--repos', 'WEB,ADM').includes('repos: [API, WEB, ADM]'));
  run(api, 'settings', 'set', '--repo', `AD2=${slash(admin)}`);
  assert.match(refused('ADM,AD2'), /--repos: AD2 and ADM are the same folder\)$/);
  assert.ok(run(api, 'set', FEATURE, '--repos', '-').includes('repos: -'));
  // A repository with no commit yet is taken; stale cannot check it until it has one.
  const empty = path.join(projects, 'empty');
  fs.mkdirSync(empty);
  git(empty, 'init', '-q', '-b', 'main');
  run(api, 'settings', 'set', '--repo', `NEW=${slash(empty)}`);
  out = run(api, 'set', FEATURE, '--repos', 'WEB,NEW');
  assert.ok(out.includes(`after_commit_repos: WEB=${head(web)}`) && out.includes('note: NEW has no commit yet: stale cannot check its tickets until it has one'), out.join('\n'));
  assert.ok(!run(api, 'set', FEATURE, '--branch', 'notify').some((l) => l.startsWith('note:')), 'only --repos and --after-commit print the note');

  // The commit of a repository already named is kept; --after-commit takes every HEAD now.
  run(api, 'set', FEATURE, '--repos', 'WEB');
  const first = head(web);
  commit(web, 'more', { 'src/more.js': '1\n' });
  assert.ok(run(api, 'set', FEATURE, '--repos', 'WEB').includes(`after_commit_repos: WEB=${first}`));
  commit(api, 'more', { 'src/more.js': '1\n' });
  out = run(api, 'set', FEATURE, '--after-commit');
  assert.ok(out.includes(`after_commit: ${head(api)}`), out.join('\n'));
  assert.ok(out.includes(`after_commit_repos: WEB=${head(web)}`), out.join('\n'));
  // A hand-ordered list loses no commit.
  front(api, `${PLAN}/plan.md`, 'repos', '[WEB, API]');
  commit(web, 'again', { 'src/again.js': '1\n' });
  out = run(api, 'set', FEATURE, '--after-commit');
  assert.ok(out.includes(`after_commit_repos: WEB=${head(web)}`), out.join('\n'));
  assert.equal(run(api, 'set', FEATURE, '--after-commit', 'abc')[0], 'plans: set refused (--after-commit takes no value)');

  // Without a planning prefix here there is nothing to put first.
  run(admin, 'new', FEATURE);
  run(admin, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  assert.match(run(admin, 'set', FEATURE, '--repos', 'WEB')[0], /--repos: this project has no planning prefix: \/keel:configure planning\)$/);
});

gitTest('ticket --repo: another repository of the plan gets repo:, this project none; on an exported feature only a repository of its overview', () => {
  const { api } = world();
  run(api, 'new', FEATURE);
  run(api, 'set', FEATURE, '--repos', 'WEB');
  assert.deepEqual(run(api, 'ticket', FEATURE, '--title', 'Badge', '--repo', 'web'), [`created: ${PLAN}/tickets/T1-badge.md`, 'ticket: T1']);
  assert.match(readRel(api, `${PLAN}/tickets/T1-badge.md`), /^---\nid: T1\nrepo: WEB\ndepends_on: \[\]/);
  run(api, 'ticket', FEATURE, '--title', 'Event');
  run(api, 'ticket', FEATURE, '--title', 'Own', '--repo', 'API');
  for (const name of ['T2-event.md', 'T3-own.md']) assert.doesNotMatch(readRel(api, `${PLAN}/tickets/${name}`), /^repo:/m);
  assert.match(run(api, 'ticket', FEATURE, '--title', 'Phone', '--repo', 'MOB')[0], /refused \(--repo: MOB is not in the plan's repos \(plans\.js set message-notify --repos \.\.\.\)\)$/);
  assert.match(run(api, 'ticket', FEATURE, '--title', 'Phone', '--repo')[0], /refused \(--repo needs a ticket prefix: --repo WEB\)$/);
  // An exported feature's folder in the repository.
  write(api, 'tickets/early-work/API-1-early.md', '---\ntype: ticket\nkey: API-1\nstatus: todo\nfeature: early-work\nbranch: early-work\nmerge_into: main\ndepends_on: []\n---\n\n# [API-1] Early\n');
  assert.equal(run(api, 'ticket', 'early-work', '--title', 'Late', '--repo', 'WEB')[0], "plans: ticket refused (--repo: WEB is not a repository of early-work's overview (a feature on one repository))");
});

gitTest('check: another repository\'s ticket is looked up in its folder; no folder is a note; repo and repos are checked', () => {
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
  run(api, 'settings', 'set', '--repo', `WEB=${slash(tmp)}/gone`);
  assert.deepEqual(run(api, 'check', FEATURE), ['check: clean (plan.md and 2 tickets)', `note: T1: Where to look not checked (${slash(tmp)}/gone is not on this machine)`]);
  run(api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  body(api, `${PLAN}/tickets/T1-badge.md`, ticketText('T1', 'src/badge.js:1'));

  const t1 = `${PLAN}/tickets/T1-badge.md`;
  front(api, t1, 'repo', 'MOB');
  assert.ok(run(api, 'check', FEATURE).includes('- T1: repo MOB is not in the plan\'s repos'));
  front(api, t1, 'repo', 'web');
  assert.ok(run(api, 'check', FEATURE).includes('- T1: repo "web" is not a ticket prefix'));
  front(api, t1, 'repo', 'WEB');
  front(api, `${PLAN}/plan.md`, 'repos', '[WEB, API]');
  assert.ok(run(api, 'check', FEATURE).includes('- plan.md: repos: this project\'s prefix API comes first'));
  front(api, `${PLAN}/plan.md`, 'repos', '[API, WEB, WEB, x]');
  const out = run(api, 'check', FEATURE);
  assert.ok(out.includes('- plan.md: repos: WEB appears twice') && out.includes('- plan.md: repos: "x" is not a ticket prefix'), out.join('\n'));
});

gitTest('stale: another repository\'s tickets against its own commit in its folder; a file changed only here does not count for them', () => {
  const w = world();
  const { api, web } = w;
  draft(w);
  const since = (dir) => readRel(api, `${PLAN}/plan.md`).match(new RegExp(`^${dir}: (.*)$`, 'm'))[1];
  const apiAt = since('after_commit');
  const webAt = since('after_commit_repos').replace('WEB=', '');
  // A file named like web's, changed only in api: neither line moves.
  commit(api, 'badge here', { 'src/badge.js': 'here\n' });
  assert.deepEqual(run(api, 'stale', FEATURE), [`stale: none of 1 named files changed since ${apiAt}`, `stale (WEB): none of 1 named files changed since ${webAt}`]);
  commit(web, 'badge', { 'src/badge.js': 'changed\n' });
  assert.deepEqual(run(api, 'stale', FEATURE), [`stale: none of 1 named files changed since ${apiAt}`, `stale (WEB): 1 of 1 named files changed since ${webAt}: src/badge.js`]);
  run(api, 'settings', 'set', '--repo', `WEB=${slash(w.tmp)}/gone`);
  assert.equal(run(api, 'stale', FEATURE)[1], `stale (WEB): not checked (${slash(w.tmp)}/gone is not on this machine)`);
  run(api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  // No commit recorded for web, none for this project: each line says so on its own.
  front(api, `${PLAN}/plan.md`, 'after_commit_repos', '-');
  front(api, `${PLAN}/plan.md`, 'after_commit', '-');
  assert.deepEqual(run(api, 'stale', FEATURE), ['stale: unknown (no after_commit)', `stale (WEB): not checked (no commit recorded for WEB: plans.js set ${FEATURE} --after-commit)`]);
});

gitTest('review names another repository\'s folder; export waits for another repository that is not ready', () => {
  const w = world();
  const { tmp, api, web } = w;
  draft(w);
  let out = run(api, 'review', FEATURE);
  assert.deepEqual(out, ['review: 2 of 2 tickets to review', `repos: API=this project, WEB=${slash(web)}`, `- T1: never reviewed (WEB: ${slash(web)})`, '- T2: never reviewed']);
  run(api, 'settings', 'set', '--repo', `WEB=${slash(tmp)}/gone`);
  out = run(api, 'review', FEATURE);
  assert.ok(out.includes('- T1: never reviewed (WEB: not on this machine)') && out.includes('repos: API=this project, WEB=not on this machine'), out.join('\n'));
  run(api, 'settings', 'set', '--repo', `WEB=${slash(web)}`);
  front(api, `${PLAN}/tickets/T1-badge.md`, 'repo', 'web');
  front(api, `${PLAN}/plan.md`, 'repos', '[API, WEB, x]');
  out = run(api, 'review', FEATURE);
  assert.ok(out.includes('- T1: never reviewed (web: not a ticket prefix)') && out.includes(`repos: API=this project, WEB=${slash(web)}, x=not a ticket prefix`), out.join('\n'));
  front(api, `${PLAN}/tickets/T1-badge.md`, 'repo', 'WEB');
  front(api, `${PLAN}/plan.md`, 'repos', '[API, WEB]');

  run(api, 'reviewed', FEATURE, 'T1', 'T2');
  assert.deepEqual(run(api, 'state', FEATURE, 'ready'), ['status: ready']);
  // web is on its main branch (tests/plans-export-repos.test.js exports into a ready one).
  assert.equal(run(api, 'export', FEATURE)[0], 'plans: export refused (not ready: WEB; nothing exported, the plan stays ready)');
  assert.ok(!fs.existsSync(path.join(api, 'tickets', FEATURE)), 'nothing exported');
});
