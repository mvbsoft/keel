'use strict';
// Links inside keel's local folder and inside trash batches: keel never writes, moves or removes
// through one (folder links are junctions, which Windows allows without extra rights; file links are
// tested where the platform allows them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const trash = require(path.join(SCRIPTS, 'lib', 'trash.js'));

const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const run = (script, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const notes = (dir, ...args) => run('notes.js', dir, ...args);
const link = (target, at) => { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(target, at, 'junction'); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
// A file link needs Developer Mode or admin rights on Windows.
const fileLink = (target, at) => { try { fs.symlinkSync(target, at, 'file'); return true; } catch { return false; } };
const listed = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => String(f).split(path.sep).join('/')).sort();

const CONFIG = { schema_version: 1, repo_language: 'en', gates: { checks: [], security_scanners: [] }, git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true }, verification: { tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 }, verifier_caps: { basic: 3, standard: 5, maximum: 8 } }, architecture: { file_lines_warn: 700, file_lines_max: 1000 }, docs: { profile: 1, pattern: 'none' } };
const TASK = (id) => `---\nid: ${id}\ntitle: T\nsource: text\nlink: -\nstatus: active\nbranch: -\nbase: main\nmerge_into: main\nexecution: here\nplan: inline\ncreated: 2026-10-01\nupdated: 2026-10-01\nafter_commit: -\n---\n\n# ${id}\n\n## Goal\nG\n`;

function project() {
  const dir = tmp('keel-links-');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  return dir;
}

function plant(dir, batch, items, by = 'task') {
  const b = path.join(dir, '.keel', 'local', 'trash', batch);
  for (const it of items) if (it.content !== undefined) write(path.join(b, 'files'), it.path, it.content);
  write(b, 'manifest.json', JSON.stringify({ batch, at: new Date().toISOString(), by, items: items.map(({ content, ...i }) => ({ kind: 'file', bytes: 1, ...i })) }));
  return b;
}

function ledgerHook(dir, input) {
  spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'ledger.js')], { input: JSON.stringify({ cwd: dir, session_id: 's1', ...input }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
}

test('restore never follows a link inside a planted batch: files/home -> another folder is refused', () => {
  const dir = project();
  const outside = tmp('keel-home-');
  write(outside, '.ssh/id_rsa', 'KEY');
  const b = plant(dir, '20261001-100000', [{ path: 'home/.ssh/id_rsa' }, { path: 'ok.txt', content: 'fine' }], 'cleanup');
  link(outside, path.join(b, 'files', 'home'));
  const out = run('cleanup.js', dir, 'restore', '20261001-100000');
  assert.equal(out[0], 'cleanup: restored 1 items from 20261001-100000');
  assert.match(out.join('\n'), /kept in the trash: home\/\.ssh\/id_rsa \(refused: .*files\/home is a link\)/);
  assert.equal(fs.readFileSync(path.join(outside, '.ssh', 'id_rsa'), 'utf8'), 'KEY', 'the outside file stays where it was');
  assert.ok(!exists(dir, 'home'));

  // The same through task restore: the batch's .keel folder leads elsewhere.
  const other = tmp('keel-elsewhere-');
  write(other, 'tasks/A-1/task.md', TASK('A-1'));
  const t = plant(dir, '20261002-100000', [{ path: '.keel/tasks/A-1', kind: 'folder' }]);
  link(other, path.join(t, 'files', '.keel'));
  assert.match(notes(dir, 'task', 'restore', 'A-1', '--session', 's1')[0], /^notes: task restore refused \(nothing put back: \.keel\/tasks\/A-1 \(refused: .*is a link\)\)/);
  assert.ok(fs.existsSync(path.join(other, 'tasks', 'A-1', 'task.md')) && !exists(dir, '.keel/tasks/A-1'));

  // The batch folder itself as a link, and the item itself as a link.
  const away = tmp('keel-batch-');
  write(away, 'files/b.txt', 'away');
  write(away, 'manifest.json', JSON.stringify({ batch: 'x', at: new Date().toISOString(), by: 'cleanup', items: [{ path: 'b.txt', kind: 'file', bytes: 1 }] }));
  link(away, path.join(dir, '.keel', 'local', 'trash', '20261003-100000'));
  assert.match(run('cleanup.js', dir, 'restore', '20261003-100000').join('\n'), /^cleanup: stopped\nreason: .*20261003-100000 is a link: keel does not write through it/);
  assert.ok(fs.existsSync(path.join(away, 'files', 'b.txt')) && !exists(dir, 'b.txt'));
  const item = plant(dir, '20261004-100000', [{ path: 'c', kind: 'folder' }], 'cleanup');
  link(other, path.join(item, 'files', 'c'));
  assert.match(run('cleanup.js', dir, 'restore', '20261004-100000').join('\n'), /kept in the trash: c \(refused: .*files\/c is a link\)/);
  assert.ok(!exists(dir, 'c'));
  // Emptying the trash does not delete through a linked batch either.
  assert.match(run('cleanup.js', dir, 'empty-trash', '--all')[0], /^cleanup: unavailable \(refused: .*is a link\)/);
  assert.ok(fs.existsSync(path.join(away, 'files', 'b.txt')));
});

test('a folder link below .keel/local is never written, moved or removed through', () => {
  const dir = project();
  write(dir, '.keel/tasks/A-1/task.md', TASK('A-1'));
  write(dir, 'a.bak', 'x');
  assert.match(run('fingerprint.js', dir, 'save', '--tier', 'none')[0], /^saved: /);
  const outside = {};
  for (const name of ['finish', 'trash', 'tmp', 'active']) {
    outside[name] = tmp(`keel-out-${name}-`);
    link(outside[name], path.join(dir, '.keel', 'local', name));
  }
  write(outside.tmp, 'agents/old.md', 'keep');
  write(outside.tmp, 'verify-plan.json', 'keep');
  // finish/ is a link: the record is written first, so the folder does not move at all.
  assert.match(notes(dir, 'task', 'delete', 'A-1', '--session', 's1')[0], /^notes: task delete refused \(the finish record cannot be written: \.keel\/local\/finish is a link/);
  assert.ok(exists(dir, '.keel/tasks/A-1/task.md'));
  // trash/ is a link: nothing moves into it.
  assert.match(notes(dir, 'task', 'drop', 'A-1')[0], /refused \(could not move it: .*\.keel\/local\/trash is a link/);
  assert.equal(trash.moveToTrash(dir, ['a.bak'], 'cleanup').batch, null);
  assert.ok(exists(dir, 'a.bak') && exists(dir, '.keel/tasks/A-1/task.md'));
  // active/ is a link: no marker.
  assert.match(notes(dir, 'task', 'activate', 'A-1', '--session', 's1').join('\n'), /\.keel\/local\/active is a link/);
  // tmp/ is a link: cleanup's list, scan's result and the ledger hook's agent replies stay out of it.
  assert.match(run('cleanup.js', dir, 'find')[0], /^cleanup: unavailable \(\.keel\/local\/tmp is a link: keel does not write through it\)/);
  assert.match(run('scan.js', dir, '--out', path.join(dir, '.keel', 'local', 'tmp', 'scan.json'))[0], /^scan: \.keel\/local\/tmp is a link/);
  ledgerHook(dir, { agent_type: 'keel:reviewer', agent_id: 'a1', last_assistant_message: 'reply' });
  for (const [name, at] of Object.entries(outside)) {
    assert.deepEqual(listed(at), name === 'tmp' ? ['agents', 'agents/old.md', 'verify-plan.json'] : [], `nothing written into ${name}`);
  }
  assert.ok(exists(dir, '.keel/local/ledger.jsonl'), 'the ledger line itself is still written');
  // usage/out as a link: prepare writes nothing there and deletes nothing there.
  const out = tmp('keel-out-usage-');
  write(out, 'kept.json', '{}');
  link(out, path.join(dir, '.keel', 'local', 'usage', 'out'));
  const usage = spawnSync(process.execPath, [path.join(SCRIPTS, 'usage.js'), 'prepare', '--project', dir], { encoding: 'utf8', env: { ...process.env, KEEL_USAGE_DIR: tmp('keel-u-'), KEEL_PROJECTS_DIR: tmp('keel-p-') } });
  assert.match(usage.stdout, /usage: error: .*usage\/out is a link/);
  assert.deepEqual(listed(out), ['kept.json']);
});

test('a file link below .keel/local is not written through (last-verify.json, ledger.jsonl)', (t) => {
  const dir = project();
  const target = path.join(tmp('keel-target-'), 'victim.txt');
  fs.writeFileSync(target, 'original');
  fs.mkdirSync(path.join(dir, '.keel', 'local'), { recursive: true });
  if (!fileLink(target, path.join(dir, '.keel', 'local', 'last-verify.json'))) { t.skip('file links need Developer Mode or admin rights here'); return; }
  assert.match(run('fingerprint.js', dir, 'save', '--tier', 'none')[0], /last-verify\.json is a link/);
  fileLink(target, path.join(dir, '.keel', 'local', 'ledger.jsonl'));
  ledgerHook(dir, { agent_type: 'other', agent_id: 'a1' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'original');
});

test('empty-trash: --all takes no value, --older-than a whole number of days; the confirmation names the same', () => {
  const dir = project();
  write(dir, 'a.bak', 'x');
  trash.moveToTrash(dir, ['a.bak'], 'cleanup');
  for (const args of [['--all', 'x'], ['--older-than', '-1'], ['--older-than', 'abc'], ['--older-than'], ['--all', '--batch', 'b'], ['--batch']]) {
    assert.equal(run('cleanup.js', dir, 'empty-trash', ...args)[0], 'cleanup: stopped', args.join(' '));
    assert.equal(trash.listBatches(dir).length, 1, args.join(' '));
  }
  assert.deepEqual(trash.emptyChoice({ 'older-than': '0' }, 30), { olderThanDays: 0 });
  assert.deepEqual(trash.emptyChoice({}, 30), { olderThanDays: 30 });
  // The hook reads the options with the same function: what the script refuses is denied, 0 days is named.
  const s = SCRIPTS.split(path.sep).join('/');
  const p = dir.split(path.sep).join('/');
  const hook = (rest) => {
    const r = spawnSync(process.execPath, [path.join(PLUGIN, 'hooks', 'own-files.js')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: `node "${s}/cleanup.js" "${p}" empty-trash ${rest}` } }),
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN, CLAUDE_PROJECT_DIR: p },
      encoding: 'utf8',
    });
    return JSON.parse(r.stdout).hookSpecificOutput;
  };
  assert.equal(hook('--all x').permissionDecision, 'deny');
  assert.equal(hook('--older-than -1').permissionDecision, 'deny');
  assert.match(hook('--older-than 0').permissionDecisionReason, /delete the batches 0 or more days old of keel's trash/);
  assert.match(run('cleanup.js', dir, 'empty-trash', '--older-than', '0')[0], /^cleanup: deleted 1 trash batches for good/);
});

test('the usage page copy refuses a linked tmp folder; safe-command refuses a part folder outside the project', () => {
  const dir = tmp('keel-links-page-');
  const outside = tmp('keel-links-out-');
  link(outside, path.join(dir, '.keel', 'local', 'tmp'));
  run('usage-setup.js', dir, 'page');
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing written through the link');
  const other = tmp('keel-links-other-');
  write(other, 'package.json', JSON.stringify({ scripts: { check: 'curl -X POST https://example.com/hook' } }));
  const cmd = spawnSync(process.execPath, [path.join(SCRIPTS, 'safe-command.js'), '--x', other, dir, '--', 'npm', 'run', 'check'], { encoding: 'utf8' }).stdout;
  assert.doesNotMatch(cmd, /example\.com/, 'the other folder is not read');
  const out = spawnSync(process.execPath, [path.join(SCRIPTS, 'safe-command.js'), dir, path.relative(dir, other), '--', 'npm', 'run', 'check'], { encoding: 'utf8' }).stdout;
  assert.match(out, /refused: the part folder is outside the project/);
});
