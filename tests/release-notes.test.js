'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'release-notes.awk');
const hasAwk = (() => { try { execFileSync('awk', ['BEGIN {}'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function notes(version, file) {
  return execFileSync('awk', ['-v', `h=## [${version}]`, '-f', SCRIPT, file], { encoding: 'utf8' });
}

test('release notes: the version section only, wrapped list items joined into one line', (t) => {
  if (!hasAwk) { t.skip('awk is not installed'); return; }
  const dir = tempDir('release-notes-');
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.1.0] - 2026-11-01',
    '',
    'A short summary.',
    '',
    '### Added',
    '- First item that is wrapped',
    '  over two lines, see [docs](docs/a.md).',
    '- Second item on one line.',
    '- Third item',
    '  - nested item that is',
    '    wrapped too',
    '',
    '### Fixed',
    '- A fix wrapped',
    '  over',
    '  three lines.',
    '',
    '## [1.0.0] - 2026-10-15',
    '- Older item.',
    '',
    '[1.1.0]: https://example.com/v1.1.0',
    '',
  ].join('\n'));
  try {
    assert.equal(notes('1.1.0', file), [
      '',
      'A short summary.',
      '',
      '### Added',
      '- First item that is wrapped over two lines, see [docs](docs/a.md).',
      '- Second item on one line.',
      '- Third item',
      '  - nested item that is wrapped too',
      '',
      '### Fixed',
      '- A fix wrapped over three lines.',
      '',
      '',
    ].join('\n'));
    assert.equal(notes('9.9.9', file), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release notes: CHANGELOG.md has one line per list item for the plugin version', (t) => {
  if (!hasAwk) { t.skip('awk is not installed'); return; }
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/keel/.claude-plugin/plugin.json'), 'utf8'));
  const out = notes(version, path.join(ROOT, 'CHANGELOG.md'));
  const lines = out.split('\n');
  assert.ok(lines.some((l) => l.startsWith('- ')), `no list items for ${version}`);
  assert.deepEqual(lines.filter((l) => /^ {2}\S/.test(l)), [], 'wrapped continuation lines remain');
  assert.deepEqual(lines.filter((l) => /^\[[^\]]+\]: /.test(l) || l.startsWith('## [')), []);
});
