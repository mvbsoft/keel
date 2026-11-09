'use strict';
// Reading keel's instruction texts in tests: a file of the plugin or a skill, a part of a text between two
// markers, the order of two passages, and the key words of a rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', 'plugins', 'keel');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const shared = (name) => read('skills', '_shared', name);
const skill = (name) => read('skills', name, 'SKILL.md');

// Runs of whitespace count as one space, so a line wrap inside a passage or a key does not matter.
const flat = (s) => s.replace(/\s+/g, ' ');

const order = (text, a, b, why) => {
  const [t, x, y] = [text, a, b].map(flat);
  assert.ok(t.includes(x), `missing: ${a}`);
  assert.ok(t.includes(y), `missing: ${b}`);
  assert.ok(t.indexOf(x) < t.indexOf(y), why || `${a} comes before ${b}`);
};

// From the first `from` to the next `to` after it (to the end without `to`, or when `to` is not there).
const part = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = to ? text.indexOf(to, a + from.length) : -1;
  return text.slice(a, b < 0 ? undefined : b);
};

// Key words of a rule, not its whole sentence: every key stands in one paragraph, list item, table
// row or heading of `text`, in any order. A blank line ends a block, and so does a line that starts
// with `- `, `* `, `+ `, `1. `, `|` or `#`. A rewording that keeps the rule keeps the test green.
const says = (text, keys, why) => {
  assert.ok(Array.isArray(keys) && keys.length > 0 && keys.every((k) => k.trim()), 'says() needs a list of non-empty keys');
  const wanted = keys.map(flat);
  const blocks = text.split(/\n\s*\n|\n(?=[ \t]*(?:[-*+] |\d+\. |\||#))|(?<=^#+ [^\n]*)\n/m).map(flat);
  let best = wanted;
  for (const block of blocks) {
    const missing = wanted.filter((k) => !block.includes(k));
    if (missing.length === 0) return;
    if (missing.length < best.length) best = missing;
  }
  assert.fail(`${why ? `${why}: ` : ''}no paragraph has all of ${JSON.stringify(wanted)}; the closest lacks ${JSON.stringify(best)}`);
};

module.exports = { PLUGIN, read, shared, skill, flat, order, part, says };
