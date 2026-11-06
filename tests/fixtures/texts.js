'use strict';
// Reading keel's instruction texts in tests: a file of the plugin, a part of a text between two
// markers, and the order of two passages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', 'plugins', 'keel');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const shared = (name) => read('skills', '_shared', name);

const order = (text, a, b, why) => {
  assert.ok(text.includes(a), `missing: ${a}`);
  assert.ok(text.includes(b), `missing: ${b}`);
  assert.ok(text.indexOf(a) < text.indexOf(b), why || `${a} comes before ${b}`);
};

// From the first `from` to the next `to` after it (to the end without `to`, or when `to` is not there).
const part = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = to ? text.indexOf(to, a + from.length) : -1;
  return text.slice(a, b < 0 ? undefined : b);
};

module.exports = { PLUGIN, read, shared, order, part };
