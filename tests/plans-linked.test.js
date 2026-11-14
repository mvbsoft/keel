'use strict';
// plans.js tickets' linked block and plans.js align: a feature on api (this project), web (a repository
// on this machine, joined by the repos map) and widget (none here). Throwaway repositories; no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (prefix) => ({
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
  planning: { ticket_prefix: prefix, tickets: 'repo' },
});

const FEATURE = 'message-notify';
const T = `tickets/${FEATURE}`;
// Commit times an hour and two hours ago: recent enough for every branch to be read.
const HOUR = 60 * 60;
const START = Math.floor(Date.now() / 1000);
const AGO = (hours) => `@${START - hours * HOUR} +0000`;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const slash = (p) => p.replace(/\\/g, '/');
const from = (out, prefix) => out.slice(out.findIndex((l) => l.startsWith(prefix)));

function ticket(key, { status = 'todo', feature = FEATURE } = {}) {
  return `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: ${feature}\nbranch: ${feature}\nmerge_into: main\ndepends_on: []\n---\n\n# [${key}] Ticket ${key}\n\n## Goal\nDo it.\n`;
}

const OVERVIEW = [
  '---', 'type: feature', 'repos: [API, WEB, WGT]', '---', '', '# Message notify', '',
  '## In plain words', 'A badge for new messages.', '',
  '## Decisions', 'D1. The api sends the event.', '',
  '## Tickets',
  '- API-121 Ticket API-121 (api)', '- API-122 Ticket API-122 (api)',
  '- WEB-14 Ticket WEB-14 (web)', '- WEB-15 Ticket WEB-15 (web)', '- WEB-16 Sound (web)',
  '- WGT-3 Badge on the chat icon (widget)', '',
].join('\n');

function commit(dir, message, files = {}, date = AGO(2)) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', message], { stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
}

function repo(tmp, name, prefix) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG(prefix)));
  write(dir, '.keel/.gitignore', 'local/\n');
  commit(dir, 'init', { 'src/app.js': 'module.exports = 1;\n' });
  git(dir, 'checkout', '-q', '-b', FEATURE);
  return dir;
}

// api: API-121 (done by `apiDone`) and API-122 on the feature branch (`merged`: merged into main, api on
// main). web: WEB-14 in progress (a commit with its key), WEB-15 to do, WEB-30 of a feature api does not
// have; WEB-16 is only in the overview. widget: not in the map.
function setup({ apiDone = ['API-121'], merged = false, overview = OVERVIEW } = {}) {
  const tmp = tempDir('keel-linked-');
  const api = repo(tmp, 'api', 'API');
  commit(api, 'Add the notify tickets', {
    [`${T}/API-121-event.md`]: ticket('API-121', { status: apiDone.includes('API-121') ? 'done' : 'todo' }),
    [`${T}/API-122-push.md`]: ticket('API-122', { status: apiDone.includes('API-122') ? 'done' : 'todo' }),
    [`${T}/README.md`]: overview,
  });
  if (merged) { git(api, 'checkout', '-q', 'main'); git(api, 'merge', '-q', '--no-ff', '-m', 'Merge message-notify', FEATURE); }
  const web = repo(tmp, 'web', 'WEB');
  commit(web, 'Add the notify tickets', { [`${T}/WEB-14-badge.md`]: ticket('WEB-14'), [`${T}/WEB-15-list.md`]: ticket('WEB-15'), [`${T}/README.md`]: overview });
  commit(web, 'WEB-14: badge', { 'src/badge.js': '1\n' });
  commit(web, 'Add other tickets', { 'tickets/other-work/WEB-30-other.md': ticket('WEB-30', { feature: 'other-work' }) });
  assert.match(run(api, 'settings', 'set', '--repo', `WEB=${web}`)[0], /^settings: /);
  return { tmp, api, web };
}

gitTest('tickets: the linked block after next: neighbour states from its git, an absent one from the overview', () => {
  const { tmp, api, web } = setup();
  try {
    const out = run(api, 'tickets');
    assert.deepEqual(out.slice(0, 5), [
      'tickets: 1 feature, 2 tickets; no remote',
      `${FEATURE} (0 of 2 done, 1 waiting for merge)`,
      '  API-121 Ticket API-121 — waiting for the feature merge · branch message-notify, Test, today',
      '  API-122 Ticket API-122 — next',
      `next: API-122 (${FEATURE})`,
    ]);
    assert.deepEqual(out.slice(5), [
      `linked: ${FEATURE} in web (WEB; ${slash(web)}, no remote)`,
      '  WEB-14 Ticket WEB-14 — in progress · branch message-notify, Test, today',
      '  WEB-15 Ticket WEB-15 — to do',
      '  WEB-16 Sound — not found',
      `linked: ${FEATURE}: the repository widget (WGT) has more tickets, state unknown (no folder for WGT in the repos map: plans.js settings set --repo WGT=<folder>):`,
      '  WGT-3 Badge on the chat icon — state unknown',
    ], 'WEB-30 of a feature api does not have is not shown');
    // A feature or key view is this repository's only.
    assert.ok(!run(api, 'tickets', FEATURE).some((l) => l.startsWith('linked:')));
    assert.ok(!run(api, 'tickets', 'API-122').some((l) => l.startsWith('linked:')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets: a feature done here but not in another repository is in the linked block only', () => {
  const { tmp, api } = setup({ apiDone: ['API-121', 'API-122'], merged: true });
  try {
    const out = run(api, 'tickets');
    assert.deepEqual(out.slice(0, 2), ['tickets: 0 features, 0 tickets; no remote', 'next: none']);
    assert.match(out[2], new RegExp(`^linked: ${FEATURE} in web \\(WEB; `));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets: overviews that differ give one line; align shows the sections and writes the version taken', () => {
  const { tmp, api, web } = setup();
  try {
    // A decision written by hand in web, not committed: the newest version.
    write(web, `${T}/README.md`, OVERVIEW.replace('D1. The api sends the event.', 'D1. The api sends the event.\nD3. The number updates every 5 seconds.'));
    const out = run(api, 'tickets');
    assert.equal(out[out.length - 1], `linked: ${FEATURE}: the overview in web differs from this project's (pull there; still different: plans.js align ${FEATURE})`);
    assert.equal(out.filter((l) => l.includes('differs')).length, 1);

    const shown = run(api, 'align', FEATURE);
    assert.deepEqual(shown, [
      `align: ${FEATURE}: 2 versions of the overview in 2 repositories`,
      `- WEB (web, ${slash(web)}/${T}/README.md): uncommitted changes`,
      `- API (api, this project, ${T}/README.md): last changed ${new Date((START - 2 * HOUR) * 1000).toISOString().slice(0, 10)}`,
      'default: WEB (the newest change)',
      'API against WEB:',
      '  section Decisions:',
      '    - D3. The number updates every 5 seconds.',
      'not checked: WGT (no folder for WGT in the repos map: plans.js settings set --repo WGT=<folder>)',
      `take one: plans.js align ${FEATURE} --take <PREFIX>`,
    ]);

    assert.deepEqual(run(api, 'align', FEATURE, '--take', 'web').slice(0, 3), [
      `align: ${FEATURE}: WEB's overview taken`,
      `aligned: API ${T}/README.md`,
      `commit: plans.js commit ${FEATURE}, then plans.js push ${FEATURE}`,
    ]);
    assert.equal(fs.readFileSync(path.join(api, T, 'README.md'), 'utf8'), fs.readFileSync(path.join(web, T, 'README.md'), 'utf8'));
    assert.ok(!run(api, 'tickets').some((l) => l.includes('differs')));
    assert.equal(run(api, 'align', FEATURE)[0], `align: ${FEATURE}: the overview is the same in 2 repositories`);
    assert.match(run(api, 'align', FEATURE, '--take', 'MOB')[0], /^plans: align refused \(--take: MOB is not one of /);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('align: committed versions of the same time default to the main repository; a newer commit wins', () => {
  const { tmp, api, web } = setup();
  try {
    const edited = OVERVIEW.replace('A badge for new messages.', 'A badge and a sound for new messages.');
    commit(web, 'Edit the overview', { [`${T}/README.md`]: edited });
    assert.equal(run(api, 'align', FEATURE)[3], 'default: API (the main repository)');
    commit(web, 'Edit the overview again', { [`${T}/README.md`]: `${edited}\n## Terms\nBadge: the number on the icon.\n` }, AGO(1));
    const out = run(api, 'align', FEATURE);
    assert.equal(out[3], 'default: WEB (the newest change)');
    assert.deepEqual(from(out, 'API against WEB:').slice(0, 5), [
      'API against WEB:',
      '  section In plain words:',
      '    - A badge and a sound for new messages.',
      '    + A badge for new messages.',
      '  section Terms: missing',
    ]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets and align: a neighbour on another branch is read on the tip of its feature branch', () => {
  const { tmp, api, web } = setup();
  try {
    commit(web, 'Edit the overview', { [`${T}/README.md`]: OVERVIEW.replace('D1.', 'D2. Sound too.\nD1.') }, AGO(1));
    git(web, 'checkout', '-q', 'main');
    const out = run(api, 'tickets');
    assert.ok(out.includes('  WEB-15 Ticket WEB-15 — to do'), out.join('\n'));
    assert.equal(out[out.length - 1], `linked: ${FEATURE}: the overview in web differs from this project's (pull there; still different: plans.js align ${FEATURE})`);
    assert.equal(run(api, 'align', FEATURE)[1], `- WEB (web, message-notify:${T}/README.md): last changed ${new Date((START - HOUR) * 1000).toISOString().slice(0, 10)}`);
    assert.deepEqual(run(api, 'align', FEATURE, '--take', 'API').slice(0, 2), [
      `align: ${FEATURE}: API's overview taken`,
      `not aligned: WEB (its overview is on ${FEATURE}, not in its working tree: switch to that branch there)`,
    ]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('align --take writes into the other repository\'s working tree and says what it replaced', () => {
  const { tmp, api, web } = setup();
  try {
    const mine = OVERVIEW.replace('D1. The api sends the event.', 'D1. The api sends the event over a queue.');
    write(api, `${T}/README.md`, mine);
    write(web, `${T}/README.md`, OVERVIEW.replace('A badge', 'A red badge'));
    // Both uncommitted: the same time, so the main repository's version is the default.
    assert.equal(run(api, 'align', FEATURE)[3], 'default: API (the main repository)');
    assert.deepEqual(run(api, 'align', FEATURE, '--take', 'API'), [
      `align: ${FEATURE}: API's overview taken`,
      `aligned: WEB ${slash(web)}/${T}/README.md (its uncommitted changes replaced)`,
      `commit: plans.js commit ${FEATURE} --repo WEB, then plans.js push ${FEATURE} --repo WEB`,
      'not checked: WGT (no folder for WGT in the repos map: plans.js settings set --repo WGT=<folder>)',
    ]);
    assert.equal(fs.readFileSync(path.join(web, T, 'README.md'), 'utf8'), mine);
    assert.equal(fs.readFileSync(path.join(api, T, 'README.md'), 'utf8'), mine);
    assert.equal(git(web, 'log', '-1', '--format=%s'), 'Add other tickets', 'nothing is committed');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets: a feature done in every repository has no linked block; CRLF is no difference', () => {
  const overview = OVERVIEW.replace('repos: [API, WEB, WGT]', 'repos: [API, WEB]').split('\n').filter((l) => !/WEB-16|WGT-3/.test(l)).join('\n');
  const { tmp, api, web } = setup({ apiDone: ['API-121', 'API-122'], merged: true, overview });
  try {
    commit(web, 'WEB-14, WEB-15 done', { [`${T}/WEB-14-badge.md`]: ticket('WEB-14', { status: 'done' }), [`${T}/WEB-15-list.md`]: ticket('WEB-15', { status: 'done' }) });
    git(web, 'checkout', '-q', 'main');
    git(web, 'merge', '-q', '--no-ff', '-m', 'Merge message-notify', FEATURE);
    assert.deepEqual(run(api, 'tickets'), ['tickets: 0 features, 0 tickets; no remote', 'next: none']);
    // A new ticket in web opens the feature again; its overview checked out with CRLF line endings.
    write(web, `${T}/WEB-17-sound.md`, ticket('WEB-17'));
    write(web, `${T}/README.md`, overview.replace(/\n/g, '\r\n'));
    const out = run(api, 'tickets');
    assert.ok(out.includes('  WEB-17 Ticket WEB-17 — to do'), out.join('\n'));
    assert.ok(!out.some((l) => l.includes('differs')), out.join('\n'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets: why another repository is not read; a repos map in git names no folder', () => {
  const { tmp, api } = setup();
  try {
    const gone = path.join(tmp, 'gone');
    run(api, 'settings', 'set', '--repo', `WEB=${gone}`);
    assert.ok(run(api, 'tickets').includes(`linked: ${FEATURE}: the repository web (WEB) has more tickets, state unknown (${slash(gone)} is not on this machine):`));
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    run(api, 'settings', 'set', '--repo', `WEB=${plain}`);
    assert.ok(run(api, 'tickets').includes(`linked: ${FEATURE}: the repository web (WEB) has more tickets, state unknown (${slash(plain)} is not a git repository):`));
    run(api, 'settings', 'set', '--repo', `WEB=${path.join(tmp, 'web')}`);
    git(api, 'add', '-f', '.keel/local/plans/keel/settings.json');
    git(api, 'commit', '-q', '-m', 'Track the map');
    const out = run(api, 'tickets');
    assert.ok(out.includes(`linked: ${FEATURE}: the repository web (WEB) has more tickets, state unknown (the repos map is in git; keel takes another repository's folder only from this machine's own map):`), out.join('\n'));
    assert.match(run(api, 'align', FEATURE, '--take', 'WEB')[0], /^plans: align refused \(the repos map .* is in git/);
    assert.deepEqual(run(api, 'align', FEATURE).slice(0, 1), [`align: ${FEATURE}: no other overview to compare`]);
    assert.deepEqual(run(api, 'align', FEATURE, '--take'), ['plans: align refused (--take needs a ticket prefix: --take WEB)']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('tickets: repos: takes ticket prefixes only; a listed ticket filed under another feature name is shown', () => {
  const overview = OVERVIEW.replace('repos: [API, WEB, WGT]', 'repos: [API, WEB, WGT, $(touch${IFS}x)]').replace('- WEB-16 Sound (web)', '- WEB-30 Ticket WEB-30 (web)');
  const { tmp, api } = setup({ overview });
  try {
    const out = run(api, 'tickets');
    assert.ok(!out.some((l) => l.includes('touch')), out.join('\n'));
    assert.ok(out.includes('  WEB-30 Ticket WEB-30 — to do'), out.join('\n'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

gitTest('align: refused for a feature on one repository or with no tickets here', () => {
  const { tmp, api } = setup();
  try {
    assert.deepEqual(run(api, 'align', 'no-such'), ['plans: align refused (no tickets of no-such in this project)']);
    assert.deepEqual(run(api, 'align', '../x'), ['plans: align refused (invalid feature name "../x")']);
    write(api, `${T}/README.md`, OVERVIEW.replace('repos: [API, WEB, WGT]\n', ''));
    assert.deepEqual(run(api, 'align', FEATURE), [`plans: align refused (${FEATURE} is a feature on one repository)`]);
    assert.ok(!run(api, 'tickets').some((l) => l.startsWith('linked:')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
