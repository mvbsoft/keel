'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeProject } = require('./fixtures/projects.js');
const { scan } = require('../plugins/keel/scripts/scan.js');

const SCRIPT = path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'check-config.js');
const VALID = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'go test ./...' }], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

function run(dir, ...flags) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const r = spawnSync(process.execPath, [SCRIPT, dir, ...flags], { encoding: 'utf8', env: clean });
  assert.equal(r.status, 0, 'always exits 0 so the command decides');
  // The fixtures are not git repositories; the git line has its own test below.
  return r.stdout.trim().split('\n').filter((l) => !l.startsWith('git: '));
}

function withConfig(config) {
  const dir = makeProject('go');
  fs.mkdirSync(path.join(dir, '.keel'));
  if (config !== undefined) fs.writeFileSync(path.join(dir, '.keel', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  return dir;
}

test('missing, broken, outdated and invalid configs are reported with a reason', () => {
  assert.deepEqual(run(makeProject('go')), ['keel-config: missing', 'reason: no .keel/config.json']);
  assert.match(run(withConfig('{bad')).join('\n'), /^keel-config: broken\nreason: .*not valid JSON/);
  assert.deepEqual(run(withConfig({ schema_version: 0 })), ['keel-config: outdated', 'reason: schema_version 0 is older than 1']);
  const invalid = run(withConfig({ ...VALID, git: { ...VALID.git, mode: 'yolo' } }));
  assert.equal(invalid[0], 'keel-config: invalid');
  assert.match(invalid[1], /git\.mode: must be one of/);
});

test('a valid config is ok; the profile is checked against the current files', () => {
  const dir = withConfig(VALID);
  assert.deepEqual(run(dir), ['keel-config: ok']);
  assert.deepEqual(run(dir, '--profile'), ['keel-config: ok', 'profile: missing']);

  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), JSON.stringify(scan(dir).profile));
  assert.deepEqual(run(dir, '--profile'), ['keel-config: ok', 'profile: ok']);

  fs.appendFileSync(path.join(dir, 'go.mod'), '\nrequire example.com/x v1.0.0\n');
  assert.match(run(dir, '--profile')[1], /^profile: stale/);

  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), '{"schema_version":1}');
  assert.equal(run(dir, '--profile')[1], 'profile: invalid');
});

test('a config and profile saved with a byte order mark are read like any other', () => {
  const dir = withConfig('\uFEFF' + JSON.stringify(VALID));
  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), '\uFEFF' + JSON.stringify(scan(dir).profile));
  assert.deepEqual(run(dir, '--profile'), ['keel-config: ok', 'profile: ok']);
});

test('a folder that is not a git repository gets a git line: keel needs one', () => {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_')));
  const out = (dir) => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', env: clean }).stdout;
  const dir = withConfig(VALID);
  assert.match(out(dir), /^git: none \(not a git repository/m);
  spawnSync('git', ['init', '-q', dir]);
  assert.doesNotMatch(out(dir), /^git:/m, 'a repository: no line');
});

// A repository in a temp folder with one commit on main; `sub` makes the project a subfolder of it.
function repoWith(sub) {
  const top = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keel-cc-'));
  const project = sub ? path.join(top, sub) : top;
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'README.md'), 'x\n');
  const git = (date, ...args) => {
    const env = { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
    const r = spawnSync('git', ['-C', top, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
  };
  git('2026-01-01T00:00:00Z', 'init', '-q', '-b', 'main');
  git('2026-01-01T00:00:00Z', 'add', '-A');
  git('2026-01-01T00:00:00Z', 'commit', '-q', '-m', 'first');
  // Commits settings in `folder` (the project's, by default) on a new branch, then goes back to main, where they are not.
  const settingsOn = (branch, date, folder = project) => {
    git(date, 'switch', '-q', '-c', branch);
    fs.mkdirSync(path.join(folder, '.keel'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.keel', 'config.json'), JSON.stringify(VALID));
    git(date, 'add', '-A');
    git(date, 'commit', '-q', '-m', 'settings');
    git(date, 'switch', '-q', 'main');
    fs.rmSync(path.join(folder, '.keel'), { recursive: true, force: true });
  };
  return { top, project, settingsOn };
}

test('settings only on another branch: the check names that branch in a reason and a line of its own', () => {
  const { project, settingsOn } = repoWith();
  settingsOn('PROJ-1-first-task', '2026-02-01T00:00:00Z');
  const lines = run(project);
  assert.equal(lines[0], 'keel-config: missing');
  assert.match(lines[1], /^reason: no \.keel\/config\.json here; the settings are on branch PROJ-1-first-task\b/);
  assert.equal(lines[2], 'settings on branch: PROJ-1-first-task');
  assert.equal(lines.length, 3);
});

test('settings on several branches: the newest branch is named', () => {
  const { project, settingsOn } = repoWith();
  settingsOn('older', '2026-02-01T00:00:00Z');
  settingsOn('newer', '2026-03-01T00:00:00Z');
  settingsOn('oldest', '2026-01-15T00:00:00Z');
  assert.ok(run(project).includes('settings on branch: newer'));
});

test('no settings on any branch of the repository: the plain missing report', () => {
  const { project } = repoWith();
  assert.deepEqual(run(project), ['keel-config: missing', 'reason: no .keel/config.json']);
});

test('a project in a subfolder of the repository: the settings are looked for in that folder, not at the top', () => {
  const { project, settingsOn } = repoWith('app');
  settingsOn('feature-x', '2026-02-01T00:00:00Z');
  assert.ok(run(project).includes('settings on branch: feature-x'));
  const other = repoWith('app');
  other.settingsOn('top-level', '2026-02-01T00:00:00Z', other.top);
  assert.deepEqual(run(other.project), ['keel-config: missing', 'reason: no .keel/config.json'], "the settings of the top folder are not the subfolder project's");
});

test('settings committed on the current branch and only deleted from the folder: the plain missing report', () => {
  const { top, project, settingsOn } = repoWith();
  settingsOn('other', '2026-02-01T00:00:00Z');
  settingsOn('copy', '2026-03-01T00:00:00Z');
  const git = (...args) => assert.equal(spawnSync('git', ['-C', top, ...args], { encoding: 'utf8' }).status, 0);
  git('checkout', '-q', 'other');
  fs.rmSync(path.join(project, '.keel'), { recursive: true, force: true });
  assert.deepEqual(run(project), ['keel-config: missing', 'reason: no .keel/config.json']);
});

test('the settings branch is checked out in another folder: that folder is named', () => {
  const { top, project, settingsOn } = repoWith();
  settingsOn('PROJ-1-first-task', '2026-02-01T00:00:00Z');
  const folder = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keel-cc-wt-')), 'work');
  assert.equal(spawnSync('git', ['-C', top, 'worktree', 'add', '-q', folder, 'PROJ-1-first-task'], { encoding: 'utf8' }).status, 0);
  const lines = run(project);
  assert.equal(lines[2], 'settings on branch: PROJ-1-first-task');
  // git names the folder by its real path (macOS: /private/var for the temp folder's /var).
  assert.equal(lines[3], `settings in folder: ${fs.realpathSync.native(folder).replace(/\\/g, '/')}`);
  assert.equal(lines.length, 4);
});

test('settings on a branch beyond the 50 newest are not looked for', () => {
  const { top, project, settingsOn } = repoWith();
  settingsOn('oldest', '2025-12-01T00:00:00Z');
  const branches = (from, to) => {
    for (let i = from; i < to; i++) assert.equal(spawnSync('git', ['-C', top, 'branch', `b${i}`], { encoding: 'utf8' }).status, 0);
  };
  branches(0, 49);
  assert.ok(run(project).includes('settings on branch: oldest'), 'the 50th branch is still looked at');
  branches(49, 50);
  assert.deepEqual(run(project).filter((l) => l.startsWith('settings on branch')), [], 'the 51st is not');
});

test('a folder that is not a git repository gets no branch line', () => {
  assert.ok(!run(makeProject('go')).some((l) => l.startsWith('settings on branch:')));
});
