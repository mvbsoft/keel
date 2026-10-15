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
