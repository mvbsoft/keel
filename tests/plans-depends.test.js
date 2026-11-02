'use strict';
// depends_on keys of another repository: two throwaway repositories on this machine, web and api, joined
// by the repos map. No network.
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

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, key) => out.find((l) => l.startsWith(`  ${key} `)) || '';
const slash = (p) => p.replace(/\\/g, '/');

function ticket(key, { status = 'todo', feature = 'message-notify', depends = [] } = {}) {
  return `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: ${feature}\nbranch: ${feature}\nmerge_into: main\ndepends_on: [${depends.join(', ')}]\n---\n\n# [${key}] Ticket ${key}\n\n## Goal\nDo it.\n`;
}

function commit(dir, message, files = {}) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

// A repository named `name` in tmp with keel's config (planning prefix `prefix`) and one commit on main.
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
  return dir;
}

// api: on its feature branch message-notify, API-121 done (waiting for the feature merge), API-122 to do;
// API-130 of another feature done on its branch; API-140 done and merged into main.
// web: WEB-14..WEB-18 of message-notify, each depending on one api key (or MOB-3, a repository not in the map).
function twoRepos() {
  const tmp = tempDir('keel-depends-');
  const api = repo(tmp, 'api', 'API');
  git(api, 'checkout', '-q', '-b', 'done-earlier');
  commit(api, 'API-140: done earlier', { 'src/early.js': '1\n', 'tickets/early-work/API-140-early.md': ticket('API-140', { status: 'done', feature: 'early-work' }) });
  git(api, 'checkout', '-q', 'main');
  git(api, 'merge', '-q', '--no-ff', '-m', 'Merge early-work', 'done-earlier');
  git(api, 'checkout', '-q', '-b', 'other-work');
  commit(api, 'API-130: other', { 'src/other.js': '1\n', 'tickets/other-work/API-130-other.md': ticket('API-130', { status: 'done', feature: 'other-work' }) });
  git(api, 'checkout', '-q', '-b', 'message-notify', 'main');
  commit(api, 'Add the notify tickets', { 'tickets/message-notify/API-121-event.md': ticket('API-121'), 'tickets/message-notify/API-122-push.md': ticket('API-122') });
  commit(api, 'API-121: event', { 'src/event.js': '1\n', 'tickets/message-notify/API-121-event.md': ticket('API-121', { status: 'done' }) });

  const web = repo(tmp, 'web', 'WEB');
  git(web, 'checkout', '-q', '-b', 'message-notify');
  commit(web, 'Add the notify tickets', {
    'tickets/message-notify/WEB-14-badge.md': ticket('WEB-14', { depends: ['API-122'] }),
    'tickets/message-notify/WEB-15-list.md': ticket('WEB-15', { depends: ['API-130'] }),
    'tickets/message-notify/WEB-16-sound.md': ticket('WEB-16', { depends: ['MOB-3'] }),
    'tickets/message-notify/WEB-17-count.md': ticket('WEB-17', { depends: ['API-121', 'API-140'] }),
    'tickets/message-notify/WEB-18-later.md': ticket('WEB-18', { depends: ['API-123'] }),
  });
  // A commit here naming an api key is no work on it.
  commit(web, 'WEB-18: listen for API-123', { 'src/listen.js': '1\n' });
  assert.equal(run(web, 'settings', 'set', '--repo', `API=${slash(api)}`).find((l) => l.startsWith('repos: ')), `repos: API=${slash(api)}`);
  return { tmp, api, web };
}

gitTest('tickets: another repository\'s dependency is read from its folder; not checked does not hold a ticket back', () => {
  const { api, web } = twoRepos();
  const out = run(web, 'tickets');
  // WEB-14: API-122 to do there. WEB-15: API-130 waiting, but in another feature. WEB-16: MOB-3 not
  // checked, yet the first free one after WEB-14 and WEB-15. WEB-17: API-121 waiting for the merge of the same
  // feature, API-140 done on api's main. WEB-18: API-123 not in api.
  assert.equal(line(out, 'WEB-14'), '  WEB-14 Ticket WEB-14 — to do');
  assert.equal(line(out, 'WEB-15'), '  WEB-15 Ticket WEB-15 — to do');
  assert.equal(line(out, 'WEB-16'), '  WEB-16 Ticket WEB-16 — next · MOB-3 not checked');
  assert.equal(line(out, 'WEB-17'), '  WEB-17 Ticket WEB-17 — to do');
  assert.equal(out.at(-1), 'next: WEB-16 (message-notify)');
  const where = `${slash(api)}, no remote`;
  assert.ok(run(web, 'tickets', 'WEB-14').includes(`  depends: API-122 to do (${where})`));
  assert.ok(run(web, 'tickets', 'WEB-15').includes(`  depends: API-130 waiting for the feature merge (${where})`));
  assert.ok(run(web, 'tickets', 'WEB-16').includes('  depends: MOB-3 not checked (no folder for MOB in the repos map: plans.js settings set --repo MOB=<folder>)'));
  assert.ok(run(web, 'tickets', 'WEB-17').includes(`  depends: API-121 waiting for the feature merge (${where}), API-140 done (${where})`));
  assert.ok(run(web, 'tickets', 'WEB-18').includes(`  depends: API-123 not found (${where})`));

  // Without WEB-16, WEB-17 is next: the same feature's code is on api's feature branch.
  fs.rmSync(path.join(web, 'tickets/message-notify/WEB-16-sound.md'));
  assert.equal(run(web, 'tickets').at(-1), 'next: WEB-17 (message-notify)');
  // With a remote, the line says when api last fetched: --fetch here never fetches there.
  const server = path.join(path.dirname(api), 'api.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', server]);
  git(api, 'remote', 'add', 'origin', server);
  assert.ok(run(web, 'tickets', 'WEB-17', '--fetch').includes(`  depends: API-121 waiting for the feature merge (${slash(api)}, never fetched), API-140 done (${slash(api)}, never fetched)`));
  git(api, 'fetch', '-q', 'origin');
  assert.match(run(web, 'tickets', 'WEB-17').find((l) => l.startsWith('  depends: ')), /^ {2}depends: API-121 waiting for the feature merge \(.+, server data from \d{4}-\d\d-\d\dT[\d:]+Z\)/);
  // A folder in the map that is not on this machine: not checked, and it says so.
  run(web, 'settings', 'set', '--repo', `API=${slash(api)}-gone`);
  assert.ok(run(web, 'tickets', 'WEB-14').includes(`  depends: API-122 not checked (${slash(api)}-gone is not on this machine)`));
  assert.equal(run(web, 'tickets').at(-1), 'next: WEB-14 (message-notify)');
});

gitTest('check and ticket on an exported feature: a key missing in the other repository is a problem, one not checked a note', () => {
  const { api, web } = twoRepos();
  // Only WEB-18 (API-123, not in api) is a problem; WEB-16 (MOB-3) a note.
  assert.deepEqual(run(web, 'check', 'message-notify').filter((l) => /depends/.test(l)), [
    `- WEB-18: depends on API-123, which does not exist in ${slash(api)} (no remote)`,
    'note: WEB-16 depends on MOB-3: not checked (no folder for MOB in the repos map: plans.js settings set --repo MOB=<folder>)',
  ]);
  assert.equal(run(web, 'ticket', 'message-notify', '--title', 'Bad', '--depends', 'API-999')[0], `plans: ticket refused (--depends: no ticket API-999 in ${slash(api)} (no remote))`);
  const out = run(web, 'ticket', 'message-notify', '--title', 'Mobile', '--depends', 'API-122,MOB-1');
  assert.equal(out[1], 'ticket: WEB-19');
  assert.equal(out[2], 'note: WEB-19 depends on MOB-1: not checked (no folder for MOB in the repos map: plans.js settings set --repo MOB=<folder>)');
  // The own prefix stays a problem when no ticket has the key.
  assert.match(run(web, 'ticket', 'message-notify', '--title', 'Own', '--depends', 'WEB-99')[0], /refused \(--depends: no ticket WEB-99\)$/);
});

gitTest('a draft: another repository\'s key in depends_on is checked there; T-numbers as before', () => {
  const { api, web } = twoRepos();
  git(web, 'checkout', '-q', 'main');
  assert.equal(run(web, 'new', 'show-badges')[0], 'created: .keel/local/plans/keel/show-badges/plan.md');
  assert.deepEqual(run(web, 'ticket', 'show-badges', '--title', 'Badge', '--depends', 'API-121'), ['created: .keel/local/plans/keel/show-badges/tickets/T1-badge.md', 'ticket: T1']);
  assert.deepEqual(run(web, 'ticket', 'show-badges', '--title', 'Sound', '--depends', 'T1,MOB-3').slice(1), ['ticket: T2', 'note: T2 depends on MOB-3: not checked (no folder for MOB in the repos map: plans.js settings set --repo MOB=<folder>)']);
  assert.equal(run(web, 'ticket', 'show-badges', '--title', 'Bad', '--depends', 'T9,API-999')[0], `plans: ticket refused (--depends: no ticket T9, API-999 in ${slash(api)} (no remote))`);
  const draft = path.join(web, '.keel/local/plans/keel/show-badges/tickets/T2-sound.md');
  fs.writeFileSync(draft, fs.readFileSync(draft, 'utf8').replace('depends_on: [T1, MOB-3]', 'depends_on: [T1, MOB-3, API-123, WEB-5]'));
  const out = run(web, 'check', 'show-badges');
  assert.deepEqual(out.filter((l) => /: depends on|^note: /.test(l)), [
    `- T2: depends on API-123, which does not exist in ${slash(api)} (no remote)`,
    '- T2: depends on WEB-5, which does not exist',
    'note: T2 depends on MOB-3: not checked (no folder for MOB in the repos map: plans.js settings set --repo MOB=<folder>)',
  ]);
});

test('start-task, start-session and planning texts: another repository\'s dependency, take the next ticket first', () => {
  const shared = (name) => fs.readFileSync(path.join(SCRIPTS, '..', 'skills', '_shared', name), 'utf8');
  const intake = shared('intake.md');
  assert.match(intake, /a `depends:` ticket of another repository \(its state is followed by `\(<folder>, <server data>\)`,\s+read from that folder's git, never fetched\) that is not done \(not `not found`\), and the ticket is\s+not `next` \(`next` counts one waiting for the merge of the same feature as met\) → say which, its\s+state there and as of when \(a fetch in that folder brings it up to date\), and ask: take the next\s+ticket \/ wait for it \/ start anyway/);
  assert.match(intake, /a `depends:` ticket `not checked` \(its folder is not in the repos map, not on this machine, or not a\s+git repository\) →\s+say which and why, and that `plans\.js settings set --repo <PREFIX>=<folder>` makes it checked;\s+ask: start anyway \/ take another ticket/);
  // No "start from that ticket's branch" for another repository: its branch is not in this one.
  assert.doesNotMatch(intake.slice(intake.indexOf('of another repository (its state')).split('\n   - ')[0], /that ticket's branch/);
  assert.match(shared('handoff.md'), /A dependency in another repository \(its state followed by `\(<folder>, \.\.\.\)`, or `not checked`\) is no step of its own: the ticket's step names it with that state/);
  assert.match(shared('planning.md'), /`--depends` may also name another repository's ticket by its key, `API-121`, checked in that\s+repository's folder from the repos map: a `note: \.\.\. not checked` line → say it and how to add the\s+folder/);
});

gitTest('which keys are another repository\'s: an older own prefix stays here; a long prefix, a file named like the key and lower case change nothing', () => {
  const { api, web } = twoRepos();
  // OLD-1, a ticket here with an older prefix: OLD is this project's, so OLD-9 is missing here.
  commit(web, 'An older ticket', { 'tickets/old-work/OLD-1-early.md': ticket('OLD-1', { feature: 'old-work' }) });
  // A design note named like an api key does not make it exist.
  commit(web, 'Notes', { 'docs/API-123-notes.md': '# notes\n' });
  write(web, 'tickets/message-notify/WEB-20-old.md', ticket('WEB-20', { depends: ['OLD-9', 'OLD-1', 'api-122', 'INFRASTRUCTURE-3'] }));
  assert.deepEqual(run(web, 'check', 'message-notify').filter((l) => /WEB-20|API-123/.test(l) && /depends/.test(l)), [
    `- WEB-18: depends on API-123, which does not exist in ${slash(api)} (no remote)`,
    '- WEB-20: depends on OLD-9, which does not exist',
    '- WEB-20: depends on INFRASTRUCTURE-3, which does not exist',
  ]);
  assert.match(run(web, 'ticket', 'message-notify', '--title', 'Old', '--depends', 'OLD-9')[0], /refused \(--depends: no ticket OLD-9\)$/);
  assert.equal(run(web, 'ticket', 'message-notify', '--title', 'Notes', '--depends', 'API-123')[0], `plans: ticket refused (--depends: no ticket API-123 in ${slash(api)} (no remote))`);
  assert.ok(run(web, 'tickets', 'WEB-20').includes(`  depends: OLD-9 not found, OLD-1 to do, API-122 to do (${slash(api)}, no remote), INFRASTRUCTURE-3 not found`));
  // A draft: the same rule, OLD is this project's.
  git(web, 'checkout', '-q', 'main');
  run(web, 'new', 'show-badges');
  assert.match(run(web, 'ticket', 'show-badges', '--title', 'Old', '--depends', 'OLD-9')[0], /refused \(--depends: no ticket OLD-9\)$/);
});

gitTest('another repository read in full: a ticket on an old branch exists; a folder that is not a git repository is not checked', () => {
  const { tmp, api, web } = twoRepos();
  // API-50 only on a branch with no commit for 60 days.
  const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  git(api, 'checkout', '-q', '-b', 'old-work', 'main');
  for (const [rel, text] of Object.entries({ 'tickets/old-work/API-50-old.md': ticket('API-50', { feature: 'old-work' }) })) write(api, rel, text);
  git(api, 'add', '-A');
  execFileSync('git', ['-C', api, 'commit', '-q', '-m', 'old work'], { env: { ...process.env, GIT_AUTHOR_DATE: old, GIT_COMMITTER_DATE: old }, stdio: 'ignore' });
  git(api, 'checkout', '-q', 'message-notify');
  assert.deepEqual(run(web, 'ticket', 'message-notify', '--title', 'Old', '--depends', 'API-50').slice(0, 2), ['created: tickets/message-notify/WEB-19-old.md', 'ticket: WEB-19']);
  assert.equal(run(web, 'check', 'message-notify').filter((l) => /API-50/.test(l)).length, 0);
  // A plain folder in the map (a wrong path): not checked, never a problem.
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  run(web, 'settings', 'set', '--repo', `PLN=${slash(plain)}`);
  const out = run(web, 'ticket', 'message-notify', '--title', 'Plain', '--depends', 'PLN-1');
  assert.equal(out[2], `note: WEB-20 depends on PLN-1: not checked (${slash(plain)} is not a git repository)`);
  assert.ok(run(web, 'tickets', 'WEB-20').includes(`  depends: PLN-1 not checked (${slash(plain)} is not a git repository)`));
  // Control characters in a folder of the map never reach the output.
  run(web, 'settings', 'set', '--repo', 'ESC=C:/gone\x1b[31m');
  write(web, 'tickets/message-notify/WEB-21-esc.md', ticket('WEB-21', { depends: ['ESC-1'] }));
  assert.ok(!run(web, 'tickets', 'WEB-21').join('\n').includes('\x1b'));
});
