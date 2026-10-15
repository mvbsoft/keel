'use strict';
// The validation sandbox (tests/fixtures/sandbox.js) used by the live runs: it builds, its own tests
// pass with the planted defects in place, keel proposes the intended level for each task, every
// planted defect is where the answer key says, and nothing in the sandbox hints at it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { makeSandbox, PLANTED, hasGit } = require('./fixtures/sandbox.js');

const CHANGES = path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'changes.js');
const sqlite = (() => { try { require('node:sqlite'); return true; } catch { return false; } })();

function files(root, dir = '') {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.name === '.git') return [];
    return e.isDirectory() ? files(root, rel) : [rel];
  });
}

test('sandbox: the task changes keep their own tests green', (t) => {
  if (!sqlite) { t.skip('node:sqlite is not available in this Node version'); return; }
  for (const variant of ['base', 'S', 'M', 'C', 'H']) {
    const { root } = makeSandbox(variant);
    const r = spawnSync(process.execPath, ['--test', 'test/*.spec.js'], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, `${variant}: ${r.stdout.slice(-600)}${r.stderr.slice(-300)}`);
  }
});

test('sandbox: keel proposes Standard for S and C, Maximum for M and H', (t) => {
  if (!hasGit()) { t.skip('git is not installed'); return; }
  const expected = { S: 'standard', M: 'maximum', C: 'standard', H: 'maximum' };
  for (const [variant, tier] of Object.entries(expected)) {
    const { root } = makeSandbox(variant, { keel: true });
    const out = execFileSync(process.execPath, [CHANGES, root], { encoding: 'utf8' });
    assert.match(out, new RegExp(`proposal: ${tier} because`), `${variant}:\n${out}`);
    assert.doesNotMatch(out, /untracked/, 'the task start was recorded, so the new files are the task\'s');
    const json = JSON.parse(fs.readFileSync(path.join(root, '.keel', 'local', 'tmp', 'changes.json'), 'utf8'));
    if (variant === 'S' || variant === 'C') assert.equal(json.groups.security, undefined, `${variant}: no security group`);
    if (variant === 'S') assert.ok(json.sizes.some((s) => s.path === 'src/tasks.js' && s.lines > 850), 'the big module is reported');
  }
});

test('sandbox: every planted defect is in place, and nothing hints at it', () => {
  for (const [variant, list] of Object.entries(PLANTED)) {
    const { root } = makeSandbox(variant);
    for (const p of list) assert.ok(fs.readFileSync(path.join(root, p.file), 'utf8').includes(p.find), `${p.id} at ${p.file}`);
    for (const rel of files(root)) {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.doesNotMatch(text, /\b(bug|bugs|buggy|planted|fixme|xxx|hack|vulnerab\w*|insecure|wrong on purpose)\b/i, `${variant}: ${rel}`);
    }
  }
});
