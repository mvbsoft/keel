'use strict';
// keel's trash and task folders against planted manifests, links and clashing ids: nothing is ever
// moved out of the project, into .git, or over another task.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));
const { validate } = require(path.join(SCRIPTS, 'lib', 'schema.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (script, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const notes = (dir, ...args) => run('notes.js', dir, ...args);
// A finish: the verification is recorded first (here: the user chose none), then the task is deleted.
const finish = (dir, ...args) => { run('fingerprint.js', dir, 'save', '--tier', 'none'); return notes(dir, 'task', 'delete', ...args); };
const link = (target, at) => fs.symlinkSync(target, at, 'junction');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

const CONFIG = { schema_version: 1, repo_language: 'en', gates: { checks: [], security_scanners: [] }, git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true }, verification: { tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 }, verifier_caps: { basic: 3, standard: 5, maximum: 8 } }, architecture: { file_lines_warn: 700, file_lines_max: 1000 }, docs: { profile: 1, pattern: 'none' } };
const TASK = (id, extra = {}) => {
  const f = { id, title: `Title of ${id}`, source: 'text', link: '-', status: 'active', branch: '-', base: 'main', merge_into: 'main', execution: 'here', plan: 'inline', created: '2026-10-01', updated: '2026-10-01', after_commit: '-', ...extra };
  return `---\n${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# ${id}\n\n## Goal\nGoal of ${id}\n\n## Next action\nNext of ${id}\n`;
};

function project() {
  const dir = tmp('keel-trash-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, '.keel/.gitignore', 'local/\n');
  return dir;
}

// A batch as keel writes it, with whatever items a planted manifest names.
function plant(dir, batch, items, by = 'task') {
  const b = path.join(dir, '.keel', 'local', 'trash', batch);
  for (const it of items) if (it.content !== undefined) write(path.join(b, 'files'), it.path, it.content);
  write(b, 'manifest.json', JSON.stringify({ batch, at: new Date().toISOString(), by, items: items.map(({ content, ...i }) => ({ kind: 'file', bytes: 1, ...i })) }));
  return b;
}

test('restore never writes outside the project or into .git, whatever a manifest names', () => {
  const dir = project();
  const outside = path.basename(dir) + '-evilout';
  plant(dir, '20261001-100000', [
    { path: `../${outside}/x.txt`, content: 'evil' },
    { path: 'tasks/../.git/hooks/pre-commit', content: 'evil' },
    { path: '.GIT/config', content: 'evil' },
    { path: path.join(dir, 'abs.txt') },
    { path: 'ok.txt', content: 'fine' },
  ], 'cleanup');
  const out = run('cleanup.js', dir, 'restore', '20261001-100000');
  assert.equal(out[0], 'cleanup: restored 1 items from 20261001-100000');
  assert.equal(out.filter((l) => /^kept in the trash: .*\(refused: /.test(l)).length, 4, out.join('\n'));
  assert.ok(!fs.existsSync(path.join(path.dirname(dir), outside)), 'nothing outside the project');
  assert.ok(!exists(dir, '.git'), 'nothing in .git');
  assert.equal(fs.readFileSync(path.join(dir, 'ok.txt'), 'utf8'), 'fine');
  assert.equal(trash.listBatches(dir)[0].items.length, 4, 'the refused items stay in the batch');
});

test('task restore puts back only the task\'s own folder, never other items of the batch', () => {
  const dir = project();
  plant(dir, '20261001-100000', [
    { path: '.keel/tasks/A-1', kind: 'folder', content: undefined },
    { path: 'src/evil.js', content: 'evil' },
    { path: '.keel/tasks/A-1/../../../evil', content: 'evil' },
  ]);
  write(path.join(dir, '.keel/local/trash/20261001-100000/files'), '.keel/tasks/A-1/task.md', TASK('A-1'));
  const out = notes(dir, 'task', 'restore', 'A-1', '--session', 's1');
  assert.match(out[0], /^restored: \.keel\/tasks\/A-1 \(trash batch 20261001-100000\)/);
  assert.ok(exists(dir, '.keel/tasks/A-1/task.md'));
  assert.ok(!exists(dir, 'src/evil.js') && !fs.existsSync(path.join(dir, '..', 'evil')));
  assert.deepEqual(trash.listBatches(dir)[0].items.map((i) => i.path).sort(), ['.keel/tasks/A-1/../../../evil', 'src/evil.js']);
});

test('moveToTrash refuses paths that leave the project or reach .git', () => {
  const dir = project();
  write(dir, 'a.bak', 'x');
  const r = trash.moveToTrash(dir, ['../x', '.git/config', 'a/../../b', 'a.bak'], 'cleanup');
  assert.deepEqual(r.moved.map((m) => m.path), ['a.bak']);
  assert.deepEqual(r.failed.map((f) => f.path), ['../x', '.git/config', 'a/../../b']);
});

test('.keel/local as a link out of the project: markers, closed tasks and trash batches are refused', () => {
  const outside = tmp('keel-outside-local-');
  const dir = project();
  link(outside, path.join(dir, '.keel', 'local'));
  write(dir, '.keel/tasks/A-1/task.md', TASK('A-1'));
  write(dir, 'a.bak', 'x');
  assert.match(notes(dir, 'task', 'new', 'N-1', '--title', 'x', '--source', 'text', '--session', 's1')[0], /^notes: task new refused \(\.keel\/local is a link: keel does not write through it\)/);
  assert.match(notes(dir, 'task', 'activate', 'A-1', '--session', 's1')[0], /^notes: task activate refused \(\.keel\/local is a link/);
  assert.match(notes(dir, 'task', 'delete', 'A-1', '--session', 's1')[0], /^notes: task delete refused \(\.keel\/local is a link/);
  assert.match(notes(dir, 'task', 'drop', 'A-1')[0], /refused \(\.keel\/local is a link/);
  assert.match(notes(dir, 'task', 'restore', 'A-1', '--session', 's1')[0], /refused \(\.keel\/local is a link/);
  assert.match(run('cleanup.js', dir, 'find').join('\n'), /^cleanup: stopped\nreason: \.keel\/local is a link/);
  assert.match(notes(dir, 'check', '--begin', '--session', 's1').join('\n'), /^session start record: refused \(\.keel\/local is a link/m);
  const r = trash.moveToTrash(dir, ['a.bak'], 'cleanup');
  assert.equal(r.batch, null);
  assert.match(r.failed[0].reason, /\.keel\/local is a link/);
  assert.ok(exists(dir, '.keel/tasks/A-1/task.md') && exists(dir, 'a.bak'));
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing landed outside');
});

test('task restore refuses an id already in use, in either tasks folder, any case', () => {
  for (const clash of ['.keel/local/tasks/a-1/task.md', '.keel/tasks/a-1/task.md']) {
    const dir = project();
    write(dir, '.keel/tasks/A-1/task.md', TASK('A-1'));
    assert.match(finish(dir, 'A-1', '--session', 's1')[0], /^deleted: /);
    write(dir, clash, TASK('a-1'));
    const out = notes(dir, 'task', 'restore', 'A-1', '--session', 's1');
    assert.match(out[0], /^notes: task restore refused \(.* already holds the id A-1 \(ids compare without case\)/, clash);
    assert.ok(!exists(dir, '.keel/tasks/A-1/task.md') || clash === '.keel/tasks/a-1/task.md', 'no second folder with the same id');
    assert.equal(trash.listBatches(dir).length, 1, 'the batch stays');
  }
});

test('an id ending in .md is compared whole: restoring "notes" never takes the folder of "notes.md"', () => {
  const dir = project();
  write(dir, '.keel/tasks/notes.md/task.md', TASK('notes.md'));
  assert.match(finish(dir, 'notes.md', '--session', 's1')[0], /^deleted: \.keel\/tasks\/notes\.md\//);
  assert.match(notes(dir, 'task', 'restore', 'notes', '--session', 's1')[0], /no trash batch holds notes/);
  assert.match(notes(dir, 'task', 'restore', 'notes.md', '--session', 's1')[0], /^restored: \.keel\/tasks\/notes\.md /);
});

test('a manifest without a list of items is skipped; the other batches still list and restore', () => {
  const dir = project();
  write(dir, 'a.bak', 'x');
  const good = trash.moveToTrash(dir, ['a.bak'], 'cleanup');
  write(dir, '.keel/local/trash/20200101-000000/manifest.json', JSON.stringify({ batch: 'x', at: '2020-01-01', by: 'cleanup', items: 'oops' }));
  write(dir, '.keel/local/trash/20200102-000000/manifest.json', JSON.stringify({ batch: 'y', at: '2020-01-02', by: 'task', items: [null, 7] }));
  assert.deepEqual(trash.listBatches(dir).map((b) => b.batch), ['20200102-000000', good.batch]);
  assert.match(run('cleanup.js', dir, 'trash')[0], /^cleanup: 2 trash batches/);
  assert.match(run('cleanup.js', dir, 'restore', good.batch)[0], /restored 1 items/);
  assert.match(notes(dir, 'task', 'restore', 'X-1', '--session', 's1')[0], /no trash batch holds X-1/);
});

test('two batches in the same second never share a folder', () => {
  const dir = project();
  const now = new Date(2026, 9, 1, 10, 0, 0);
  write(dir, 'a.bak', 'a');
  write(dir, 'b.bak', 'b');
  write(dir, 'c.bak', 'c');
  fs.mkdirSync(path.join(dir, '.keel', 'local', 'trash', '20261001-100000'), { recursive: true });
  const names = ['a.bak', 'b.bak', 'c.bak'].map((f) => trash.moveToTrash(dir, [f], 'cleanup', {}, now).batch);
  assert.deepEqual(names, ['20261001-100000-2', '20261001-100000-3', '20261001-100000-4']);
  assert.equal(trash.moveToTrash(dir, ['gone.bak'], 'cleanup', {}, now).batch, null);
  assert.ok(!exists(dir, '.keel/local/trash/20261001-100000-5'), 'a batch that moved nothing leaves no folder');
});

test('notes.js names every task command, restore included', () => {
  const dir = project();
  assert.equal(notes(dir, 'task', 'nope')[0], 'notes: unknown task command "nope" (new, active, activate, deactivate, delete, restore, drop, inventory)');
});

gitTest('inventory refuses a branch or base that git would read as an option', () => {
  const dir = project();
  git(dir, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['branch', '--output=pwned.txt'], ['base', '-p']]) {
    write(dir, '.keel/tasks/I-1/task.md', TASK('I-1', { [k]: v }));
    assert.match(notes(dir, 'task', 'inventory', 'I-1')[0], new RegExp(`^notes: task inventory refused \\(the task's ${k} starts with "-"`));
  }
  assert.ok(!exists(dir, 'pwned.txt'));
});

test('schema: inherited names such as constructor are not properties', () => {
  const schema = { type: 'object', required: ['constructor'], additionalProperties: false, properties: { a: { type: 'string' } } };
  assert.ok(validate({}, schema).some((e) => /missing "constructor"/.test(e)));
  assert.ok(validate({ toString: 'x' }, schema).some((e) => /toString: unexpected property/.test(e)));
});
