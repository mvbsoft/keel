'use strict';
// Throwaway projects and repositories with task files for the notes.js task tests.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./tmp.js');
const { PLUGIN, SCRIPTS, gitTest, CONFIG, write, exists, git, line } = require('./keel-project.js');

const run = (script, dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, script), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const notes = (dir, ...args) => run('notes.js', dir, ...args);
// A finish: the verification is recorded first (here: the user chose none), then the task is deleted.
const finish = (dir, ...args) => { run('fingerprint.js', dir, 'save', '--tier', 'none'); return notes(dir, 'task', 'delete', ...args); };
// One task's block of `notes.js tasks`: the lines after "<id> · <title>" up to the next unindented line.
const block = (out, id) => {
  const i = out.findIndex((l) => l.startsWith(`${id} · `));
  if (i < 0) return [];
  const rest = out.slice(i + 1);
  const end = rest.findIndex((l) => !l.startsWith('  '));
  return end < 0 ? rest : rest.slice(0, end);
};
const has = (out, id, text) => block(out, id).some((l) => l.includes(text));
const taskPath = (id) => `.keel/tasks/${id}/task.md`;

function project(config = CONFIG()) {
  const dir = tempDir('keel-tasks-');
  write(dir, '.keel/config.json', JSON.stringify(config));
  write(dir, '.keel/.gitignore', 'local/\n');
  return dir;
}

// A repository with one commit on main, a keel config and no remote.
function repo(config) {
  const dir = project(config);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, 'src/app.js', 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
const commitAll = (dir, message) => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', message); };

const TASK = (id, extra = {}, body = '', section = 'State') => {
  const f = { id, title: `Title of ${id}`, source: 'text', link: '-', status: 'handed-off', branch: '-', base: 'main', merge_into: 'main', execution: 'here', plan: 'inline', created: '2026-10-01', updated: '2026-10-01', after_commit: '-', ...extra };
  return `---\n${Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# ${id}\n\n## Goal\nGoal of ${id}\n\n## Next action\nDo the next thing of ${id}\n\n## ${section}\n${body}\n`;
};
const putTask = (dir, id, ...args) => write(dir, taskPath(id), TASK(id, ...args));

module.exports = { PLUGIN, SCRIPTS, gitTest, CONFIG, write, exists, git, run, notes, finish, line, block, has, taskPath, project, repo, commitAll, TASK, putTask };
