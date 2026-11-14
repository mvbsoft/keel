'use strict';
// says(): the key words of a rule must stand together in one block of the text; order() ignores line wraps.
const test = require('node:test');
const assert = require('node:assert/strict');

const { says, order } = require('./fixtures/texts.js');

const text = [
  '## Resume',
  'A task handoff commits the work on its own',
  'branch and pushes it.',
  '',
  '- a planned ticket gets a new ticket branch',
  '- manual git gives the same steps as commands',
  '1. first a fetch',
  '2. then the switch',
  '| state | answer |',
  '| done | starts only on a yes |',
].join('\n');

test('says: keys in one paragraph pass in any order, across a line wrap', () => {
  says(text, ['pushes it', 'handoff', 'its own branch']);
  says(text, ['done', 'only on a yes']);
});

test('says: keys split between two blocks, or one missing, fail and name what is missing', () => {
  assert.throws(() => says(text, ['handoff', 'ticket branch']), /the closest lacks/);
  assert.throws(() => says(text, ['planned ticket', 'manual git']), /no paragraph has all/);
  assert.throws(() => says(text, ['Resume', 'handoff']));
  assert.throws(() => says(text, ['first a fetch', 'then the switch']), 'numbered items are blocks of their own');
  assert.throws(() => says(text, ['answer', 'only on a yes']), 'table rows are blocks of their own');
  assert.throws(() => says(text, ['handoff', 'stash'], 'no stash'), /^AssertionError.*no stash: .*\["stash"\]/s);
  assert.throws(() => says(text, []), /needs a list of non-empty keys/);
  assert.throws(() => says(text, ['handoff', ' ']), /needs a list of non-empty keys/);
});

test('order: passages compare with whitespace collapsed, so a line wrap inside one does not matter', () => {
  order(text, 'on its own branch', 'a planned ticket');
  assert.throws(() => order(text, 'a planned ticket', 'on its own branch'), /comes before/);
});
