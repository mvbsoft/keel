'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// Directories that are never part of the published repository.
const SKIP = new Set(['.git', '.design', 'node_modules', '.keel']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

test('marketplace lists the keel plugin from ./plugins/keel', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'keel');
  assert.deepEqual(m.plugins.map((p) => [p.name, p.source]), [['keel', './plugins/keel']]);
});

test('plugin manifest: name, version and the two userConfig options', () => {
  const p = json('plugins/keel/.claude-plugin/plugin.json');
  assert.equal(p.name, 'keel');
  assert.equal(p.version, '1.2.1');
  assert.equal(p.license, 'MIT');
  assert.deepEqual(Object.keys(p.userConfig).sort(), ['allow_opus', 'conversation_language']);
  assert.equal(p.userConfig.conversation_language.default, 'en');
  assert.equal(p.userConfig.allow_opus.type, 'boolean');
  assert.equal(p.userConfig.allow_opus.default, true);
  assert.equal(p.mcpServers, undefined, 'no MCP servers in the manifest');
});

test('LICENSE is MIT and the plugin ships an identical copy', () => {
  const root = read('LICENSE');
  assert.match(root, /^MIT License/);
  assert.equal(read('plugins/keel/LICENSE'), root);
});

test('line endings are pinned to LF', () => {
  assert.match(read('.gitattributes'), /^\* text=auto eol=lf$/m);
});

test('the dev package requires Node 22 or newer', () => {
  assert.equal(json('package.json').engines.node, '>=22');
  const [major] = process.versions.node.split('.').map(Number);
  assert.ok(major >= 22, `tests run on Node ${process.versions.node}`);
});

test('no file mentions the predecessor or personal names', () => {
  const banned = [['mava', 'talk'], ['mal', 'ina'], ['opus', 'plan']].map((p) => p.join(''));
  const hits = [];
  for (const file of walk(ROOT)) {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    const rel = path.relative(ROOT, file);
    for (const word of banned) {
      if (text.includes(word) || rel.toLowerCase().includes(word)) hits.push(`${rel}: ${word}`);
    }
  }
  assert.deepEqual(hits, []);
});
