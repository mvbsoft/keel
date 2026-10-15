'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const market = json('.claude-plugin/marketplace.json');
const plugin = json('plugins/keel/.claude-plugin/plugin.json');
const entry = market.plugins.find((p) => p.name === plugin.name);

test('the marketplace lists the plugin under the same name', () => {
  assert.ok(entry, 'plugin entry missing from marketplace.json');
  assert.equal(entry.source, './plugins/keel');
  assert.equal(
    entry.version,
    undefined,
    'a version in the marketplace entry would be overridden silently by plugin.json',
  );
});

test('the plugin version is SemVer and the marketplace metadata matches it', () => {
  assert.match(plugin.version, SEMVER);
  assert.equal(market.metadata.version, plugin.version);
});

test('CHANGELOG.md has a heading for the plugin version', () => {
  const lines = read('CHANGELOG.md').split(/\r?\n/);
  assert.ok(lines.some((l) => l.startsWith(`## [${plugin.version}]`)), `no heading for ${plugin.version}`);
});

test('homepage and repository are https URLs', () => {
  for (const url of [plugin.homepage, plugin.repository, market.owner.url, plugin.author.url, entry.homepage]) {
    assert.equal(new URL(url).protocol, 'https:', url);
  }
});
