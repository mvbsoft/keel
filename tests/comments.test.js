'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const rules = require(path.join(PLUGIN, 'hooks', 'comment-rules.js'));
const comments = require(path.join(PLUGIN, 'scripts', 'comments.js'));
const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const schema = require(path.join(PLUGIN, 'schemas', 'config.schema.json'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function repo(files, config) {
  const dir = tempDir('keel-comments-');
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  if (config) {
    fs.mkdirSync(path.join(dir, '.keel'));
    fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify(config));
  }
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('comment rules: every level renders its own sections, no placeholder left, within the hook budget', () => {
  const seen = new Set();
  for (const level of rules.LEVELS) {
    const text = rules.render(PLUGIN, level);
    assert.match(text, new RegExp(`level: ${level}\\)`));
    assert.doesNotMatch(text, /\{\{|<!-- /, level);
    assert.match(text, new RegExp(`At level "${level}"`));
    assert.match(text, /\*\*1\. Tricky code: always a comment/);
    assert.ok(text.length < 4500, `${level}: ${text.length} characters`);
    seen.add(text);
  }
  assert.equal(seen.size, rules.LEVELS.length);
});

test('comment rules: the level comes from .keel/config.json; missing or unknown means short', () => {
  const dir = tempDir('keel-level-');
  assert.equal(rules.projectLevel(dir), 'short');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{"comments":{"level":"detailed"}}');
  assert.equal(rules.projectLevel(dir), 'detailed');
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{"comments":{"level":"none"}}');
  assert.equal(rules.projectLevel(dir), 'short', 'there is no level without comments');
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{"comments":{"level":"lots"}}');
  assert.equal(rules.projectLevel(dir), 'short');
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), '{bad');
  assert.equal(rules.projectLevel(dir), 'short');
});

test('config schema: comments.level is optional and one of four levels', () => {
  const base = {
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
  assert.deepEqual(validate(base, schema), []);
  assert.deepEqual(validate({ ...base, comments: { level: 'detailed' } }, schema), []);
  assert.notDeepEqual(validate({ ...base, comments: { level: 'lots' } }, schema), []);
  assert.notDeepEqual(validate({ ...base, comments: { level: 'none' } }, schema), [], 'no level without comments');
  assert.notDeepEqual(validate({ ...base, comments: {} }, schema), []);
  assert.deepEqual(validate({ ...base, comments: { level: 'short', ticket_prefixes: ['ABC', 'D'], adr_refs: 'forbidden', refs_exempt: ['docs/debt.md'] } }, schema), []);
  assert.notDeepEqual(validate({ ...base, comments: { level: 'short', ticket_prefixes: ['abc'] } }, schema), [], 'prefixes are upper case');
  assert.notDeepEqual(validate({ ...base, comments: { level: 'short', adr_refs: 'sometimes' } }, schema), []);
});

test('comments.js: a literal without a comment is a note; with a comment or from named parts it is not', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({
    'src/a.js': [
      "'use strict';",
      'const MASK = 0x1F;',
      '// 9.81 m/s², standard gravity',
      'const G = 9.81;',
      'const DAY_MS = 24 * 60 * 60 * 1000;',
      'const BUF = 1024 * 1024;',
      'const HALF = 0.5;',
      'const SECONDS = 86400; // one day',
      'const RATE = 0.42;',
      '',
    ].join('\n'),
    'test/a.test.js': 'const expected = 12345.67;\n',
  });
  const r = comments.run(dir, {});
  const literals = r.notes.filter((n) => n.kind === 'literal');
  assert.deepEqual(literals.map((n) => [n.file, n.line, n.literals]), [['src/a.js', 2, ['0x1F']], ['src/a.js', 9, ['0.42']]]);
});

test('comments.js: a long block is a note at short; the file header and a detailed level allow more', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const block = ['// one', '// two', '// three', '// four', '// five', '// six'];
  const text = ['// Header line one', '// two', '// three', '// four', '// five', "'use strict';", ...block, 'function f() { return 1; }', ''].join('\n');
  const short = comments.run(repo({ 'src/b.js': text }, { comments: { level: 'short' } }), {});
  assert.deepEqual(short.notes.filter((n) => n.kind === 'long-block').map((n) => [n.line, n.lines]), [[7, 6]]);
  const detailed = comments.run(repo({ 'src/b.js': text }, { comments: { level: 'detailed' } }), {});
  assert.equal(detailed.level, 'detailed');
  assert.deepEqual(detailed.notes.filter((n) => n.kind === 'long-block'), []);
});

test('comments.js: the share of comment lines is measured on added lines only, from 30 lines', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const code = Array.from({ length: 30 }, (_, i) => `x${i} = ${i % 9}`);
  const heavy = code.flatMap((l) => ['# says what the next line does', l]).join('\n');
  const r = comments.run(repo({ 'app.py': heavy }, { comments: { level: 'short' } }), {});
  assert.equal(r.share, 50);
  assert.equal(r.notes[0].kind, 'share');
  const light = comments.run(repo({ 'app.py': code.join('\n') }), {});
  assert.equal(light.share, 0);
  assert.deepEqual(light.notes, []);
  assert.match(comments.report(r), /50 % of the new lines are comments; level short allows 20 %/);
});

test('comments.js: directives for tools are not comments', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const text = ["'use strict';", '// eslint-disable-next-line no-console', 'console.log(1); // istanbul ignore next', 'const x = 2;', ''].join('\n');
  const r = comments.run(repo({ 'src/a.js': text }), {});
  assert.equal(r.new_comment_lines, 0);
  assert.deepEqual(r.notes, []);
});
test('comments.js: Python docstrings count as comments; strings elsewhere do not', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const text = ['def f(x):', '    """Return x.', '', '    More."""', '    s = """not a doc"""', '    return x', ''].join('\n');
  const r = comments.run(repo({ 'm.py': text }), {});
  assert.equal(r.new_lines, 5);
  assert.equal(r.new_comment_lines, 2);
});

test('comments.js: only lines the change added count; secret and unknown files are skipped', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({});
  fs.writeFileSync(path.join(dir, 'old.js'), '// old comment\nconst A = 123456;\n');
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'old']);
  fs.appendFileSync(path.join(dir, 'old.js'), 'const B = 1;\n');
  fs.writeFileSync(path.join(dir, '.env'), 'KEY=0x1234\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'nothing 0x1234\n');
  const r = comments.run(dir, {});
  assert.equal(r.new_lines, 1);
  assert.deepEqual(r.notes, []);
});

test('comments.js --project: share of the code as it is and the closest level', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({
    'src/a.js': '// what this is\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n',
    'vendor/lib.js': '// x\n// y\n// z\n',
    'test/a.test.js': '// x\n// y\n',
  });
  const m = comments.measureProject(dir);
  assert.equal(m.files, 1);
  assert.equal(m.share, 20);
  assert.equal(m.suggested_level, 'functions');
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'comments.js'), dir, '--project'], { encoding: 'utf8' });
  assert.match(out, /^comments in the project now: 1 of 5 lines in 1 source files \(20 %\); closest level: functions/);
});

test('comments.js: ids of tickets, records and commits in new comments and docs are notes', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const files = {
    'src/a.js': [
      "'use strict';",
      '// Retries twice, see ABC-12 and ABC-A-7.',
      "const label = 'ABC-99'; // per D-4, measured at 01071c1b",
      '// UTF-8 only; mod-10 check; colour #ff00ff80; ADR-3 says why',
      'const MASK = 0x1f2e3d4f; // a CRC-32 seed from the spec',
      '',
    ].join('\n'),
    'docs/guide.md': ['# Guide', 'Done in ABC-5.', 'See [ADR-3](decisions/0003-x.md); ADR-4 is bare.', '```', 'git log  # a1b2c3d ABC-6', '```', ''].join('\n'),
    'docs/decisions/0003-x.md': 'Decided in ABC-7 at a1b2c3d.\n',
    'tasks/ABC-8.md': 'ABC-8\n',
    'CHANGELOG.md': '- ABC-9\n',
    'docs/debt.md': '- D-10 open\n',
  };
  const config = { comments: { level: 'short', ticket_prefixes: ['ABC', 'D'], refs_exempt: ['docs/debt.md'] } };
  const refs = (r) => r.notes.filter((n) => n.kind === 'ref').map((n) => [n.file, n.line, n.refs]);
  const allowed = comments.run(repo(files, config), {});
  assert.deepEqual(refs(allowed), [
    ['src/a.js', 2, ['ABC-12', 'ABC-A-7']],
    ['src/a.js', 3, ['D-4', '01071c1b']],
    ['docs/guide.md', 2, ['ABC-5']],
  ], 'a string in code, UTF-8, mod-10, colours, hex literals, fenced blocks and exempt files are not ids');
  assert.match(comments.report(allowed), /src\/a\.js:2: ABC-12, ABC-A-7 points at a ticket, record or commit .* Fix it; do not keep it\./);

  const forbidden = comments.run(repo(files, { comments: { ...config.comments, adr_refs: 'forbidden' } }), {});
  assert.deepEqual(refs(forbidden).filter(([, , ids]) => ids.some((id) => id.startsWith('ADR'))), [
    ['src/a.js', 4, ['ADR-3']],
    ['docs/guide.md', 3, ['ADR-4']],
  ], 'forbidden: a bare mention is a note, a link in a doc is not');

  const unset = comments.run(repo(files), {});
  assert.deepEqual(refs(unset), [['src/a.js', 3, ['01071c1b']]], 'no prefixes configured: only commit hashes');
});

test('comments.js --project: ticket prefixes seen in commit subjects and branch names', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({});
  const commit = (msg) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', msg]);
  for (const msg of ['Merge ticket/ABC-12', 'ABC-A-13: fix', 'ABC-12 again', 'Read UTF-8 and UTF-16', 'Per ADR-3 and ADR-4', 'QQ-5 start', 'ONE-1 only']) commit(msg);
  execFileSync('git', ['-C', dir, 'branch', 'feature/QQ-6-x']);
  assert.deepEqual(comments.ticketPrefixesSeen(dir), [{ prefix: 'ABC', ids: 2 }, { prefix: 'QQ', ids: 2 }]);
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'comments.js'), dir, '--project'], { encoding: 'utf8' });
  assert.match(out, /^ticket prefixes in git history: ABC \(2 ids\), QQ \(2 ids\)$/m);
});

test('comments.js: never fails a command; outside git it says it did not measure', () => {
  const dir = tempDir('keel-nogit-');
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'comments.js'), dir], { encoding: 'utf8' });
  assert.match(out, /^comments: level short; 0 of 0 new lines|^comments: not measured/);
});

test('comments.js: a staged file in a repository with no commits is measured', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = tempDir('keel-comments-nocommit-');
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('init', '-q');
  fs.writeFileSync(path.join(dir, 'a.js'), 'const SECONDS = 86400;\n');
  g('add', 'a.js');
  const r = comments.run(dir, {});
  assert.deepEqual(r.notes.map((n) => [n.kind, n.file, n.line]), [['literal', 'a.js', 1]]);
});

test('comments.js: lines of a hunk in the middle of a committed file get their own numbers', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({});
  const before = Array.from({ length: 12 }, (_, i) => `const keep${i} = ${i};`);
  fs.writeFileSync(path.join(dir, 'm.js'), `${before.join('\n')}\n`);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'm']);
  // four lines added after line 5; the magic number is the third of them, line 8 of the new file
  const after = [...before.slice(0, 5), 'const a = 1;', 'const b = 2;', 'const c = 86400;', 'const d = 4;', ...before.slice(5)];
  fs.writeFileSync(path.join(dir, 'm.js'), `${after.join('\n')}\n`);
  const r = comments.run(dir, {});
  assert.deepEqual(r.notes.map((n) => [n.kind, n.line, n.literals]), [['literal', 8, ['86400']]]);
  assert.equal(r.new_lines, 4);
});

test('comments.js: untracked files from before the task and --skip files are left out like in changes.js', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({ 'old.js': 'const OLD = 86400;\n', 'skipped.js': 'const SKIPPED = 86400;\n' });
  const { untrackedSnapshot } = require(path.join(PLUGIN, 'scripts', 'lib', 'diff.js'));
  fs.mkdirSync(path.join(dir, '.keel', 'local'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.keel', 'local', 'session-start.json'), JSON.stringify({ untracked: untrackedSnapshot(dir) }));
  fs.writeFileSync(path.join(dir, 'new.js'), 'const NEW = 86400;\n');
  assert.deepEqual(comments.run(dir, { skip: ['skipped.js'] }).notes.map((n) => n.file), ['new.js']);
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'comments.js'), dir, '--skip', 'new.js', '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out).notes, [], '--skip on the command line; the older files are on record');
});

test('comments.js: secret paths from the profile are never read', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = repo({ 'config/prod.js': 'const KEY = 123456;\n', 'src/a.js': 'const B = 654321;\n' });
  fs.mkdirSync(path.join(dir, '.keel'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), JSON.stringify({ secret_paths: ['config/prod.js'] }));
  assert.deepEqual(comments.run(dir, {}).notes.map((n) => n.file), ['src/a.js']);
});

test('comments.js: when git cannot give the change it says so instead of reporting ok', () => {
  const dir = tempDir('keel-nogit-');
  assert.throws(() => comments.run(dir, {}), /not a git repository/);
  const out = execFileSync(process.execPath, [path.join(PLUGIN, 'scripts', 'comments.js'), dir], { encoding: 'utf8' });
  assert.match(out, /^comments: not measured \(not a git repository\)/);
});
