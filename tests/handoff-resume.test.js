'use strict';
const test = require('node:test');
const { shared, skill, says, order } = require('./fixtures/texts.js');

const resume = () => {
  const h = shared('handoff-resume.md');
  return h.slice(h.indexOf('## Resume (start-session)'), h.indexOf('**Which lane**'));
};

test('resume: a note branch that differs from the current one is switched in manual git too, after the user says it ran', () => {
  says(resume(), ['`note branch` differs from the current branch', '`git-flow.js switch --name <branch>`', 'manual: give `git switch <branch>` and wait']);
});

test('resume: a plan file gets its branch before the note is written, as a feature does', () => {
  says(resume(), ['a path to a plan file', 'on yes the git branch for the line first', 'then write the note', 'a switch needs a clean tree']);
  order(resume().slice(resume().indexOf('a path to a plan file')), 'on yes the git branch for the line first', 'then write the note');
});

test('handoff.md hands the resume case to its own file; start-session reads that file, end-session keeps handoff.md', () => {
  says(shared('handoff.md'), ['**Resume**', '`/keel:start-session`', '`<keel>/skills/_shared/handoff-resume.md`', 'read', 'follow it']);
  says(skill('start-session'), ['Read `<keel>/skills/_shared/handoff-resume.md`', 'act on the case that fits']);
  says(skill('end-session'), ['read `<keel>/skills/_shared/handoff.md`', 'write the note']);
});
