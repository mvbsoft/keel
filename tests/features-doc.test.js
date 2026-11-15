'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const UK = read('docs', 'features.uk.md');
const EN = read('docs', 'features.md');

// One entry per heading: its level, and how many table rows, list items and folded blocks follow it.
function shape(text) {
  const sections = [{ level: 0, rows: 0, items: 0, folded: 0 }];
  for (const line of text.split('\n')) {
    const heading = /^(#+) /.exec(line);
    if (heading) sections.push({ level: heading[1].length, rows: 0, items: 0, folded: 0 });
    else if (line.startsWith('|')) sections.at(-1).rows += 1;
    else if (line.startsWith('- ')) sections.at(-1).items += 1;
    else if (line.startsWith('<details>')) sections.at(-1).folded += 1;
  }
  return sections;
}

const backticked = (text) => [...new Set(text.match(/`[^`\n]+`/g) || [])].sort();

function skills() {
  const dir = path.join(ROOT, 'plugins', 'keel', 'skills');
  const commands = [];
  const advisory = [];
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const typedByUser = /^disable-model-invocation: true$/m.test(fs.readFileSync(file, 'utf8'));
    (typedByUser ? commands : advisory).push(name);
  }
  return { commands, advisory };
}

test('feature list: the English page has the same sections, tables, lists and folded blocks as the Ukrainian one', () => {
  assert.deepEqual(shape(EN), shape(UK));
});

test('feature list: both pages name the same commands, paths and option words', () => {
  const sameInBoth = (text) => backticked(text).filter((word) => /^`[\x20-\x7e]+`$/.test(word));
  const onlyUk = sameInBoth(UK).filter((word) => !EN.includes(word));
  const onlyEn = sameInBoth(EN).filter((word) => !UK.includes(word));
  // The example instruction after /keel:end-task is written in each page's own language.
  const translated = (word) => word.startsWith('`/keel:end-task ') && word.includes(',');
  assert.deepEqual(onlyUk.filter((word) => !translated(word)), []);
  assert.deepEqual(onlyEn.filter((word) => !translated(word)), []);
});

test('feature list: every command and every advisory skill of the plugin is on both pages', () => {
  const { commands, advisory } = skills();
  assert.ok(commands.length > 0 && advisory.length > 0);
  for (const page of [UK, EN]) {
    for (const name of commands) assert.ok(page.includes(`\`/keel:${name}\``), `/keel:${name} is missing`);
    for (const name of advisory) assert.ok(page.includes(`\`${name}\``), `skill ${name} is missing`);
  }
});

test('feature list: each page links the other, and each README links the page in its language', () => {
  assert.ok(UK.includes('[English](features.md)'));
  assert.ok(EN.includes('(features.uk.md)'));
  assert.ok(read('README.md').includes('(docs/features.md)'));
  assert.ok(read('README.uk.md').includes('(docs/features.uk.md)'));
});
