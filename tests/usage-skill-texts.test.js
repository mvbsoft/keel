'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { says, skill, shared } = require('./fixtures/texts.js');

test('/keel:usage on: says what goes to the page before the first send', () => {
  const on = skill('usage').split('**`on`**')[1].split('**`clear`**')[0];
  says(on, ['git email', 'task and step names', 'prompt_preview', 'first 100 characters', 'never your code or replies']);
});

test('usage-sync.md: the snapshot call passes no flag the script does not read', () => {
  assert.doesNotMatch(shared('usage-sync.md'), /--src/);
});
