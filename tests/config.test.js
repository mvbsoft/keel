'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('../plugins/keel/scripts/lib/config.js');
const { tempDir } = require('./fixtures/tmp.js');

function project(content) {
  const dir = tempDir('keel-config-');
  if (content !== undefined) {
    fs.mkdirSync(path.join(dir, '.keel'));
    fs.writeFileSync(path.join(dir, '.keel', 'config.json'), content);
  }
  return dir;
}

const VALID = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'develop', ask_before_merge: false, state_in_git: false },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 3, pattern: 'diataxis' },
};

test('checkConfig: missing, broken, invalid and ok are told apart', () => {
  assert.equal(checkConfig(project()).state, 'missing');
  const broken = checkConfig(project('{bad'));
  assert.equal(broken.state, 'broken');
  assert.match(broken.errors[0], /not valid JSON/);
  const invalid = checkConfig(project(JSON.stringify({ ...VALID, schema_version: 9 })));
  assert.equal(invalid.state, 'invalid');
  assert.deepEqual(invalid.errors, ['$.schema_version: must equal 1']);
  const ok = checkConfig(project(JSON.stringify(VALID)));
  assert.equal(ok.state, 'ok');
  assert.equal(ok.config.git.main_branch, 'develop');
});

test('checkConfig: a directory in place of the file is reported, not thrown', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.keel', 'config.json'), { recursive: true });
  assert.equal(checkConfig(dir).state, 'broken');
});

test('checkConfig: a config saved with a byte order mark (Windows PowerShell 5.1) is read as ok', () => {
  assert.equal(checkConfig(project('\uFEFF' + JSON.stringify(VALID))).state, 'ok');
});
