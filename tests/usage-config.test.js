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
