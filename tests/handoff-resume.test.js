'use strict';
const test = require('node:test');
const { shared, says, order } = require('./fixtures/texts.js');

const resume = () => {
  const h = shared('handoff.md');
  return h.slice(h.indexOf('## Resume (start-session)'), h.indexOf('**Which lane**'));
};

test('resume: a note branch that differs from the current one is switched in manual git too, after the user says it ran', () => {
  says(resume(), ['`note branch` differs from the current branch', '`git-flow.js switch --name <branch>`', 'manual: give `git switch <branch>` and wait']);
});

test('resume: a plan file gets its branch before the note is written, as a feature does', () => {
  says(resume(), ['a path to a plan file', 'on yes the git branch for the line first', 'then write the note', 'a switch needs a clean tree']);
  order(resume().slice(resume().indexOf('a path to a plan file')), 'on yes the git branch for the line first', 'then write the note');
});
