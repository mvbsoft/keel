'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPT = path.join(__dirname, '..', 'plugins', 'keel', 'statusline', 'statusline.ps1');

test('statusline.ps1: a Cyrillic folder and branch name come out as UTF-8, not in the console code page', { skip: process.platform !== 'win32' && 'Windows PowerShell only' }, () => {
  const repo = path.join(tempDir('keel-sl-'), 'папка-тест');
  fs.mkdirSync(repo);
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q', '-b', 'гілка-тест').status, 0);
  assert.equal(git('commit', '-q', '--allow-empty', '-m', 'x').status, 0);
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
    input: Buffer.from(JSON.stringify({ workspace: { current_dir: repo }, model: { display_name: 'Модель' } }), 'utf8'),
  });
  const out = r.stdout.toString('utf8');
  assert.match(out, /папка-тест/, 'folder');
  assert.match(out, /гілка-тест/, 'branch');
  assert.match(out, /Модель/, 'model name');
  assert.ok(!out.startsWith('\uFEFF'), 'no byte order mark');
});
