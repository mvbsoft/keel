'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadMachineConfig } = require(path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'usage-config.js'));

function configWith(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-config-'));
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify(settings));
  try { return loadMachineConfig({ KEEL_USAGE_DIR: dir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a hand-written history_days below 1 reads as the default, like a missing one', () => {
  assert.equal(configWith({ pc: 'a', history_days: 0 }).history_days, 30);
  assert.equal(configWith({ pc: 'a', history_days: -5 }).history_days, 30);
  assert.equal(configWith({ pc: 'a' }).history_days, 30);
  assert.equal(configWith({ pc: 'a', history_days: 1 }).history_days, 1);
  assert.equal(configWith({ pc: 'a', history_days: 90 }).history_days, 90);
});

test('keel\'s folder follows CLAUDE_CONFIG_DIR, keeps an existing ~/.claude/keel until the new one exists, and KEEL_USAGE_DIR wins', () => {
  const { spawnSync } = require('node:child_process');
  const lib = path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'lib', 'usage-config.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-usage-dir-'));
  const home = path.join(tmp, 'home');
  const profile = path.join(tmp, 'profile');
  fs.mkdirSync(home);
  fs.mkdirSync(profile);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CONFIG_DIR' && k !== 'KEEL_USAGE_DIR'));
  const dirFor = (env) => spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(lib)}).usageDir())`],
    { encoding: 'utf8', env: { ...clean, HOME: home, USERPROFILE: home, ...env } }).stdout;
  try {
    const legacy = path.join(home, '.claude', 'keel');
    const own = path.join(profile, 'keel');
    assert.equal(dirFor({}), legacy, 'no CLAUDE_CONFIG_DIR: ~/.claude/keel');
    assert.equal(dirFor({ CLAUDE_CONFIG_DIR: profile }), own, 'nothing yet anywhere: the profile\'s own folder');
    fs.mkdirSync(legacy, { recursive: true });
    assert.equal(dirFor({ CLAUDE_CONFIG_DIR: profile }), legacy, 'only the old folder exists: keel keeps it');
    fs.mkdirSync(own);
    assert.equal(dirFor({ CLAUDE_CONFIG_DIR: profile }), own, 'both exist: the profile\'s folder wins');
    assert.equal(dirFor({ CLAUDE_CONFIG_DIR: profile, KEEL_USAGE_DIR: path.join(tmp, 'x') }), path.join(tmp, 'x'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
