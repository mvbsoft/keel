'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const { collectChanges, baseLineCounts, parseDiff } = require(path.join(SCRIPTS, 'lib', 'diff.js'));
const { secretCheck } = require(path.join(SCRIPTS, 'lib', 'project.js'));
const { isBulk } = require(path.join(SCRIPTS, 'lib', 'tier.js'));
const { treeState } = require(path.join(SCRIPTS, 'fingerprint.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

function put(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}
// A repository with one commit of `files`; `gitConfig` pairs are set in the repository's config.
function repo(files, { gitConfig = [], keel = false, commit = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-diff-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  g('config', 'core.autocrlf', 'false');
  for (const [k, v] of gitConfig) g('config', k, v);
  put(dir, files);
  if (keel) put(dir, { '.keel/config.json': JSON.stringify(CONFIG), '.keel/.gitignore': 'local/\n' });
  if (commit) { g('add', '-A'); g('commit', '-qm', 'init'); }
  return { dir, g };
}
const collect = (dir, extra = {}) => collectChanges(dir, { isSecret: secretCheck(dir).isSecret, ...extra });
const node = (script, ...args) => execFileSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8' });

test('diff parser: a TAB after a path with a space and quoted names are not part of the path', () => {
  const text = [
    'diff --git a/my cfg/.env b/my cfg/.env', 'index 1..2 100644', '--- a/my cfg/.env\t', '+++ b/my cfg/.env\t', '@@ -1 +1 @@', '-A=1', '+A=2',
    'diff --git a/my cfg/key.bin b/my cfg/key.bin', 'index 1..2 100644', 'Binary files a/my cfg/key.bin and b/my cfg/key.bin differ',
    'diff --git "a/tab\\tname.txt" "b/tab\\tname.txt"', 'old mode 100644', 'new mode 100755',
  ].join('\n');
  const files = parseDiff(text);
  assert.deepEqual(files.map((f) => f.path), ['my cfg/.env', 'my cfg/key.bin', 'tab\tname.txt']);
  assert.equal(files[0].oldPath, 'my cfg/.env');
});

test('diff parser: line numbers of added lines follow the hunks, context included', () => {
  const [f] = parseDiff(['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -2,3 +2,5 @@', ' two', '+three', '+four', ' five', '-six', '+six2', '@@ -20 +22 @@ fn', '-x', '+y'].join('\n'));
  assert.deepEqual(f.addedAt, [3, 4, 6, 22]);
  assert.deepEqual(f.added, ['three', 'four', 'six2', 'y']);
});

for (const [name, gitConfig] of [['default', []], ['diff.mnemonicPrefix', [['diff.mnemonicPrefix', 'true']]], ['diff.noprefix', [['diff.noprefix', 'true']]]]) {
  test(`a tracked secret in a folder with a space is flagged and never reaches the diff (${name})`, (t) => {
    if (!hasGit) { t.skip('git is not installed'); return; }
    const { dir } = repo({ 'my cfg/.env': 'TOKEN=old-value\n', 'my cfg/app.js': 'const a = 1;\n' }, { gitConfig });
    put(dir, { 'my cfg/.env': 'TOKEN=sk-live-new-value\n', 'my cfg/app.js': 'const a = 2;\n' });
    const c = collect(dir);
    assert.deepEqual(c.files.map((f) => f.path).sort(), ['my cfg/.env', 'my cfg/app.js']);
    const env = c.files.find((f) => f.path === 'my cfg/.env');
    assert.equal(env.secret, true);
    assert.deepEqual([env.added, env.removed], [[], []]);
    assert.ok(!c.diff.includes('sk-live-new-value') && !c.diff.includes('old-value'), 'no secret value in the diff for agents');
    assert.match(c.diff, /\+const a = 2;/);
    assert.equal(c.files.find((f) => f.path === 'my cfg/app.js').secret, false);
    assert.deepEqual(baseLineCounts(dir, c.base.sha, ['my cfg/app.js']), { 'my cfg/app.js': 1 });
  });
}

test('changes.js: sizes and fan-in of a file in a folder with a space use its real name', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'my dir/long.js': Array.from({ length: 720 }, (_, i) => `a${i}();`).join('\n') + '\n' }, { keel: true });
  fs.appendFileSync(path.join(dir, 'my dir', 'long.js'), 'more();\n');
  assert.match(node('changes.js', dir), /sizes: my dir\/long\.js 721 lines \(over warn, \+1 in this change\)/);
});

const PAD = Array.from({ length: 20 }, (_, i) => `K${i}=v${i}\n`).join('');
test('tracked secret files are redacted: .env, .npmrc and a rename away from a secret name', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir, g } = repo({
    '.env': `${PAD}SECRET=hunter2-old\n`,
    '.npmrc': '//registry.npmjs.org/:_authToken=npm-token-old\n',
    'src/a.js': 'const a = 1;\n',
  });
  put(dir, { '.env': `${PAD}SECRET=hunter2-new\n`, '.npmrc': '//registry.npmjs.org/:_authToken=npm-token-new\n', 'src/a.js': 'const a = 2;\n' });
  let c = collect(dir);
  assert.deepEqual(c.files.filter((f) => f.secret).map((f) => f.path).sort(), ['.env', '.npmrc']);
  for (const v of ['hunter2-old', 'hunter2-new', 'npm-token-old', 'npm-token-new']) assert.ok(!c.diff.includes(v), v);
  assert.match(c.diff, /\(secret file modified: content not shown\)/);

  g('mv', '.env', 'x.txt');
  c = collect(dir);
  const renamed = c.files.find((f) => f.path === 'x.txt');
  assert.equal(renamed.status, 'renamed');
  assert.equal(renamed.oldPath, '.env');
  assert.equal(renamed.secret, true, 'the old name was a secret');
  assert.ok(!c.diff.includes('hunter2'), 'no secret value after the rename');
});

test('a project folder inside a bigger repository sees only its own files, with paths relative to it', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'proj/src/a.js': 'one\ntwo\n', 'proj/readme.txt': 'x\n', 'other/b.js': 'b\n' });
  put(dir, { 'proj/src/a.js': 'one\ntwo\nthree\n', 'other/b.js': 'changed\n', 'proj/new.js': 'n\n', 'other/new.js': 'n\n' });
  const proj = path.join(dir, 'proj');
  const c = collect(proj);
  assert.deepEqual(c.files.map((f) => f.path).sort(), ['new.js', 'src/a.js']);
  assert.ok(!c.diff.includes('other/'), 'nothing of the rest of the repository');
  assert.deepEqual(baseLineCounts(proj, c.base.sha, ['src/a.js', 'new.js']), { 'src/a.js': 2, 'new.js': null }, 'line count at the base is found by the project-relative path');
});

test('base line counts of many files come from one read: text counted, missing and binary files null', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'a.js': 'one\ntwo\nthree\n', 'b c.js': 'x\r\ny\r\n', 'img.bin': 'a\0b', 'empty.js': '', 'z.js': 'last' });
  const base = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.deepEqual(baseLineCounts(dir, base, ['a.js', 'missing.js', 'img.bin', 'b c.js', 'empty.js', 'z.js']),
    { 'a.js': 3, 'missing.js': null, 'img.bin': null, 'b c.js': 2, 'empty.js': 0, 'z.js': 1 });
});

test('lock files, generated and vendored files: counted apart, their hunks replaced by a count', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const lock = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => `dep${i}`), null, 1);
  const { dir } = repo({ 'package-lock.json': lock(10), 'src/a.js': 'a\n' });
  put(dir, { 'package-lock.json': lock(300), 'src/a.js': 'b\n' });
  const c = collect(dir, { isBulk });
  assert.match(c.diff, /diff --git a\/package-lock\.json b\/package-lock\.json\n\(lock, generated or vendored file modified: \+\d+ -\d+, hunks not shown\)/);
  assert.ok(!c.diff.includes('dep200'));
  assert.match(c.diff, /\+b/);
  assert.ok(c.files.find((f) => f.path === 'package-lock.json').added.length > 250, 'the lines are still known, for counts');
});

test('changes.js prints how many lines lock and generated files have and keeps them out of the level', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const lock = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => `dep${i}`), null, 1);
  const { dir } = repo({ 'package-lock.json': lock(10), 'package.json': '{}\n', 'src/billing/a.js': 'a\n' }, { keel: true });
  put(dir, { 'package-lock.json': lock(1500), 'src/billing/a.js': 'b\n' });
  const out = node('changes.js', dir);
  assert.match(out, /^\d{4} lines in 1 lock\/generated\/vendored file\(s\), not counted for the level$/m);
  assert.match(out, /^changes: 2 files, \+1 -1 against HEAD$/m);
  assert.match(out, /proposal: basic because .*touches env/, 'the lock file still calls the dependencies topic');
  assert.doesNotMatch(out, /proposal: maximum/);
});

test('fingerprint: a changed binary file, or a binary untracked file, changes the tree state', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'img.bin': Buffer.from([0, 1, 2, 3]).toString('latin1') });
  fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 9]));
  const { isSecret } = secretCheck(dir);
  const a = treeState(dir, isSecret);
  fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 8]));
  assert.notEqual(treeState(dir, isSecret).fingerprint, a.fingerprint, 'tracked binary');

  fs.writeFileSync(path.join(dir, 'blob.dat'), Buffer.from([0, 5, 5]));
  const b = treeState(dir, isSecret);
  fs.writeFileSync(path.join(dir, 'blob.dat'), Buffer.from([0, 5, 6]));
  assert.notEqual(treeState(dir, isSecret).fingerprint, b.fingerprint, 'untracked binary');

  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 10));
  const c = treeState(dir, isSecret);
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(1024 * 1024 + 11));
  assert.notEqual(treeState(dir, isSecret).fingerprint, c.fingerprint, 'untracked file above the read limit');
});

test('past the limit untracked files are summarised by folder, not read, and still change the fingerprint', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'src/a.js': 'a\n' });
  put(dir, Object.fromEntries([...Array.from({ length: 4 }, (_, i) => [`gen/f${i}.js`, 'x\n']), ['docs/one.md', 'x\n']]));
  let c = collect(dir, { maxUntracked: 3 });
  assert.equal(c.files.length, 0, 'none of them is read');
  assert.equal(c.untracked.overflow.count, 5);
  assert.deepEqual(c.untracked.overflow.folders, [{ dir: 'gen', files: 4 }, { dir: 'docs', files: 1 }]);
  assert.match(c.diff, /5 untracked files in 2 folders, more than 3: not read; largest folders: gen 4; docs 1/);
  c = collect(dir, { maxUntracked: 5 });
  assert.equal(c.files.length, 5, 'at the limit they are read');
  assert.equal(c.untracked.overflow, null);

  const { isSecret } = secretCheck(dir);
  const state = () => treeState(dir, isSecret).fingerprint;
  // The real limit is 2000: the fingerprint of an overflowing tree follows the list of files.
  put(dir, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`bulk/f${i}.txt`, 'x'])));
  const before = state();
  put(dir, { 'bulk/another.txt': 'x' });
  assert.notEqual(state(), before);
});

test('changes.js tells when untracked files were not read because there are too many', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const { dir } = repo({ 'src/a.js': 'a\n' }, { keel: true });
  put(dir, Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`export/f${i}.txt`, 'x'])));
  const out = node('changes.js', dir);
  assert.match(out, /^2001 untracked files not read \(more than 2000\); largest folders: export 2001 \(ask the user which belong to the task/m);
  assert.match(out, /proposal: none/);
});
