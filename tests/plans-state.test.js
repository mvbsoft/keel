'use strict';
// plans.js tickets, done and drop on throwaway projects: a bare repository plays the server, a second
// clone plays a colleague. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');

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
};

const LOCAL = '.keel/local/plans/keel';
const OLD_DATE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
const OLD = { GIT_COMMITTER_DATE: OLD_DATE, GIT_AUTHOR_DATE: OLD_DATE };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const line = (out, key) => out.find((l) => l.startsWith(`  ${key} `)) || '';

// An exported ticket's text.
function ticket(key, { status = 'todo', feature = 's3-storage', branch = feature, mergeInto = 'main', depends = [] } = {}) {
  return `---\ntype: ticket\nkey: ${key}\nstatus: ${status}\nfeature: ${feature}\nbranch: ${branch}\nmerge_into: ${mergeInto}\ndepends_on: [${depends.join(', ')}]\n---\n\n# [${key}] Ticket ${key}\n\n## Goal\nDo it.\n`;
}

// The files and a commit; `env` sets its dates.
function commit(dir, message, files = {}, env = {}) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', message], { env: { ...process.env, ...env }, stdio: 'ignore' });
}

// A project with keel's config and one commit on main; when asked, a remote with main pushed. `sub`: the
// project is that sub-folder of the repository (`work` is the project).
function setup({ remote = true, sub = '' } = {}) {
  const tmp = tempDir('keel-state-');
  const repo = path.join(tmp, 'work');
  const work = path.join(repo, sub);
  fs.mkdirSync(work, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG));
  write(work, '.keel/.gitignore', 'local/\n');
  commit(work, 'init', { 'src/app.js': 'module.exports = 1;\n' });
  let server = null;
  if (remote) {
    server = path.join(tmp, 'server.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', server]);
    git(work, 'remote', 'add', 'origin', server);
    git(work, 'push', '-q', '-u', 'origin', 'main');
  }
  return { tmp, work, server };
}

// A colleague's clone that pushes a branch with one file.
function otherPush(server, tmp, branch, rel, text) {
  const other = path.join(tmp, `other-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'checkout', '-q', '-b', branch);
  commit(other, 'more work', { [rel]: text });
  git(other, 'push', '-q', 'origin', branch);
}

const F = 'tickets/s3-storage';
const file = (n, folder = F) => `${folder}/PROJ-${n}-t${n}.md`;

gitTest('tickets: every state of the queue with its hint, and the next ticket', () => {
  const { work } = setup();
  git(work, 'checkout', '-q', '-b', 's3-storage');
  const all = {};
  for (let n = 1; n <= 9; n++) all[file(n)] = ticket(`PROJ-${n}`, { depends: n === 8 ? ['PROJ-3'] : n === 9 ? ['PROJ-2'] : [] });
  commit(work, 'Add the s3-storage tickets', all);
  // PROJ-1 done on the feature branch, which is merged and pushed: done on origin/main.
  commit(work, 'PROJ-1: client', { 'src/client.js': '1\n', [file(1)]: ticket('PROJ-1', { status: 'done' }) });
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge s3-storage', 's3-storage');
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', 's3-storage');
  // PROJ-2 done on the feature branch; PROJ-3 done on a ticket branch.
  commit(work, 'PROJ-2: upload', { 'src/upload.js': '1\n', [file(2)]: ticket('PROJ-2', { status: 'done', depends: [] }) });
  git(work, 'push', '-q', '-u', 'origin', 's3-storage');
  git(work, 'checkout', '-q', '-b', 'PROJ-3-dl');
  commit(work, 'PROJ-3: download', { 'src/dl.js': '1\n', [file(3)]: ticket('PROJ-3', { status: 'done' }) });
  // PROJ-4: a commit with the key on a branch named otherwise; PROJ-5: an old branch named with the key.
  git(work, 'checkout', '-q', '-b', 'work-x', 's3-storage');
  commit(work, 'PROJ-4: parser', { 'src/parser.js': '1\n' });
  git(work, 'checkout', '-q', '-b', 'PROJ-5-old', 'main');
  commit(work, 'old work', { 'src/old.js': '1\n' }, OLD);
  git(work, 'checkout', '-q', 's3-storage');
  // PROJ-6: an unfinished keel task; PROJ-7: the session note's keys.
  write(work, '.keel/tasks/PROJ-6/task.md', '---\nid: PROJ-6\ntitle: t\nstatus: active\nupdated: 2026-10-26\n---\n');
  write(work, '.keel/next-session.md', '---\nstatus: in-progress\nkeys: PROJ-7\n---\n');

  const out = run(work, 'tickets');
  assert.equal(out[0], 'tickets: 1 feature, 9 tickets; never fetched');
  assert.equal(out[1], 's3-storage (1 of 9 done, 2 waiting for merge)');
  assert.equal(line(out, 'PROJ-1'), '  PROJ-1 Ticket PROJ-1 — done');
  assert.equal(line(out, 'PROJ-2'), '  PROJ-2 Ticket PROJ-2 — waiting for the feature merge · branch s3-storage, Test, today');
  assert.equal(line(out, 'PROJ-3'), '  PROJ-3 Ticket PROJ-3 — waiting for merge into the feature branch · branch PROJ-3-dl, Test, today');
  assert.equal(line(out, 'PROJ-4'), '  PROJ-4 Ticket PROJ-4 — in progress · branch work-x, Test, today');
  assert.equal(line(out, 'PROJ-5'), '  PROJ-5 Ticket PROJ-5 — in progress · branch PROJ-5-old, Test, 40 days ago · stale');
  assert.equal(line(out, 'PROJ-6'), '  PROJ-6 Ticket PROJ-6 — in progress · keel task');
  assert.equal(line(out, 'PROJ-7'), '  PROJ-7 Ticket PROJ-7 — in progress · session (.keel/next-session.md)');
  // PROJ-8 waits for PROJ-3 (on a ticket branch only); PROJ-9's PROJ-2 is on the feature branch.
  assert.equal(line(out, 'PROJ-8'), '  PROJ-8 Ticket PROJ-8 — to do');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — next');
  assert.equal(out[out.length - 1], 'next: PROJ-9 (s3-storage)');

  // The feature view names its branch; the key view its file and dependencies, in any case.
  const one = run(work, 'tickets', 's3-storage');
  assert.deepEqual(one.slice(0, 3), ['tickets: 1 feature, 9 tickets; never fetched', 's3-storage (1 of 9 done, 2 waiting for merge)', '  branch: s3-storage -> main']);
  assert.deepEqual(run(work, 'tickets', 'proj-8'), [
    'tickets: 1 feature, 1 ticket; never fetched',
    's3-storage (1 of 9 done, 2 waiting for merge)',
    '  branch: s3-storage -> main',
    '  PROJ-8 Ticket PROJ-8 — to do',
    `  file: ${file(8)}`,
    '  depends: PROJ-3 waiting for merge into the feature branch',
    'next: PROJ-9 (s3-storage)',
  ]);
  assert.deepEqual(run(work, 'tickets', 'no-such-feature'), ['tickets: none (no ticket or feature no-such-feature)']);
  assert.deepEqual(run(work, 'tickets', 'PROJ-99'), ['tickets: none (no ticket or feature PROJ-99)']);
});

gitTest('tickets: none in a project without tickets; a draft\'s T-files are not tickets', () => {
  const { work } = setup({ remote: false });
  write(work, `${LOCAL}/csv-export/tickets/T1-a.md`, '---\nid: T1\ndepends_on: []\n---\n# [T1] A\n');
  write(work, 'docs/RFC-12-design.md', '# not a ticket\n');
  assert.deepEqual(run(work, 'tickets'), ['tickets: none']);
});

gitTest('tickets: the export commit (keys only in the ticket folder) is not work on a ticket', () => {
  const { work } = setup();
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'PROJ-20, PROJ-21: add the csv-export tickets', { [file(20, 'tickets/csv-export')]: ticket('PROJ-20', { feature: 'csv-export' }), [file(21, 'tickets/csv-export')]: ticket('PROJ-21', { feature: 'csv-export' }) });
  commit(work, 'PROJ-21: start', { 'src/csv.js': '1\n' });
  const out = run(work, 'tickets');
  assert.equal(line(out, 'PROJ-20'), '  PROJ-20 Ticket PROJ-20 — next');
  assert.equal(line(out, 'PROJ-21'), '  PROJ-21 Ticket PROJ-21 — in progress · branch csv-export, Test, today');
});

gitTest('tickets: commits with the key on merge_into after the folder came there, status not written, are work in progress', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  commit(work, 'PROJ-61: an earlier fix', { 'src/early.js': '1\n' }, OLD);
  commit(work, 'Add the csv-export tickets', { [file(60, T)]: ticket('PROJ-60', { feature: 'csv-export' }), [file(61, T)]: ticket('PROJ-61', { feature: 'csv-export' }) });
  commit(work, 'proj-60: fixed by hand', { 'src/fix.js': '1\n' });
  git(work, 'push', '-q', 'origin', 'main');
  const out = run(work, 'tickets');
  assert.equal(line(out, 'PROJ-60'), '  PROJ-60 Ticket PROJ-60 — in progress · commits with the key on main, status not written');
  assert.equal(line(out, 'PROJ-61'), '  PROJ-61 Ticket PROJ-61 — next', 'a commit from before the folder came does not count');
});

gitTest('tickets: a squash merge is done; a merged branch whose folder was removed since is done', () => {
  const { work } = setup();
  git(work, 'checkout', '-q', '-b', 'pdf-report');
  commit(work, 'Add the pdf-report tickets', { [file(30, 'tickets/pdf-report')]: ticket('PROJ-30', { feature: 'pdf-report' }) });
  commit(work, 'PROJ-30: report', { 'src/pdf.js': '1\n', [file(30, 'tickets/pdf-report')]: ticket('PROJ-30', { feature: 'pdf-report', status: 'done' }) });
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--squash', 'pdf-report');
  git(work, 'commit', '-q', '-m', 'PROJ-30: pdf report');
  git(work, 'checkout', '-q', '-b', 'doc-export');
  commit(work, 'Add the doc-export tickets', { [file(31, 'tickets/doc-export')]: ticket('PROJ-31', { feature: 'doc-export' }) });
  commit(work, 'PROJ-31: export', { 'src/doc.js': '1\n', [file(31, 'tickets/doc-export')]: ticket('PROJ-31', { feature: 'doc-export', status: 'done' }) });
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge doc-export', 'doc-export');
  git(work, 'rm', '-r', '-q', 'tickets/doc-export');
  git(work, 'commit', '-q', '-m', 'Remove the doc-export tickets');
  git(work, 'push', '-q', 'origin', 'main');

  assert.deepEqual(run(work, 'tickets'), ['tickets: 0 features, 0 tickets; never fetched', 'next: none'], 'features whose tickets are all done are not listed');
  assert.deepEqual(run(work, 'tickets', 'pdf-report').slice(1), ['pdf-report (1 of 1 done)', '  branch: pdf-report -> main', '  PROJ-30 Ticket PROJ-30 — done', 'next: none']);
  const removed = run(work, 'tickets', 'PROJ-31');
  assert.equal(line(removed, 'PROJ-31'), '  PROJ-31 Ticket PROJ-31 — done');
  assert.ok(removed.includes(`  file: doc-export:${file(31, 'tickets/doc-export')}`), removed.join('\n'));
});

gitTest('tickets: a branch merged and reverted on merge_into is marked reverted', () => {
  const { work } = setup();
  const T = 'tickets/csv-import';
  commit(work, 'Add the csv-import tickets', { [file(50, T)]: ticket('PROJ-50', { feature: 'csv-import' }) });
  git(work, 'checkout', '-q', '-b', 'csv-import');
  commit(work, 'PROJ-50: import', { 'src/import.js': '1\n', [file(50, T)]: ticket('PROJ-50', { feature: 'csv-import', status: 'done' }) });
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge csv-import', 'csv-import');
  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(line(run(work, 'tickets', 'PROJ-50'), 'PROJ-50'), '  PROJ-50 Ticket PROJ-50 — done');
  git(work, 'revert', '-m', '1', '--no-edit', 'HEAD');
  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(line(run(work, 'tickets'), 'PROJ-50'), '  PROJ-50 Ticket PROJ-50 — waiting for the feature merge · branch csv-import, Test, today · reverted');
});

gitTest('tickets: a revert of the merge that brought the ticket folder to merge_into is not done', () => {
  const { work } = setup();
  const T = 'tickets/csv-import';
  git(work, 'checkout', '-q', '-b', 'csv-import');
  commit(work, 'Add the csv-import tickets', { [file(51, T)]: ticket('PROJ-51', { feature: 'csv-import' }) });
  commit(work, 'PROJ-51: import', { 'src/import.js': '1\n', [file(51, T)]: ticket('PROJ-51', { feature: 'csv-import', status: 'done' }) });
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge csv-import', 'csv-import');
  git(work, 'revert', '-m', '1', '--no-edit', 'HEAD');
  git(work, 'push', '-q', 'origin', 'main');
  assert.equal(line(run(work, 'tickets'), 'PROJ-51'), '  PROJ-51 Ticket PROJ-51 — waiting for the feature merge · branch csv-import, Test, today · reverted');
});

gitTest('tickets: a ticket branch merged into a feature branch whose tickets were dropped waits for the feature merge', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'Add the csv-export tickets', { [file(52, T)]: ticket('PROJ-52', { feature: 'csv-export' }) });
  git(work, 'checkout', '-q', '-b', 'PROJ-52-x');
  commit(work, 'PROJ-52: export', { 'src/x.js': '1\n', [file(52, T)]: ticket('PROJ-52', { feature: 'csv-export', status: 'done' }) });
  git(work, 'checkout', '-q', 'csv-export');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge PROJ-52-x', 'PROJ-52-x');
  git(work, 'rm', '-r', '-q', T);
  git(work, 'commit', '-q', '-m', 'Remove the csv-export tickets');
  git(work, 'checkout', '-q', 'main');
  assert.equal(line(run(work, 'tickets'), 'PROJ-52'), '  PROJ-52 Ticket PROJ-52 — waiting for the feature merge · branch PROJ-52-x, Test, today');
});

gitTest('tickets: work done by hand on merge_into before the feature merges is in progress', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'Add the csv-export tickets', { [file(53, T)]: ticket('PROJ-53', { feature: 'csv-export' }), [file(54, T)]: ticket('PROJ-54', { feature: 'csv-export' }) });
  git(work, 'checkout', '-q', 'main');
  commit(work, 'PROJ-53: fixed on main', { 'src/fix.js': '1\n' });
  git(work, 'push', '-q', 'origin', 'main');
  const out = run(work, 'tickets');
  assert.equal(line(out, 'PROJ-53'), '  PROJ-53 Ticket PROJ-53 — in progress · commits with the key on main, status not written');
  assert.equal(line(out, 'PROJ-54'), '  PROJ-54 Ticket PROJ-54 — next');
});

gitTest('tickets: a done written in the working tree and not committed is not merged', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  git(work, 'checkout', '-q', '-b', 'csv-export');
  write(work, file(55, T), ticket('PROJ-55', { feature: 'csv-export', status: 'done' }));
  assert.equal(line(run(work, 'tickets'), 'PROJ-55'), '  PROJ-55 Ticket PROJ-55 — waiting for the feature merge · branch csv-export, Test, today');
});

gitTest('tickets: a done taken back with done --undo no longer counts, committed or not', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'Add the csv-export tickets', { [file(61, T)]: ticket('PROJ-61', { feature: 'csv-export' }) });
  commit(work, 'Mark the ticket done', { [file(61, T)]: ticket('PROJ-61', { feature: 'csv-export', status: 'done' }) });
  git(work, 'push', '-q', '-u', 'origin', 'csv-export');
  assert.equal(line(run(work, 'tickets'), 'PROJ-61'), '  PROJ-61 Ticket PROJ-61 — waiting for the feature merge · branch csv-export, Test, today');
  assert.deepEqual(run(work, 'done', 'PROJ-61', '--undo'), [`done: PROJ-61 -> todo (${file(61, T)})`]);
  assert.equal(line(run(work, 'tickets'), 'PROJ-61'), '  PROJ-61 Ticket PROJ-61 — next', 'undone in the working tree');
  commit(work, 'Mark the ticket todo again');
  assert.equal(line(run(work, 'tickets'), 'PROJ-61'), '  PROJ-61 Ticket PROJ-61 — next', 'undone in a local commit');
});

gitTest('tickets: a done only in the working tree of a branch already merged is not marked reverted', () => {
  const { work } = setup();
  const T = 'tickets/csv-export';
  commit(work, 'Add the csv-export tickets', { [file(62, T)]: ticket('PROJ-62', { feature: 'csv-export' }) });
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 'csv-export');
  write(work, file(62, T), ticket('PROJ-62', { feature: 'csv-export', status: 'done' }));
  assert.equal(line(run(work, 'tickets'), 'PROJ-62'), '  PROJ-62 Ticket PROJ-62 — waiting for the feature merge · branch csv-export, Test, today');
});

// main has auth-flow's PROJ-9, which depends on PROJ-1 of s3-storage; s3-storage's tickets (`folder`,
// PROJ-1's file `name`) leave in `finish` (a removal, or a revert) and the branch is deleted, so no branch
// has PROJ-1's file. `dependents`: other tickets to add on main first.
function droppedDependency(status, finish, { folder = F, name = 'PROJ-1-t1.md', sub = '', dependents = {} } = {}) {
  const { work } = setup({ sub });
  commit(work, 'Add the auth-flow tickets', { [file(9, 'tickets/auth-flow')]: ticket('PROJ-9', { feature: 'auth-flow', depends: ['PROJ-1'] }), ...dependents });
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'checkout', '-q', '-b', 's3-storage');
  commit(work, 'Add the s3-storage tickets', { [`${folder}/${name}`]: ticket('PROJ-1') });
  commit(work, 'PROJ-1: client', { 'src/client.js': '1\n', [`${folder}/${name}`]: ticket('PROJ-1', { status }) });
  finish(work, folder);
  git(work, 'branch', '-q', '-D', 's3-storage');
  git(work, 'push', '-q', 'origin', 'main');
  return work;
}
const dropThenMerge = (work, folder) => {
  git(work, 'rm', '-r', '-q', folder);
  git(work, 'commit', '-q', '-m', 'Remove the s3-storage tickets');
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', '--no-ff', '-m', 'Merge s3-storage', 's3-storage');
};

gitTest('tickets: a dependency dropped and merged counts as done when its last version said done', () => {
  const work = droppedDependency('done', dropThenMerge);
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — next');
  assert.ok(out.includes('  depends: PROJ-1 done'), out.join('\n'));
});

gitTest('tickets: a dependency deleted while its last version said todo is not found', () => {
  const work = droppedDependency('todo', dropThenMerge);
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — to do');
  assert.ok(out.includes('  depends: PROJ-1 not found'), out.join('\n'));
});

gitTest('tickets: a dependency that left merge_into with a revert of its merge is not done', () => {
  const work = droppedDependency('done', (w, folder) => {
    // An older deletion whose last version says done: only the merge revert keeps the key from it.
    const done = readRel(w, `${folder}/PROJ-1-t1.md`);
    git(w, 'rm', '-q', `${folder}/PROJ-1-t1.md`);
    git(w, 'commit', '-q', '-m', 'Remove PROJ-1 for a moment');
    commit(w, 'Bring PROJ-1 back', { [`${folder}/PROJ-1-t1.md`]: done });
    git(w, 'checkout', '-q', 'main');
    git(w, 'merge', '-q', '--no-ff', '-m', 'Merge s3-storage', 's3-storage');
    git(w, 'revert', '-m', '1', '--no-edit', 'HEAD');
  });
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — to do');
  assert.ok(out.includes('  depends: PROJ-1 not found'), out.join('\n'));
});

gitTest('tickets: a dropped dependency is found in history under a folder or name with non-ASCII letters', () => {
  const work = droppedDependency('done', dropThenMerge, { folder: 'плани/s3-storage', name: 'PROJ-1-завантаження.md' });
  assert.ok(run(work, 'tickets', 'PROJ-9').includes('  depends: PROJ-1 done'));
});

gitTest('tickets: a dropped dependency is found in history from a project in a sub-folder', () => {
  const work = droppedDependency('done', dropThenMerge, { sub: 'app' });
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — next');
  assert.ok(out.includes('  depends: PROJ-1 done'), out.join('\n'));
});

gitTest('tickets: a ticket kept on this machine sees a dropped dependency in history', () => {
  const work = droppedDependency('done', dropThenMerge);
  write(work, `${LOCAL}/pdf-report/tickets/PROJ-20-a.md`, ticket('PROJ-20', { feature: 'pdf-report', depends: ['PROJ-1'] }));
  const out = run(work, 'tickets', 'PROJ-20');
  assert.equal(line(out, 'PROJ-20'), '  PROJ-20 Ticket PROJ-20 — next');
  assert.ok(out.includes('  depends: PROJ-1 done'), out.join('\n'));
});

gitTest('tickets: a dependency found done in history counts only for dependents with that merge_into', () => {
  const work = droppedDependency('done', (w, folder) => {
    git(w, 'branch', '-q', 'release-1', 'main');
    git(w, 'push', '-q', 'origin', 'release-1');
    dropThenMerge(w, folder);
  }, { dependents: { [file(30, 'tickets/rel-fixes')]: ticket('PROJ-30', { feature: 'rel-fixes', mergeInto: 'release-1', depends: ['PROJ-1'] }) } });
  assert.ok(run(work, 'tickets', 'PROJ-9').includes('  depends: PROJ-1 done'));
  const out = run(work, 'tickets', 'PROJ-30');
  assert.equal(line(out, 'PROJ-30'), '  PROJ-30 Ticket PROJ-30 — to do');
  assert.ok(out.includes('  depends: PROJ-1 not found'), out.join('\n'));
});

gitTest('tickets: a revert of a commit that is not a merge is passed over for the older deletion', () => {
  const work = droppedDependency('done', (w, folder) => {
    dropThenMerge(w, folder);
    // Restored as todo: read as an ordinary deletion, this revert would make the key not done.
    commit(w, 'Restore old notes', { [`${folder}/PROJ-1-t1.md`]: ticket('PROJ-1') });
    git(w, 'revert', '--no-edit', 'HEAD');
  });
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — next');
  assert.ok(out.includes('  depends: PROJ-1 done'), out.join('\n'));
});

gitTest('tickets: tickets dropped, merged, then the merge reverted on merge_into are not done', () => {
  const revert = (w, folder) => {
    // A ticket branch left at the done commit: the ticket is read from it.
    git(w, 'branch', '-q', 'PROJ-1-client');
    dropThenMerge(w, folder);
    git(w, 'revert', '-m', '1', '--no-edit', 'HEAD');
  };
  const work = droppedDependency('done', revert);
  assert.equal(line(run(work, 'tickets', 'PROJ-1'), 'PROJ-1'), '  PROJ-1 Ticket PROJ-1 — waiting for the feature merge · branch PROJ-1-client, Test, today · reverted');
  assert.equal(line(run(work, 'tickets', 'PROJ-9'), 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — to do');
  git(work, 'branch', '-q', '-D', 'PROJ-1-client');
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — to do', 'found in history only');
  assert.ok(out.includes('  depends: PROJ-1 not found'), out.join('\n'));
});

gitTest('tickets: a deleted file that is not the ticket does not hide the ticket\'s drop', () => {
  const work = droppedDependency('done', (w, folder) => {
    dropThenMerge(w, folder);
    commit(w, 'notes', { 'docs/notes/PROJ-1-design.md': '# PROJ-1 design\n' });
    git(w, 'rm', '-q', 'docs/notes/PROJ-1-design.md');
    git(w, 'commit', '-q', '-m', 'Remove old notes');
  });
  assert.ok(run(work, 'tickets', 'PROJ-9').includes('  depends: PROJ-1 done'));
});

gitTest('tickets: a dropped dependency with a key commit on merge_into\'s own line is in progress', () => {
  const work = droppedDependency('todo', (w, folder) => {
    git(w, 'rm', '-r', '-q', folder);
    git(w, 'commit', '-q', '-m', 'Remove the s3-storage tickets');
    git(w, 'checkout', '-q', 'main');
    git(w, 'merge', '-q', '--squash', 's3-storage');
    git(w, 'commit', '-q', '-m', 'PROJ-1: S3 storage (#4)');
  });
  const out = run(work, 'tickets', 'PROJ-9');
  assert.equal(line(out, 'PROJ-9'), '  PROJ-9 Ticket PROJ-9 — to do');
  assert.ok(out.includes('  depends: PROJ-1 in progress'), out.join('\n'));
});

gitTest('tickets: a commit with the key that changes only .keel/ is no work, also in a sub-folder project', () => {
  const { work } = setup({ sub: 'app' });
  git(work, 'checkout', '-q', '-b', 's3-storage');
  commit(work, 'Add the s3-storage tickets', { [file(1)]: ticket('PROJ-1') });
  commit(work, 'PROJ-1: hand off', { '.keel/tasks/PROJ-1/task.md': '---\nid: PROJ-1\n---\n' });
  git(work, 'rm', '-r', '-q', '.keel/tasks');
  git(work, 'commit', '-q', '-m', 'Remove the notes of a dropped task');
  assert.equal(line(run(work, 'tickets'), 'PROJ-1'), '  PROJ-1 Ticket PROJ-1 — next');
});

gitTest('tickets: a project in a sub-folder of its repository reads the branches too', () => {
  const tmp = tempDir('keel-state-');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  const work = path.join(repo, 'app');
  write(work, '.keel/config.json', JSON.stringify(CONFIG));
  write(work, '.keel/.gitignore', 'local/\n');
  commit(repo, 'init', { 'app/src/app.js': '1\n' });
  git(repo, 'checkout', '-q', '-b', 'csv-export');
  commit(repo, 'Add the csv-export tickets', { [`app/${file(56, 'tickets/csv-export')}`]: ticket('PROJ-56', { feature: 'csv-export', status: 'done' }) });
  git(repo, 'checkout', '-q', 'main');
  const out = run(work, 'tickets', 'PROJ-56');
  assert.equal(line(out, 'PROJ-56'), '  PROJ-56 Ticket PROJ-56 — waiting for the feature merge · branch csv-export, Test, today');
  assert.ok(out.includes(`  file: csv-export:${file(56, 'tickets/csv-export')}`), out.join('\n'));
});

gitTest('tickets: hundreds of branches do not hide work in progress', () => {
  const { work } = setup({ remote: false });
  const T = 'tickets/csv-export';
  commit(work, 'Add the csv-export tickets', { [file(57, T)]: ticket('PROJ-57', { feature: 'csv-export' }) });
  const head = git(work, 'rev-parse', 'HEAD');
  const names = Array.from({ length: 900 }, (_, i) => `refs/heads/a-rather-long-branch-name-for-the-test-${i}`);
  execFileSync('git', ['-C', work, 'update-ref', '--stdin'], { input: names.map((n) => `create ${n} ${head}\n`).join('') });
  git(work, 'checkout', '-q', '-b', 'work-x');
  commit(work, 'PROJ-57: start', { 'src/x.js': '1\n' });
  git(work, 'checkout', '-q', 'main');
  assert.equal(line(run(work, 'tickets'), 'PROJ-57'), '  PROJ-57 Ticket PROJ-57 — in progress · branch work-x, Test, today');
});

gitTest('tickets: a commit that edits only another feature\'s tickets is not work on a key it names', () => {
  const { work } = setup({ remote: false });
  commit(work, 'Add the tickets', { [file(58, 'tickets/csv-export')]: ticket('PROJ-58', { feature: 'csv-export' }), [file(59, 'tickets/pdf-report')]: ticket('PROJ-59', { feature: 'pdf-report' }) });
  git(work, 'checkout', '-q', '-b', 'pdf-report');
  commit(work, 'PROJ-59: depends on PROJ-58 now', { [file(59, 'tickets/pdf-report')]: ticket('PROJ-59', { feature: 'pdf-report', depends: ['PROJ-58'] }) });
  git(work, 'checkout', '-q', 'main');
  assert.equal(line(run(work, 'tickets'), 'PROJ-58'), '  PROJ-58 Ticket PROJ-58 — next');
});

gitTest('tickets: branches older than 30 days are read only when a ticket names them', () => {
  const { work } = setup();
  const T = 'tickets/old-feature';
  const both = (done40, done41) => ({ [file(40, T)]: ticket('PROJ-40', { feature: 'old-feature', status: done40 }), [file(41, T)]: ticket('PROJ-41', { feature: 'old-feature', status: done41 }) });
  git(work, 'checkout', '-q', '-b', 'old-feature');
  commit(work, 'PROJ-40: done', { 'src/a.js': '1\n', ...both('done', 'todo') }, OLD);
  git(work, 'checkout', '-q', '-b', 'old-other');
  commit(work, 'PROJ-41: done', { 'src/b.js': '1\n', ...both('done', 'done') }, OLD);
  git(work, 'checkout', '-q', 'main');
  commit(work, 'Add the old-feature tickets', both('todo', 'todo'));
  git(work, 'push', '-q', 'origin', 'main');
  const out = run(work, 'tickets');
  assert.equal(line(out, 'PROJ-40'), '  PROJ-40 Ticket PROJ-40 — waiting for the feature merge · branch old-feature, Test, 40 days ago · stale', 'the ticket\'s own branch is read at any age');
  assert.equal(line(out, 'PROJ-41'), '  PROJ-41 Ticket PROJ-41 — next', 'an old branch no ticket names is not read');
});

gitTest('tickets: duplicate keys, a hand-made ticket in a feature folder, keys in any case', () => {
  const { work } = setup({ remote: false });
  const T = 'tickets/csv-export';
  write(work, `${T}/PROJ-70-a.md`, ticket('PROJ-70', { feature: 'csv-export' }));
  write(work, `tickets/copy/PROJ-70-a.md`, ticket('PROJ-70', { feature: 'csv-export' }));
  write(work, `${T}/upload.md`, ticket('PROJ-71', { feature: 'csv-export' }));
  write(work, `${T}/notes.md`, '# notes\n');
  write(work, `${T}/proj-72-x.md`, ticket('proj-72', { feature: 'csv-export' }));
  // A hand-made ticket in a folder with no key-named ticket is not found.
  write(work, 'misc/loose.md', ticket('PROJ-73', { feature: 'csv-export' }));
  assert.deepEqual(run(work, 'tickets'), [
    'tickets: 1 feature, 3 tickets; no remote',
    'csv-export (0 of 3 done)',
    '  PROJ-70 Ticket PROJ-70 — next · duplicate key (2 files)',
    '  PROJ-71 Ticket PROJ-71 — to do',
    '  proj-72 Ticket proj-72 — to do',
    'next: PROJ-70 (csv-export)',
  ]);
  const dup = run(work, 'tickets', 'PROJ-70');
  assert.ok(dup.includes(`  file: ${T}/PROJ-70-a.md`) && dup.includes('  file: tickets/copy/PROJ-70-a.md'), dup.join('\n'));
  assert.equal(line(run(work, 'tickets', 'PROJ-72'), 'proj-72'), '  proj-72 Ticket proj-72 — to do');
  assert.deepEqual(run(work, 'tickets', 'PROJ-73'), ['tickets: none (no ticket or feature PROJ-73)']);
});

gitTest('tickets: this machine\'s tickets are done by their file, in progress by a task or the session note', () => {
  const { work } = setup({ remote: false });
  const T = `${LOCAL}/pdf-report/tickets`;
  write(work, `${T}/PROJ-80-a.md`, ticket('PROJ-80', { feature: 'pdf-report', status: 'done' }));
  write(work, `${T}/PROJ-81-b.md`, ticket('PROJ-81', { feature: 'pdf-report' }));
  write(work, `${T}/PROJ-82-c.md`, ticket('PROJ-82', { feature: 'pdf-report', depends: ['PROJ-80'] }));
  write(work, `${T}/PROJ-83-d.md`, ticket('PROJ-83', { feature: 'pdf-report', depends: ['PROJ-81'] }));
  write(work, '.keel/next-session.md', '---\nstatus: in-progress\nkeys: PROJ-81\n---\n');
  const out = run(work, 'tickets');
  assert.deepEqual(out.slice(1), [
    'pdf-report (1 of 4 done)',
    '  PROJ-80 Ticket PROJ-80 — done',
    '  PROJ-81 Ticket PROJ-81 — in progress · session (.keel/next-session.md)',
    '  PROJ-82 Ticket PROJ-82 — next',
    '  PROJ-83 Ticket PROJ-83 — to do',
    'next: PROJ-82 (pdf-report)',
  ]);
  const key = run(work, 'tickets', 'PROJ-82');
  assert.ok(key.includes(`  file: ${T}/PROJ-82-c.md`) && key.includes('  depends: PROJ-80 done'), key.join('\n'));
});

gitTest('tickets --fetch: what a colleague pushed is seen after the fetch, with the data date', () => {
  const { tmp, work, server } = setup();
  const T = 'tickets/csv-export';
  commit(work, 'Add the csv-export tickets', { [file(90, T)]: ticket('PROJ-90', { feature: 'csv-export' }) });
  git(work, 'push', '-q', 'origin', 'main');
  otherPush(server, tmp, 'colleague-work', file(90, T), ticket('PROJ-90', { feature: 'csv-export', status: 'done' }));
  const before = run(work, 'tickets');
  assert.equal(before[0], 'tickets: 1 feature, 1 ticket; never fetched');
  assert.equal(line(before, 'PROJ-90'), '  PROJ-90 Ticket PROJ-90 — next');
  const after = run(work, 'tickets', 'PROJ-90', '--fetch');
  assert.match(after[0], /^tickets: 1 feature, 1 ticket; server data from \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(line(after, 'PROJ-90'), '  PROJ-90 Ticket PROJ-90 — waiting for merge into the feature branch · branch origin/colleague-work, Other, today');
  assert.equal(line(run(work, 'tickets', '--fetch', 'PROJ-90'), 'PROJ-90'), line(after, 'PROJ-90'), 'the flag before the key');
});

gitTest('done: one status line of the working tree\'s ticket, the feature complete, undo, refusals', () => {
  const { work } = setup({ remote: false });
  const T = 'tickets/csv-export';
  const a = `${T}/PROJ-1-a.md`;
  write(work, a, ticket('PROJ-1', { feature: 'csv-export' }));
  write(work, `${T}/PROJ-2-b.md`, ticket('PROJ-2', { feature: 'csv-export' }));
  const before = readRel(work, a);
  assert.deepEqual(run(work, 'done', 'PROJ-1'), [`done: PROJ-1 (${a})`]);
  assert.equal(readRel(work, a), before.replace('status: todo', 'status: done'), 'only the status line changes');
  assert.deepEqual(run(work, 'done', 'PROJ-1'), ['done: PROJ-1 (already)']);
  assert.deepEqual(run(work, 'done', 'proj-2'), [`done: PROJ-2 (${T}/PROJ-2-b.md)`, 'done: feature csv-export complete (2 tickets)']);
  assert.deepEqual(run(work, 'done', 'PROJ-2', '--undo'), [`done: PROJ-2 -> todo (${T}/PROJ-2-b.md)`]);
  assert.match(readRel(work, `${T}/PROJ-2-b.md`), /^status: todo$/m);
  assert.deepEqual(run(work, 'done', '--undo', 'PROJ-2'), ['done: PROJ-2 -> todo (already)']);
  assert.deepEqual(run(work, 'done', 'PROJ-9'), ['done: none (no ticket PROJ-9 here)']);
  assert.deepEqual(run(work, 'done', 'T1'), ['plans: done refused (invalid key "T1")']);
  write(work, `tickets/copy/PROJ-1-a.md`, ticket('PROJ-1', { feature: 'csv-export' }));
  const two = run(work, 'done', 'PROJ-1', '--undo');
  assert.match(two[0], /^plans: done refused \(2 files have PROJ-1: /);
  assert.match(readRel(work, a), /^status: done$/m, 'nothing written');
});

gitTest('drop: refused until every ticket is done and on the branch the feature merges into; then the folder goes to keel\'s trash', () => {
  const { work } = setup({ remote: false });
  const T = 'tickets/csv-export';
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'Add the csv-export tickets', { [`${T}/PROJ-1-a.md`]: ticket('PROJ-1', { feature: 'csv-export' }), [`${T}/PROJ-2-b.md`]: ticket('PROJ-2', { feature: 'csv-export', status: 'done' }) });
  assert.deepEqual(run(work, 'drop', 'csv-export'), ['plans: drop refused (not every ticket of csv-export is done: PROJ-1 to do)']);
  assert.deepEqual(run(work, 'done', 'PROJ-1'), [`done: PROJ-1 (${T}/PROJ-1-a.md)`, 'done: feature csv-export complete (2 tickets)']);
  commit(work, 'PROJ-1: done');
  git(work, 'checkout', '-q', 'main');
  git(work, 'merge', '-q', 'csv-export');
  assert.deepEqual(run(work, 'drop', 'csv-export'), ['plans: drop refused (on main, where the feature merges; the tickets are removed on the feature branch before its merge)']);
  assert.ok(exists(work, T));
  git(work, 'checkout', '-q', '--detach', 'csv-export');
  assert.deepEqual(run(work, 'drop', 'csv-export'), ['plans: drop refused (HEAD is detached; switch to the feature branch first)']);
  git(work, 'checkout', '-q', 'csv-export');
  const out = run(work, 'drop', 'csv-export');
  const m = /^drop: tickets\/csv-export\/ -> trash (\S+)$/.exec(out[0]);
  assert.ok(m && out.length === 1, out.join('\n'));
  assert.ok(!exists(work, T));
  assert.ok(exists(work, `.keel/local/trash/${m[1]}/files/${T}/PROJ-1-a.md`));
  assert.deepEqual(run(work, 'drop', 'csv-export'), ['plans: drop refused (no tickets of csv-export in this working tree)']);
});

gitTest('drop: a folder shared with other features or code is never moved', () => {
  const { work } = setup({ remote: false });
  git(work, 'checkout', '-q', '-b', 'csv-export');
  commit(work, 'Add the tickets', {
    'tickets/PROJ-63-a.md': ticket('PROJ-63', { feature: 'csv-export', status: 'done' }),
    'tickets/PROJ-64-b.md': ticket('PROJ-64', { feature: 'pdf-report' }),
    'tickets/helper.js': 'module.exports = 1;\n',
  });
  assert.deepEqual(run(work, 'drop', 'csv-export'), ['plans: drop refused (tickets/ is not the feature\'s own folder csv-export/; move its tickets into one first)']);
  assert.ok(exists(work, 'tickets/helper.js') && exists(work, 'tickets/PROJ-64-b.md'));
});

gitTest('drop: this machine\'s feature folder goes to keel\'s trash once its tickets are done, also on main', () => {
  const { work } = setup({ remote: false });
  const T = `${LOCAL}/pdf-report/tickets`;
  write(work, `${T}/PROJ-5-a.md`, ticket('PROJ-5', { feature: 'pdf-report' }));
  assert.deepEqual(run(work, 'drop', 'pdf-report'), ['plans: drop refused (not every ticket of pdf-report is done: PROJ-5 to do)']);
  assert.deepEqual(run(work, 'done', 'PROJ-5'), [`done: PROJ-5 (${T}/PROJ-5-a.md)`, 'done: feature pdf-report complete (1 ticket)']);
  const out = run(work, 'drop', 'pdf-report');
  const m = /^drop: \.keel\/local\/plans\/keel\/pdf-report\/ -> trash (\S+)$/.exec(out[0]);
  assert.ok(m, out.join('\n'));
  assert.ok(!exists(work, `${LOCAL}/pdf-report`));
  assert.ok(exists(work, `.keel/local/trash/${m[1]}/files/${T}/PROJ-5-a.md`));
});
