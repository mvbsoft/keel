'use strict';
// lib/planning.js and the places that leave planning's files out of a task: the commit and the
// readiness check of git-flow.js, changes.js, the work fingerprint and comments.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const SCRIPTS = path.join(__dirname, '..', 'plugins', 'keel', 'scripts');
const { planningFiles } = require(path.join(SCRIPTS, 'lib', 'planning.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  comments: { level: 'short', ticket_prefixes: ['PROJ', 'D'] },
};

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const script = (name, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, name), ...args], { encoding: 'utf8' }).stdout.trim().split('\n');

const plan = (status = 'draft') => `---\ntype: plan\nstatus: ${status}\nlanguage: en\n---\n# S3 storage\n`;
const ticket = (id, status = 'ready') => `---\nid: ${id}\ntype: ticket\nstatus: ${status}\ndepends_on:\n---\n# [${id}] Upload\n`;

// A repository on a task branch with code and two feature folders, all committed.
function project() {
  const dir = tempDir('keel-planning-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG));
  write(dir, '.keel/.gitignore', 'local/\n');
  write(dir, 'src/app.js', 'one\ntwo\n');
  write(dir, 'tickets/s3-storage/plan.md', plan('in-progress'));
  write(dir, 'tickets/s3-storage/tickets/T1-upload.md', ticket('T1', 'in-progress'));
  write(dir, 'tickets/s3-storage/tickets/T2-download.md', ticket('T2'));
  write(dir, 'tickets/billing/plan.md', plan());
  write(dir, 'tickets/billing/tickets/T1-invoice.md', '---\nid: T1\n---\n# Invoice\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'switch', '-q', '-c', 's3-storage-T1');
  return dir;
}

gitTest('planning files are told by their feature folder; a stray plan.md or type does not hide project files', () => {
  const dir = project();
  write(dir, 'plan.md', plan());
  write(dir, 'docs/old/plan.md', '---\ntype: plan\nstatus: someday\n---\n');
  write(dir, 'docs/old/notes.md', 'x\n');
  write(dir, 'docs/no-folder.md', ticket('T9'));
  write(dir, 'docs/bom/plan.md', `\ufeff${plan('ready')}`);
  const check = planningFiles(dir);
  assert.deepEqual(check('tickets/billing/plan.md'), { feature: 'billing', ticket: null, plan: true });
  assert.deepEqual(check('tickets/billing/tickets/T1-invoice.md'), { feature: 'billing', ticket: 'T1', plan: false });
  assert.deepEqual(check('tickets/billing/reviews/T1.md'), { feature: 'billing', ticket: null, plan: false }, 'a new file in a feature folder');
  assert.deepEqual(check('docs/bom/x.png'), { feature: 'bom', ticket: null, plan: false }, 'a plan.md with a BOM still marks its folder');
  assert.deepEqual(check('tickets/s3-storage/tickets/T2-download.md'), { feature: 's3-storage', ticket: 'T2', plan: false });
  for (const rel of ['src/app.js', 'README.md', 'docs/old/notes.md', 'docs/no-folder.md', 'missing/file.md']) assert.equal(check(rel), null, rel);
});

test('ticketRef reads <feature>/T<n> without case and nothing else', () => {
  const { ticketRef } = require(path.join(SCRIPTS, 'lib', 'planning.js'));
  assert.deepEqual(ticketRef('Event-History/t5'), { feature: 'event-history', ticket: 'T5' });
  for (const v of ['PROJ-101', 'event-history', 'event-history/T', '/T5', 'a/b/T5', undefined]) assert.equal(ticketRef(v), null, String(v));
});

gitTest('commit: planning files stay out, the tickets --tickets names and their plan.md go in with the code; they never block a step', () => {
  const dir = project();
  write(dir, 'src/app.js', 'one\ntwo\nthree\n');
  write(dir, 'tickets/s3-storage/plan.md', `${plan('in-progress')}\nMore.\n`);
  write(dir, 'tickets/s3-storage/tickets/T1-upload.md', ticket('T1', 'done'));
  write(dir, 'tickets/s3-storage/tickets/T2-download.md', ticket('T2', 'done'));
  write(dir, 'tickets/billing/plan.md', `${plan()}\nMore.\n`);
  write(dir, 'tickets/billing/tickets/T2-refund.md', '---\nid: T2\n---\n');
  git(dir, 'add', 'tickets/billing/tickets/T2-refund.md');
  write(dir, '.keel/local/tmp/msg.txt', 'feat: add upload\n');
  const out = script('git-flow.js', dir, 'commit', '--message-file', path.join(dir, '.keel/local/tmp/msg.txt'), '--tickets', 's3-storage/T1', '--finish', 's3-storage-T1', '--session', 's1');
  assert.equal(out[0], 'git-flow: ok', out.join('\n'));
  assert.ok(out.includes('not committed (planning files): tickets/billing/plan.md, tickets/billing/tickets/T2-refund.md, tickets/s3-storage/tickets/T2-download.md'), out.join('\n'));
  const committed = git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();
  assert.deepEqual(committed, ['src/app.js', 'tickets/s3-storage/plan.md', 'tickets/s3-storage/tickets/T1-upload.md']);
  assert.equal(git(dir, 'diff', '--cached', '--name-only'), '', 'a planning file staged by hand is taken out of the index');
  // The uncommitted planning files do not stop a step that needs a clean tree.
  const sw = script('git-flow.js', dir, 'switch', '--name', 'main');
  assert.equal(sw[0], 'git-flow: ok', sw.join('\n'));
  // Without --tickets no ticket goes in.
  git(dir, 'switch', '-q', 's3-storage-T1');
  write(dir, 'src/app.js', 'one\n');
  const plain = script('git-flow.js', dir, 'commit', '--message-file', path.join(dir, '.keel/local/tmp/msg.txt'));
  assert.equal(plain[0], 'git-flow: ok', plain.join('\n'));
  assert.equal(git(dir, 'show', '--name-only', '--format=', 'HEAD'), 'src/app.js');
});

gitTest('a commit of only planning files is "nothing to commit"', () => {
  const dir = project();
  write(dir, 'tickets/billing/plan.md', `${plan()}\nMore.\n`);
  write(dir, '.keel/local/tmp/msg.txt', 'chore: x\n');
  const out = script('git-flow.js', dir, 'commit', '--message-file', path.join(dir, '.keel/local/tmp/msg.txt'));
  assert.equal(out[1], 'commit: nothing to commit', out.join('\n'));
  assert.ok(out.includes('not committed (planning files): tickets/billing/plan.md'), out.join('\n'));
});

gitTest('verification and comments look at the code only; a ticket marked done after the verification keeps it verified', () => {
  const dir = project();
  write(dir, 'src/app.js', 'one\ntwo\nthree\n');
  write(dir, 'tickets/billing/tickets/T2-refund.md', '---\nid: T2\n---\nSee PROJ-7.\n');
  write(dir, 'tickets/s3-storage/tickets/T2-download.md', `${ticket('T2')}\nDepends on PROJ-7 per D-3.\n`);
  const changes = script('changes.js', dir).join('\n');
  assert.match(changes, /^changes: 1 files, \+1 -0/m);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.keel/local/tmp/changes.diff'), 'utf8'), /tickets\//);
  const comments = require(path.join(SCRIPTS, 'comments.js'));
  const notes = comments.run(dir, {}).notes.filter((n) => n.kind === 'ref');
  assert.deepEqual(notes, [], 'ids in planning files are their subject');

  script('fingerprint.js', dir, 'save', '--tier', 'basic');
  const { unverified } = require(path.join(SCRIPTS, 'fingerprint.js'));
  assert.equal(unverified(dir), null);
  write(dir, 'tickets/s3-storage/tickets/T1-upload.md', ticket('T1', 'done'));
  assert.equal(unverified(dir), null, 'done is written after the verification');
  write(dir, 'src/app.js', 'one\n');
  assert.match(unverified(dir), /^the work changed after the verification/);
});
