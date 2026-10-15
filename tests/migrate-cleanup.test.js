'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeOldSystem, hasGit } = require('./fixtures/old-system.js');
const { CANARY } = require('./fixtures/projects.js');
const { folderPattern, prefixPattern } = require('../plugins/keel/scripts/migrate.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const git = hasGit();

function run(script, root, args, env = {}) {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, script), root, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const readRel = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const writePlan = (root, plan) => {
  fs.mkdirSync(path.join(root, '.keel/local/tmp'), { recursive: true });
  fs.writeFileSync(path.join(root, '.keel/local/tmp/migrate-plan.json'), JSON.stringify(plan));
  return '.keel/local/tmp/migrate-plan.json';
};
// Every file outside .keel/ and the old folder, with its content: the move must leave them as they are.
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (['.git', '.keel', '.orbit'].includes(rel)) continue;
      if (e.isDirectory()) walk(rel); else out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
    }
  };
  walk('');
  return out;
}

test('folder and prefix patterns: the old path and commands only, never the product name', () => {
  const hit = (re, line) => { re.lastIndex = 0; return [...line.matchAll(re)].map((m) => m[0]); };
  const f = folderPattern('.orbit');
  assert.deepEqual(hit(f, 'notes in .orbit/next-session.md'), ['.orbit']);
  assert.deepEqual(hit(f, 'logs in `.orbit/sessions/`'), ['.orbit']);
  assert.deepEqual(hit(f, 'see ./.orbit/memory/'), ['./.orbit']);
  assert.deepEqual(hit(f, '/.orbit/'), ['/.orbit']);
  assert.deepEqual(hit(f, 'ORBIT_HOME=.orbit'), ['.orbit']);
  assert.deepEqual(hit(f, 'It lives in .orbit.'), ['.orbit']);
  for (const line of ['Orbit sells parts', 'app.orbit.example.com', 'ORBIT_API_URL', 'the orbit-core module', 'src/.orbit/x', '.orbital/', 'orbit']) assert.deepEqual(hit(f, line), [], line);
  const p = prefixPattern('/orbit:');
  assert.deepEqual(hit(p, 'run /orbit:handoff, then `/orbit:resume`'), ['/orbit:handoff', '/orbit:resume']);
  assert.deepEqual(hit(p, 'https://x.test/orbit:8080'), []);
});

test('migrate find: the git-ignored old folder is found and sorted; the secret is listed, never read', (t) => {
  const { root, userSettings } = makeOldSystem();
  const out = run('migrate.js', root, ['find'], { KEEL_USER_SETTINGS: userSettings });
  const result = JSON.parse(readRel(root, '.keel/local/tmp/migrate.json'));
  assert.ok(!out.includes(CANARY) && !JSON.stringify(result).includes(CANARY), 'the secret value never appears');
  assert.equal(result.systems.length, 1);
  const s = result.systems[0];
  assert.equal(s.path, '.orbit');
  if (git) assert.equal(s.git, 'ignored');
  assert.deepEqual(s.notes.map((n) => n.path), ['.orbit/next-session.md']);
  if (git) assert.deepEqual(s.notes[0].commits.map((c) => c.behind), [1], 'the note is one commit behind');
  assert.deepEqual(s.memory.map((m) => [m.path, m.lines]).sort(), [['.orbit/memory/archive.md', 20], ['.orbit/memory/project-memory.md', 213]]);
  assert.match(out, /213 lines, over 150/);
  assert.equal(s.logs.length, 3);
  assert.deepEqual(s.config, ['.orbit/config.yml']);
  assert.deepEqual(s.secrets, ['.orbit/cloud-keys.env']);
  const kinds = Object.fromEntries(s.data.map((d) => [d.path, d.kind]));
  assert.deepEqual(kinds, { '.orbit/adr/': 'docs', '.orbit/fix_prices_0923.py': 'scripts', '.orbit/notes/': 'unclear', '.orbit/runs/': 'data' });
  assert.deepEqual(result.prefixes, ['/orbit:'], 'the enabled plugin named like the folder gives the prefix');
  assert.deepEqual(result.plugins.map((p) => p.id), ['orbit@orbit-tools'], 'keel and disabled plugins are left out');
  if (git) assert.ok(result.rules.some((l) => l.startsWith('CLAUDE.md:4:')), 'the handoff rule in CLAUDE.md is found');
  // In-process with every file read recorded: the secret file is never opened.
  const opened = [];
  const { readFileSync, openSync } = fs;
  fs.readFileSync = (f, ...a) => { opened.push(String(f)); return readFileSync(f, ...a); };
  fs.openSync = (f, ...a) => { opened.push(String(f)); return openSync(f, ...a); };
  try {
    require('../plugins/keel/scripts/migrate.js').find(root, null);
    require('../plugins/keel/scripts/migrate.js').refs(root, '.orbit', '/orbit:');
    require('../plugins/keel/scripts/cleanup.js').find(root);
  } finally { fs.readFileSync = readFileSync; fs.openSync = openSync; }
  assert.ok(opened.length > 0);
  assert.deepEqual(opened.filter((f) => f.includes('cloud-keys')), []);
  // --from with a plugin name finds the same folder.
  const named = run('migrate.js', root, ['find', '--from', 'orbit'], { KEEL_USER_SETTINGS: userSettings });
  assert.match(named, /system \.orbit\//);
  assert.match(run('migrate.js', root, ['find', '--from', 'nothing-here'], { KEEL_USER_SETTINGS: userSettings }), /no such folder/);
  t.diagnostic(out.split('\n')[0]);
});

test('migrate refs: only the old folder path and the old prefix; product, variable and domain mentions stay', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  const out = run('migrate.js', root, ['refs', '--folder', '.orbit', '--prefix', 'orbit:']);
  const lines = out.split('\n').filter((l) => /^[^ ]+:\d+: \[/.test(l)).map((l) => l.slice(0, l.indexOf(': [')));
  assert.deepEqual(lines, ['.gitignore:2', 'CLAUDE.md:4', 'CLAUDE.md:5', 'CLAUDE.md:7', 'docs/setup.md:4']);
  assert.match(out, /left alone: 3 lines that mention "orbit"/);
  assert.doesNotMatch(out, /ORBIT_API_URL.*\]|app\.orbit/, 'the variable and the domain are never references');
});

test('migrate apply: moves, appends and trashes as planned; refuses secrets and targets outside .keel; resumes', () => {
  const { root } = makeOldSystem();
  const before = snapshot(root);
  const plan = writePlan(root, { source: '.orbit', actions: [
    { op: 'move', from: '.orbit/sessions', to: '.keel/sessions' },
    { op: 'move', from: '.orbit/memory/archive.md', to: '.keel/memory/project-memory-archive.md' },
    { op: 'append', from: '.orbit/memory/project-memory.md', to: '.keel/memory/project-memory-archive.md' },
    { op: 'trash', from: '.orbit/next-session.md' },
    { op: 'trash', from: '.orbit/cloud-keys.env' },
    { op: 'move', from: '.orbit/config.yml', to: '.keel/config.json' },
    { op: 'move', from: 'README.md', to: '../outside.md' },
  ] });
  const out = run('migrate.js', root, ['apply', plan]);
  assert.match(out, /^migrate: stopped; 4 done, 0 already done, 3 refused/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.keel/sessions')).sort(), ['2026-09-01-001.md', '2026-09-02-002.md', '2026-09-03-003.md']);
  const archive = readRel(root, '.keel/memory/project-memory-archive.md');
  assert.ok(archive.includes('old decision 20') && archive.includes('fact 213:'), 'the archive keeps every line');
  assert.match(archive, /## From \.orbit\/memory\/project-memory\.md/);
  assert.ok(!exists(root, '.orbit/next-session.md') && !exists(root, '.orbit/memory'), 'moved files and emptied folders are gone');
  assert.ok(exists(root, '.orbit/cloud-keys.env'), 'the secret stays where it is');
  assert.match(out, /refused: trash \.orbit\/cloud-keys\.env \(a secret file is never opened or moved\)/);
  assert.match(out, /refused: move \.orbit\/config\.yml → \.keel\/config\.json/);
  assert.match(out, /refused: move README\.md → \.\.\/outside\.md/);
  assert.match(out, /possible secrets in moved text \(values not shown\): \.keel\/sessions\/2026-09-03-003\.md:2 \(password or key assignment\)/);
  assert.ok(!out.includes('hunter2') && !out.includes(CANARY), 'values never appear');
  const batches = fs.readdirSync(path.join(root, '.keel/local/trash'));
  assert.equal(batches.length, 1, 'one trash batch per run');
  const manifest = JSON.parse(readRel(root, `.keel/local/trash/${batches[0]}/manifest.json`));
  assert.deepEqual(manifest.items.map((i) => i.path).sort(), ['.orbit/memory/project-memory.md', '.orbit/next-session.md']);
  assert.deepEqual(snapshot(root), before, 'files outside .keel/ and the old folder are unchanged: product names untouched');

  // A second run continues instead of repeating.
  const again = run('migrate.js', root, ['apply', plan]);
  assert.match(again, /0 done, 4 already done/);
  assert.equal(fs.readdirSync(path.join(root, '.keel/sessions')).length, 3, 'nothing duplicated');
  assert.match(run('migrate.js', root, ['state']), /actions done: 4 of 7/);
  assert.match(run('migrate.js', root, ['find']), /earlier move: from \.orbit \(not finished\); 4 actions done of 7/);

  // A fixed plan finishes the move.
  const fixed = writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/sessions', to: '.keel/sessions' }, { op: 'move', from: '.orbit/config.yml', to: '.keel/local/archive/.orbit/config.yml' }] });
  assert.match(run('migrate.js', root, ['apply', fixed]), /^migrate: ok; 1 done, 1 already done, 0 refused/);
  assert.ok(exists(root, '.keel/local/archive/.orbit/config.yml'));
  assert.match(run('migrate.js', root, ['state']), /\.orbit \(finished/);
});

test('migrate apply: a run again after a failed trash step does not append the text twice', () => {
  const { root } = makeOldSystem();
  const plan = writePlan(root, { source: '.orbit', actions: [{ op: 'append', from: '.orbit/memory/project-memory.md', to: '.keel/memory/project-memory-archive.md' }] });
  // A file where the trash folder goes: the trash step fails after the text was appended.
  fs.writeFileSync(path.join(root, '.keel/local/trash'), '');
  assert.match(run('migrate.js', root, ['apply', plan]), /^migrate: stopped; 0 done, 0 already done, 1 refused or failed/);
  assert.ok(exists(root, '.orbit/memory/project-memory.md'), 'the original stays where it is');
  fs.rmSync(path.join(root, '.keel/local/trash'));
  assert.match(run('migrate.js', root, ['apply', plan]), /^migrate: ok; 1 done/);
  const archive = readRel(root, '.keel/memory/project-memory-archive.md');
  assert.equal(archive.match(/^## From \.orbit\/memory\/project-memory\.md/gm).length, 1);
  assert.ok(!exists(root, '.orbit/memory/project-memory.md'));
});

test('migrate state: repeats the secrets warning of the moved text, also when apply ran elsewhere', () => {
  const { root } = makeOldSystem();
  const plan = writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/sessions', to: '.keel/sessions' }] });
  const warning = run('migrate.js', root, ['apply', plan]).split('\n').find((l) => l.startsWith('possible secrets in moved text'));
  assert.match(warning, /\.keel\/sessions\/2026-09-03-003\.md:2 \(password or key assignment\)/);
  assert.ok(run('migrate.js', root, ['state']).split('\n').includes(warning));

  const other = makeOldSystem().root;
  const cleanPlan = writePlan(other, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/memory/archive.md', to: '.keel/memory/project-memory-archive.md' }] });
  assert.match(run('migrate.js', other, ['apply', cleanPlan]), /secrets in moved text: none found/);
  assert.doesNotMatch(run('migrate.js', other, ['state']), /secrets/);
});

test('migrate apply: a file an earlier action took counts as done; targets only in keel\'s places', () => {
  const { root } = makeOldSystem();
  const plan = writePlan(root, { source: '.orbit', actions: [
    { op: 'append', from: '.orbit/memory/project-memory.md', to: '.keel/memory/project-memory-archive.md' },
    { op: 'trash', from: '.orbit/memory/project-memory.md' },
    { op: 'move', from: '.orbit/sessions', to: '.keel/sessions' },
    { op: 'trash', from: '.orbit/sessions/2026-09-01-001.md' },
  ] });
  const out = run('migrate.js', root, ['apply', plan]);
  assert.match(out, /^migrate: ok; 2 done, 2 already done, 0 refused/);
  assert.match(out, /already done: trash \.orbit\/memory\/project-memory\.md \(an earlier action took it\)/);
  assert.match(run('migrate.js', root, ['state']), /\.orbit \(finished[\s\S]*actions done: 4 of 4/);
  const bad =writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/notes', to: '.keel/notes' }, { op: 'move', from: '.orbit/adr', to: '.keel/local/tmp/adr' }] });
  const refused = run('migrate.js', root, ['apply', bad]);
  assert.match(refused, /0 done, 0 already done, 2 refused/);
  assert.match(refused, /the target must be \.keel\/next-session\.md, \.keel\/memory\/, \.keel\/sessions\/ or \.keel\/local\/archive\//);
  assert.ok(exists(root, '.orbit/notes/idea.md') && !exists(root, '.keel/notes'));
});

test('migrate apply: an interrupted folder move continues with the files still there; taken names get -2', () => {
  const { root } = makeOldSystem();
  fs.mkdirSync(path.join(root, '.keel/sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, '.keel/sessions/2026-09-01-001.md'), 'keel log\n');
  // Simulate a crash after one file: it is already gone from the old folder.
  fs.renameSync(path.join(root, '.orbit/sessions/2026-09-02-002.md'), path.join(root, '.keel/sessions/2026-09-02-002.md'));
  const plan = writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/sessions', to: '.keel/sessions' }] });
  assert.match(run('migrate.js', root, ['apply', plan]), /done: move \.orbit\/sessions → \.keel\/sessions \(2 files\)/);
  assert.deepEqual(fs.readdirSync(path.join(root, '.keel/sessions')).sort(), ['2026-09-01-001-2.md', '2026-09-01-001.md', '2026-09-02-002.md', '2026-09-03-003.md']);
  assert.equal(readRel(root, '.keel/sessions/2026-09-01-001.md'), 'keel log\n', 'an existing keel file is never overwritten');
});

test('migrate apply: never the project itself, .git or .keel; a trashed folder with a secret is refused; a file moved to a folder keeps its name', () => {
  const { root } = makeOldSystem();
  const gitBefore = fs.existsSync(path.join(root, '.git')) ? fs.readdirSync(path.join(root, '.git')).sort() : null;
  const plan = writePlan(root, { source: '.', actions: [
    { op: 'move', from: '.', to: '.keel/local/archive/' },
    { op: 'move', from: './', to: '.keel/local/archive/x' },
    { op: 'trash', from: './.git' },
    { op: 'trash', from: '.keel' },
    { op: 'trash', from: 'x/../.git' },
    { op: 'trash', from: '.orbit' },
    { op: 'move', from: '.orbit/memory/archive.md', to: '.keel/memory/' },
  ] });
  const out = run('migrate.js', root, ['apply', plan]);
  assert.match(out, /1 done, 0 already done, 6 refused/, out);
  assert.match(out, /refused: trash \.orbit \(the folder holds secret files, which are never moved: \.orbit\/cloud-keys\.env/);
  if (gitBefore) assert.deepEqual(fs.readdirSync(path.join(root, '.git')).sort(), gitBefore, '.git untouched');
  assert.ok(exists(root, '.orbit/cloud-keys.env') && exists(root, '.orbit/sessions'), 'the refused folder stays');
  assert.ok(exists(root, '.keel/memory/archive.md'), 'moved into the folder under its own name');

  // A source restored after it was done is moved again instead of "already done".
  fs.renameSync(path.join(root, '.keel/memory/archive.md'), path.join(root, '.orbit/memory/archive.md'));
  const again = writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/memory/archive.md', to: '.keel/memory/' }] });
  assert.match(run('migrate.js', root, ['apply', again]), /^migrate: ok; 1 done, 0 already done/);
});

test('cleanup find: three groups, secrets only by path, references move an item up', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  const out = run('cleanup.js', root, ['find']);
  const list = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json'));
  const group = (g) => list.items.filter((i) => i.group === g).map((i) => i.path).sort();
  assert.deepEqual(group('safe'), ['.DS_Store', '.claude/settings.local.json.keel-backup-20260901T000000', '.keel/local/tmp/old-scan.json', 'src/orbit.js.bak']);
  assert.deepEqual(group('check'), ['.pytest_cache/', 'notes-draft.txt']);
  assert.ok(!list.items.some((i) => i.path.startsWith('.orbit') || i.path.startsWith('.claude/settings.local.json') && !i.path.includes('backup')), 'the old folder before a move and tool settings are not leftovers');
  assert.ok(!out.includes(CANARY));
  // A tracked file that mentions the draft: it moves to "do not touch".
  fs.appendFileSync(path.join(root, 'docs/setup.md'), 'Draft: notes-draft.txt\n');
  run('cleanup.js', root, ['find']);
  const again = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json'));
  const draft = again.items.find((i) => i.path === 'notes-draft.txt');
  assert.equal(draft.group, 'keep');
  assert.deepEqual(draft.refs, ['docs/setup.md:5']);
});

test('cleanup after a migration: what the old system left is listed; its secret never', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  const plan = writePlan(root, { source: '.orbit', actions: [{ op: 'move', from: '.orbit/sessions', to: '.keel/sessions' }] });
  run('migrate.js', root, ['apply', plan]);
  const out = run('cleanup.js', root, ['find']);
  const list = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json'));
  const left = list.items.filter((i) => i.source === 'old system .orbit').map((i) => i.path).sort();
  assert.deepEqual(left, ['.orbit/adr/', '.orbit/config.yml', '.orbit/fix_prices_0923.py', '.orbit/memory/', '.orbit/next-session.md', '.orbit/notes/', '.orbit/runs/']);
  assert.deepEqual(list.secrets, ['.orbit/cloud-keys.env']);
  assert.match(out, /secret files \(never moved or opened\): \.orbit\/cloud-keys\.env/);
});

test('cleanup move, gates hint, restore and the "do not touch" guard', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  run('cleanup.js', root, ['find']);
  const list = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json'));
  const n = (p) => list.items.find((i) => i.path === p).n;
  // Only keel's own temporary file and settings backup: no gates needed.
  const quiet = run('cleanup.js', root, ['move', '--items', `${n('.keel/local/tmp/old-scan.json')},${n('.claude/settings.local.json.keel-backup-20260901T000000')}`]);
  assert.match(quiet, /moved 2 items/);
  assert.match(quiet, /gates: not needed/);
  assert.ok(!exists(root, '.keel/local/tmp/old-scan.json'));
  const loud = run('cleanup.js', root, ['move', '--items', `${n('src/orbit.js.bak')},${n('.DS_Store')},${n('.keel/local/tmp/old-scan.json')}`]);
  assert.match(loud, /moved 2 items/);
  assert.match(loud, /refused: \d+ \.keel\/local\/tmp\/old-scan\.json: no longer there/);
  assert.match(loud, /gates: needed/);
  const batch = /restore: node cleanup\.js <project> restore (\S+)/.exec(loud)[1];
  assert.ok(exists(root, `.keel/local/trash/${batch}/files/src/orbit.js.bak`));
  // Restore puts the batch back but never overwrites a file that came back meanwhile.
  fs.writeFileSync(path.join(root, '.DS_Store'), 'new');
  const back = run('cleanup.js', root, ['restore', batch]);
  assert.match(back, /restored 1 items/);
  assert.match(back, /kept in the trash: \.DS_Store \(something exists at that path again\)/);
  assert.equal(readRel(root, '.DS_Store'), 'new');
  assert.ok(exists(root, 'src/orbit.js.bak'));
  // "Do not touch" moves only with --red; a secret never.
  fs.appendFileSync(path.join(root, 'docs/setup.md'), 'Draft: notes-draft.txt\n');
  run('cleanup.js', root, ['find']);
  const l2 = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json'));
  const draft = l2.items.find((i) => i.path === 'notes-draft.txt').n;
  assert.match(run('cleanup.js', root, ['move', '--items', String(draft)]), /refused: .*do not touch.*--red/);
  assert.ok(exists(root, 'notes-draft.txt'));
  assert.match(run('cleanup.js', root, ['move', '--items', String(draft), '--red', String(draft)]), /moved 1 items/);
  l2.items.push({ n: 99, path: '.orbit/cloud-keys.env', group: 'safe', kind: 'file' });
  fs.writeFileSync(path.join(root, '.keel/local/tmp/cleanup.json'), JSON.stringify(l2));
  assert.match(run('cleanup.js', root, ['move', '--items', '99']), /refused: 99 \.orbit\/cloud-keys\.env: a secret file is never moved/);
  // A folder that holds a secret file is never moved whole (emptying the trash would delete the secret).
  fs.mkdirSync(path.join(root, 'scratch'));
  fs.writeFileSync(path.join(root, 'scratch', 'todo.txt'), 'x\n');
  fs.writeFileSync(path.join(root, 'scratch', '.env'), 'K=1\n');
  l2.items.push({ n: 98, path: 'scratch/', group: 'safe', kind: 'folder' });
  fs.writeFileSync(path.join(root, '.keel/local/tmp/cleanup.json'), JSON.stringify(l2));
  const held = run('cleanup.js', root, ['move', '--items', '98']);
  assert.match(held, /^cleanup: moved nothing/);
  assert.match(held, /refused: 98 scratch\/: it holds a secret file \(scratch\/\.env\)/);
  assert.ok(exists(root, 'scratch/.env') && exists(root, 'scratch/todo.txt'));
  assert.ok(exists(root, '.orbit/cloud-keys.env'));
});

test('cleanup: a moved file from git shows as deleted and comes back with restore', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  fs.writeFileSync(path.join(root, 'old.bak'), 'tracked backup\n');
  spawnSync('git', ['-C', root, 'add', 'old.bak']);
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', 'backup']);
  run('cleanup.js', root, ['find']);
  const item = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json')).items.find((i) => i.path === 'old.bak');
  assert.equal(item.group, 'check', 'a backup in git is checked, not preselected');
  const out = run('cleanup.js', root, ['move', '--items', String(item.n)]);
  assert.match(out, /in git: old\.bak now show as deleted/);
  assert.match(spawnSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).stdout, /^ D old\.bak$/m);
  run('cleanup.js', root, ['restore']);
  assert.equal(spawnSync('git', ['-C', root, 'status', '--short', 'old.bak'], { encoding: 'utf8' }).stdout, '');
});

test('cleanup trash: listing, empty-trash by age (config or default 30 days), --batch and --all', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-trash-'));
  const trash = require('../plugins/keel/scripts/lib/trash.js');
  for (const f of ['a.bak', 'b.bak', 'c.bak']) fs.writeFileSync(path.join(root, f), 'x');
  const old = trash.moveToTrash(root, ['a.bak'], 'cleanup', {}, new Date(Date.now() - 40 * 86400000));
  const mid = trash.moveToTrash(root, ['b.bak'], 'cleanup', {}, new Date(Date.now() - 10 * 86400000));
  const fresh = trash.moveToTrash(root, ['c.bak'], 'cleanup');
  assert.match(run('cleanup.js', root, ['trash']), /3 trash batches[\s\S]*40 days old - older than 30 days/);
  assert.match(run('cleanup.js', root, ['reminder']), /below the reminder threshold/, 'old trash is left to /keel:cleanup');
  assert.match(run('cleanup.js', root, ['empty-trash']), /deleted 1 trash batches for good/);
  assert.deepEqual(trash.listBatches(root).map((b) => b.batch), [mid.batch, fresh.batch]);
  assert.match(run('cleanup.js', root, ['empty-trash', '--older-than', '5']), /deleted 1/);
  assert.match(run('cleanup.js', root, ['empty-trash', '--batch', 'nope']), /nothing deleted/);
  assert.match(run('cleanup.js', root, ['empty-trash', '--all']), /deleted 1/);
  assert.match(run('cleanup.js', root, ['trash']), /the trash is empty/);
  assert.ok(old.batch && !fs.existsSync(path.join(root, 'a.bak')));
});

test('cleanup reminder: silent below 20 safe files and 100 MB, one line above', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  assert.match(run('cleanup.js', root, ['reminder']), /below the reminder threshold/);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(root, `copy-${i}.orig`), 'x');
  assert.match(run('cleanup.js', root, ['reminder']), /^cleanup: 24 leftover files \(\d+ KB\) can go: \/keel:cleanup$/m);
});

test('cleanup without git: system files and backups by name, caches as checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-nogit-'));
  for (const [rel, text] of Object.entries({ 'Thumbs.db': 'x', 'src/app.js': '1', 'src/app.js.orig': '1', '.mypy_cache/x': '1', 'node_modules/a/x.bak': '1' })) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  if (git) fs.writeFileSync(path.join(root, '.git'), 'gitdir: /nonexistent\n'); // not a work tree
  run('cleanup.js', root, ['find']);
  const items = Object.fromEntries(JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json')).items.map((i) => [i.path, i.group]));
  assert.deepEqual(items, { 'Thumbs.db': 'safe', 'src/app.js.orig': 'check', '.mypy_cache/': 'check' });
});

test('cleanup find: a large backup or system file is a check, not a safe delete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-big-'));
  fs.writeFileSync(path.join(root, 'Thumbs.db'), Buffer.alloc(6 * 1024 * 1024));
  fs.writeFileSync(path.join(root, '.DS_Store'), 'x');
  run('cleanup.js', root, ['find']);
  const items = Object.fromEntries(JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json')).items.map((i) => [i.path, i]));
  assert.equal(items['Thumbs.db'].group, 'check');
  assert.match(items['Thumbs.db'].what, /large \(6\.0 MB\)/);
  assert.equal(items['.DS_Store'].group, 'safe');
});

test('large data folders are "do not touch" and never counted as leftovers', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root } = makeOldSystem();
  fs.appendFileSync(path.join(root, '.gitignore'), 'data/\n');
  fs.mkdirSync(path.join(root, 'data'));
  const fd = fs.openSync(path.join(root, 'data', 'big.bin'), 'w');
  fs.ftruncateSync(fd, 101 * 1024 * 1024);
  fs.closeSync(fd);
  run('cleanup.js', root, ['find']);
  const item = JSON.parse(readRel(root, '.keel/local/tmp/cleanup.json')).items.find((i) => i.path === 'data/');
  assert.equal(item.group, 'keep');
  assert.match(item.what, /large data folder \(101\.0 MB\), project data/);
  assert.match(run('cleanup.js', root, ['reminder']), /below the reminder threshold/);
  fs.rmSync(path.join(root, 'data'), { recursive: true, force: true });
});

test('migrate find: a note naming a commit whose short id is all digits still counts it', (t) => {
  if (!git) { t.skip('git is not installed'); return; }
  const { root, userSettings } = makeOldSystem();
  const g = (...a) => require('node:child_process').execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  // About 1 short id in 25 is all digits: commit until one is (the case that made this test flaky).
  let id = g('rev-parse', '--short=7', 'HEAD');
  for (let i = 0; !/^\d+$/.test(id) && i < 2000; i++) { g('commit', '-q', '--allow-empty', '-m', `n${i}`); id = g('rev-parse', '--short=7', 'HEAD'); }
  assert.match(id, /^\d+$/);
  g('commit', '-q', '--allow-empty', '-m', 'after');
  fs.writeFileSync(path.join(root, '.orbit/next-session.md'), `# Next session\n\nLast commit: ${id}\n\n## Goal\nx\n`);
  run('migrate.js', root, ['find'], { KEEL_USER_SETTINGS: userSettings });
  const note = JSON.parse(readRel(root, '.keel/local/tmp/migrate.json')).systems[0].notes[0];
  assert.deepEqual(note.commits.map((c) => [c.sha, c.behind]), [[id, 1]]);
});
