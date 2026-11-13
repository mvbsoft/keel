'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shared, skill, says, part } = require('./fixtures/texts.js');

test('preflight: settings on another branch are explained, never configured again or committed here', () => {
  const text = shared('preflight.md');
  says(text, ['`settings on branch: <name>`', 'keel is set up here, not lost', 'reach this branch when that branch is merged']);
  says(text, ['switch to `<name>` and go on there, or', 'git-flow.js" "<project>" switch --name <name>', 'manual git: give `git switch <name>`']);
  says(text, ['Never offer to configure again', 'never commit the settings here']);
  assert.ok(text.indexOf('`settings on branch: <name>`') < text.indexOf('`keel-config: missing | broken | invalid | outdated`'), 'the branch rule comes before the general one');
});

test('preflight: a branch checked out in another folder is not switched to; the user works in that folder', () => {
  says(shared('preflight.md'), ['`settings in folder: <path>`', 'checked out in that folder', 'work in `<path>`', 'never offer to switch the branch here']);
});

test('configure: settings on another branch mean keel is already set up; no fresh setup unless the user insists', () => {
  const keys = ['`settings on branch: <name>`', 'already set up on that branch', 'reach this branch when that branch is merged', 'the user insists'];
  says(part(shared('configure-flow.md'), 'Read the check output', 'Existing AI instruction files'), keys);
  says(skill('configure'), keys);
});

test('intake: setup files meet an existing branch with a plain git switch; no stash, no commit on the main branch', () => {
  const intake = shared('intake.md');
  const before = part(intake, '## Before any branch change', '## Planned ticket');
  says(before, ['`git-flow.js switch` stops on them', 'plain `git switch <branch>`', 'git carries the files over', 'refuses when that branch has its own version']);
  assert.doesNotMatch(before, /stash/);
});

test('delegating names the plan file: the task folder\'s plan.md, else its task.md', () => {
  says(shared('intake.md'), ['delegate.md` with the plan file', "the task folder's `plan.md`", 'its `task.md`']);
  says(shared('delegate.md'), ["a task's `plan.md`, else its `task.md`"]);
});

test('a branch is read with git show <ref>:./<path>, so a project in a subfolder of the repository works', () => {
  says(shared('intake.md'), ['git show <ref>:./<path>']);
  says(skill('tasks'), ['git show <branch>:./<path>/task.md']);
  assert.doesNotMatch(shared('intake.md') + skill('tasks'), /git show <(ref|branch)>:<path>/);
});
