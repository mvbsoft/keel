'use strict';
// plans.js move <feature> --to repo|pc: the feature folder as it is between this machine and the
// repository, refused while the target exists, a ticket is in progress, a task names a ticket of it or
// the folder has uncommitted changes. Throwaway repositories; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FEATURE, PLAN, THERE, gitTest, git, write, readRel, has, run, CONFIG, repo, commit } = require('./fixtures/plans-repos.js');
const { tempDir } = require('./fixtures/tmp.js');

// Every file of a folder with its text, by path inside it.
function files(dir) {
  const out = {};
  const walk = (d, at) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name), `${at}${e.name}/`);
      else out[`${at}${e.name}`] = fs.readFileSync(path.join(d, e.name), 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

gitTest('move: the folder goes as it is between this machine and the repository; --to pc warns that the commit takes it out of git', () => {
  const api = repo(path.join(tempDir('keel-move-'), 'projects'), 'api', CONFIG());
  run(api, 'new', FEATURE);
  run(api, 'ticket', FEATURE, '--title', 'Event');
  write(api, `${PLAN}/research/notes.md`, 'What was found.\n');
  const before = files(path.join(api, PLAN));
  assert.deepEqual(run(api, 'move', FEATURE, '--to', 'pc'), [`move: ${FEATURE} is already in ${PLAN}/ (pc)`]);
  assert.equal(run(api, 'move', FEATURE, '--to', 'cloud')[0], 'plans: move refused (--to repo or --to pc)');
  assert.equal(run(api, 'move', FEATURE)[0], 'plans: move refused (--to repo or --to pc)');
  assert.equal(run(api, 'move', 'no-such-feature', '--to', 'repo')[0], 'plans: move refused (no feature "no-such-feature" (plans.js list shows them))');

  assert.deepEqual(run(api, 'move', FEATURE, '--to', 'repo'), [`moved: ${PLAN}/ -> ${THERE}/`, `next: plans.js commit ${FEATURE}`]);
  assert.ok(!has(api, PLAN));
  assert.deepEqual(files(path.join(api, THERE)), before, 'no file is rewritten');
  assert.match(run(api, 'list')[1], new RegExp(`^- ${FEATURE}: draft .* · ${THERE}/$`));

  // Back: not while the folder has uncommitted changes.
  assert.equal(run(api, 'move', FEATURE, '--to', 'pc')[0], `plans: move refused (${THERE}/ has uncommitted changes: plans.js commit ${FEATURE} first)`);
  commit(api, 'Plan the feature');
  assert.deepEqual(run(api, 'move', FEATURE, '--to', 'pc'), [`moved: ${THERE}/ -> ${PLAN}/`, `warn: once committed (plans.js commit ${FEATURE}), the folder leaves git for everyone: only this machine keeps it`]);
  assert.deepEqual(files(path.join(api, PLAN)), before);
  assert.ok(git(api, 'status', '--porcelain').includes(THERE), 'the removal waits for its commit');
});

gitTest('move: refused while the target exists, a ticket is in progress or a task works on a ticket of the feature', () => {
  const api = repo(path.join(tempDir('keel-move-'), 'projects'), 'api', CONFIG());
  run(api, 'new', FEATURE);
  run(api, 'ticket', FEATURE, '--title', 'Event');
  fs.mkdirSync(path.join(api, THERE), { recursive: true });
  assert.equal(run(api, 'move', FEATURE, '--to', 'repo')[0], `plans: move refused (${THERE}/ exists)`);
  fs.rmSync(path.join(api, 'tickets'), { recursive: true });

  const ticket = `${PLAN}/tickets/T1-event.md`;
  write(api, ticket, readRel(api, ticket).replace('status: draft', 'status: in-progress'));
  assert.equal(run(api, 'move', FEATURE, '--to', 'repo')[0], 'plans: move refused (in progress: T1)');
  write(api, ticket, readRel(api, ticket).replace('status: in-progress', 'status: done'));

  for (const dir of ['.keel/tasks', '.keel/local/tasks']) {
    write(api, `${dir}/${FEATURE}-t1/task.md`, `---\nticket: ${FEATURE}/T1\n---\n\n# Event\n`);
    assert.equal(run(api, 'move', FEATURE, '--to', 'repo')[0], `plans: move refused (tasks work on its tickets: ${FEATURE}-t1)`, dir);
    fs.rmSync(path.join(api, dir), { recursive: true });
  }
  // A task of another feature with a name that starts the same holds nothing back.
  write(api, '.keel/tasks/other/task.md', `---\nticket: ${FEATURE}-two/T1\n---\n\n# Other\n`);
  assert.equal(run(api, 'move', FEATURE, '--to', 'repo')[0], `moved: ${PLAN}/ -> ${THERE}/`);
});
