'use strict';
// The validation sandbox: "tasker", a small Node.js API (node:sqlite, no dependencies). A committed
// base, then one task change left uncommitted on top, as a session would leave it for /keel:end-task:
//   S      project report across modules (keel should propose Standard), with planted defects
//   M      roles, a migration and task deletion (should propose Maximum), with planted defects
//   C      title search, written to be correct: the false-alarm control
//   H      workload tools (Maximum) with hard defects: race, injection, data loss, boundaries
//   base   no change (start for the model-comparison tasks in small/ and big/)
// The built sandbox carries no hint of what is planted: PLANTED below is the answer key, kept here.
// Usage as a script: node sandbox.js <targetDir> <variant> [--keel]  (--keel adds keel's config,
// the profile from scan.js and the task as .keel/tasks/<id>/task.md)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tempDir } = require('./tmp.js');

const SRC = path.join(__dirname, 'sandbox');
const SCAN = path.join(__dirname, '..', '..', 'plugins', 'keel', 'scripts', 'scan.js');
const NOTES = path.join(__dirname, '..', '..', 'plugins', 'keel', 'scripts', 'notes.js');
const TEMPLATES =path.join(__dirname, '..', '..', 'plugins', 'keel', 'templates', 'keel');
const VARIANTS = ['base', 'S', 'M', 'C', 'H', 'small', 'big'];

// The answer key. find: text that sits on (or starts) the defect's line in the built sandbox.
const PLANTED = {
  S: [
    { id: 'S1', kind: 'logic', file: 'src/tasks.js', find: "AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date, id", what: 'listOverdue does not exclude done tasks (criterion 2)', agents: ['bug-hunter', 'qa', 'test-reviewer'] },
    { id: 'S2', kind: 'false-docs', file: 'README.md', find: '`days_overdue` counts working days', what: 'README says working days; the code counts calendar days (and criterion 3 says calendar days)', agents: ['docs'] },
    { id: 'S3', kind: 'duplicate', file: 'src/report.js', find: 'function dayDiff(from, to)', what: 'dayDiff repeats daysBetween from src/lib/dates.js', agents: ['architect', 'bug-hunter'] },
    { id: 'S4', kind: 'naming', file: 'src/report.js', find: 'function sortTasks(rows)', what: 'sortTasks counts tasks per status; it sorts nothing', agents: ['architect'] },
    { id: 'S5', kind: 'size', file: 'src/tasks.js', find: 'function listOverdue(db, projectId, today)', what: 'new code added to an ~890-line module that already mixes tasks with a holiday data table; split instead of growing it', agents: ['architect'] },
    { id: 'S6', kind: 'weak-test', file: 'test/report.spec.js', find: "test('done tasks are not overdue'", what: 'the done task is due in the future, so the test passes although done tasks are not excluded', agents: ['test-reviewer'] },
  ],
  M: [
    { id: 'M1', kind: 'security', file: 'src/access.js', find: "SELECT role FROM project_members WHERE user_id = ?", what: 'roleOf ignores the project: an admin of any project may delete tasks of every project (criterion 2)', agents: ['security', 'bug-hunter'] },
    { id: 'M2', kind: 'migration-index', file: 'db/migrations/002_project_members.sql', find: 'CREATE TABLE project_members (', what: 'no primary key, unique constraint or index on (project_id, user_id), which every delete looks up; duplicates possible', agents: ['data'] },
    { id: 'M3', kind: 'logic', file: 'src/access.js', find: "!== 'member'", what: "a user with no membership (null) passes !== 'member': non-members may delete", agents: ['security', 'bug-hunter', 'qa', 'qa-break'] },
  ],
  C: [],
  // Hard defects: the kind a single plain reviewer tends to miss.
  H: [
    { id: 'H1', kind: 'race', file: 'src/workload.js', find: 'await notifyAssigned(assigneeId, task);', what: 'the open-task limit is checked once, then every assignment awaits the notice: concurrent requests both pass the check and exceed 5 (criterion 3 "ever")', agents: ['bug-hunter', 'qa-break'] },
    { id: 'H2', kind: 'security', file: 'src/tasks.js', find: '!SORTS.some((s) => column.startsWith(s))', what: 'startsWith lets "priority, (SELECT ...)" through: SQL injection into ORDER BY, e.g. reading other projects or users', agents: ['security', 'bug-hunter'] },
    { id: 'H3', kind: 'logic', file: 'src/workload.js', find: 'const start = addDays(day, 1 - weekday(day));', what: 'for a Sunday (weekday 0) the week starts the next Monday: Sunday dates show the following week (criterion 4)', agents: ['bug-hunter', 'qa-break', 'test-reviewer'] },
    { id: 'H4', kind: 'performance', file: 'src/workload.js', find: "db.prepare('SELECT name FROM users WHERE id = ?').get(t.assignee_id)", what: 'one users query per exported task (N+1); a JOIN gives it in one query', agents: ['data', 'bug-hunter'] },
    { id: 'H5', kind: 'data-loss', file: 'db/migrations/002_task_estimates.sql', find: 'INSERT INTO tasks_new (id, project_id, title, status, priority, assignee_id, created_at)', what: 'the copy leaves out due_date: every existing due date is lost (criterion 1); the tasks_assignee index is not recreated either', agents: ['data'] },
    { id: 'H6', kind: 'integrity', file: 'src/workload.js', find: "if (!task || task.project_id !== projectId) throw new HttpError(404", what: 'tasks are updated one by one and an invalid id later in the list throws after earlier ones were saved: not "all or none" (criterion 3)', agents: ['bug-hunter', 'qa-break', 'data'] },
    { id: 'H7', kind: 'security', file: 'src/workload.js', find: 'lines.push([t.id, t.title, t.status', what: 'titles starting with = + - @ go into a CSV opened in spreadsheets: formula injection (criterion 5 says it is opened there)', agents: ['security'] },
  ],
};

function copyTree(from, to, skip = new Set()) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      copyTree(src, dst);
    } else fs.copyFileSync(src, dst);
  }
}

// Each edit's `find` must occur exactly once in its file.
function applyEdits(root, edits) {
  for (const { file, find, replace } of edits) {
    const full = path.join(root, file);
    const text = fs.readFileSync(full, 'utf8');
    const n = text.split(find).length - 1;
    if (n !== 1) throw new Error(`sandbox edit: ${file} has ${n} matches for ${JSON.stringify(find.slice(0, 60))}`);
    fs.writeFileSync(full, text.replace(find, () => replace));
  }
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [{ part: '.', kind: 'test', command: 'npm test' }], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};

// Builds a sandbox in `dir` (created when missing, must be empty). Returns { root, variant, task, git }.
function build(dir, variant, { keel = false } = {}) {
  if (!VARIANTS.includes(variant)) throw new Error(`unknown sandbox variant ${variant} (${VARIANTS.join(', ')})`);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.readdirSync(dir).length) throw new Error(`sandbox target ${dir} is not empty`);
  copyTree(path.join(SRC, 'base'), dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n*.db\n');
  if (variant === 'small' || variant === 'big') copyTree(path.join(SRC, variant), dir);

  const git = hasGit();
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const commit = (message) => {
    run('add', '-A');
    run('-c', 'user.name=Dev', '-c', 'user.email=dev@tasker.test', 'commit', '-q', '-m', message);
  };
  if (git) {
    run('init', '-q', '-b', 'main');
    run('config', 'core.autocrlf', 'false');
    commit('Tasker 1.4');
  }

  if (keel) {
    const k = path.join(dir, '.keel');
    fs.mkdirSync(k, { recursive: true });
    fs.writeFileSync(path.join(k, 'config.json'), JSON.stringify(CONFIG, null, 2) + '\n');
    fs.copyFileSync(path.join(TEMPLATES, 'gitignore'), path.join(k, '.gitignore'));
    const scan = JSON.parse(execFileSync(process.execPath, [SCAN, dir], { encoding: 'utf8' }));
    fs.writeFileSync(path.join(k, 'profile.json'), JSON.stringify(scan.profile, null, 2) + '\n');
    if (git) {
      commit('keel config');
      // What /keel:start-task records before the work: the start commit and the untracked files.
      execFileSync(process.execPath, [NOTES, dir, 'check', '--begin'], { stdio: 'ignore' });
    }
  }

  let task = null;
  if (['S', 'M', 'C', 'H'].includes(variant)) {
    const v = path.join(SRC, variant);
    copyTree(v, dir, new Set(['edits.json', 'task.md']));
    applyEdits(dir, JSON.parse(fs.readFileSync(path.join(v, 'edits.json'), 'utf8')));
    task = path.join(v, 'task.md');
    if (keel) {
      const id = (/^key:\s*(\S+)/m.exec(fs.readFileSync(task, 'utf8')) || [])[1] || 'TSK-0';
      fs.mkdirSync(path.join(dir, '.keel', 'tasks', id), { recursive: true });
      fs.copyFileSync(task, path.join(dir, '.keel', 'tasks', id, 'task.md'));
    }
  }
  return { root: dir, variant, task, git };
}

function makeSandbox(variant, opts) {
  return build(tempDir(`keel-tasker-${variant}-`), variant, opts);
}

if (require.main === module) {
  const [target, variant] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const r = build(path.resolve(target), variant, { keel: process.argv.includes('--keel') });
  process.stdout.write(`sandbox ${r.variant} at ${r.root}${r.git ? '' : ' (no git)'}\n`);
}

module.exports = { build, makeSandbox, PLANTED, VARIANTS, CONFIG, hasGit };
