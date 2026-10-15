'use strict';
// A project that used another notes system: the product is called Orbit and the old tool kept its
// state in a git-ignored `.orbit/` folder, like the real projects keel's migration was designed on.
// It has a note, memory over the 150-line limit, session logs, a config, a secret, project data,
// one-off scripts, and leftovers for cleanup. Written to a temporary folder on demand.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CANARY } = require('./projects.js');

const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

function files(commit) {
  return {
    'package.json': JSON.stringify({ name: 'orbit-shop', private: true, scripts: { test: 'node --test test/' } }, null, 2) + '\n',
    'src/orbit.js': "'use strict';\n// Orbit: prices for the shop.\nconst ORBIT_API_URL = process.env.ORBIT_API_URL || 'https://api.orbit.example.com';\nexports.total = (items) => items.reduce((n, i) => n + i.price, 0);\nexports.url = ORBIT_API_URL;\n",
    'test/orbit.test.js': "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst { total } = require('../src/orbit.js');\ntest('total', () => assert.equal(total([{ price: 2 }, { price: 3 }]), 5));\n",
    'README.md': '# Orbit shop\n\nOrbit sells parts. The orbit-core module is `src/orbit.js`; set ORBIT_API_URL for another API.\n',
    'CLAUDE.md': [
      '# Orbit shop',
      '',
      '- Tests: `npm test`.',
      '- Before ending a session run /orbit:handoff; it writes the note to .orbit/next-session.md.',
      '- Session logs live in `.orbit/sessions/`; project memory in .orbit/memory/project-memory.md.',
      '- The Orbit API base URL comes from ORBIT_API_URL; deploys go to orbit.example.com.',
      '- Start each session with /orbit:resume.',
      '',
    ].join('\n'),
    'docs/setup.md': '# Setup\n\nInstall, then `npm test`. The Orbit dashboard lives at app.orbit.example.com.\nOld notes: see ./.orbit/memory/ (kept by the notes tool).\n',
    '.gitignore': 'node_modules/\n.orbit/\n.pytest_cache/\n',
    '.orbit/config.yml': 'test_command: npm test\nlanguage: uk\nai_attribution: false\ncommand_prefix: /orbit:\n',
    '.orbit/next-session.md': `# Next session\n\nLast commit: ${commit || '0000000'}\n\n## Goal\nAdd discounts to totals.\n\n## Done\n- total() works\n\n## Next\n- discount codes\n- tests for discounts\n`,
    '.orbit/memory/project-memory.md': lines(213, (i) => `- fact ${i}: the shop keeps prices in cents (note ${i})`),
    '.orbit/memory/archive.md': lines(20, (i) => `- old decision ${i}`),
    '.orbit/sessions/2026-09-01-001.md': '# Session 1\n- built total()\n',
    '.orbit/sessions/2026-09-02-002.md': '# Session 2\n- added tests\n',
    '.orbit/sessions/2026-09-03-003.md': '# Session 3\n- api url from env; password: hunter2hunter2\n',
    '.orbit/cloud-keys.env': `ORBIT_CLOUD_KEY=${CANARY}\n`,
    '.orbit/runs/run-1.jsonl': '{"step":1}\n',
    '.orbit/runs/run-2.jsonl': '{"step":2}\n',
    '.orbit/fix_prices_0923.py': 'print("one-off")\n',
    '.orbit/adr/0001-cents.md': '# Prices in cents\n',
    '.orbit/notes/idea.md': '# An idea\n',
    // Leftovers for cleanup.
    'src/orbit.js.bak': 'old copy\n',
    'notes-draft.txt': 'draft, mentioned nowhere\n',
    '.DS_Store': 'x',
    '.pytest_cache/v/cache/lastfailed': '{}\n',
    '.claude/settings.local.json': '{}\n',
    '.claude/settings.local.json.keel-backup-20260901T000000': '{}\n',
    '.keel/local/tmp/old-scan.json': '{}\n',
  };
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// Returns { root, userSettings }. With git: one commit of the tracked files, then the note names it.
function makeOldSystem() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-orbit-'));
  const write = (all) => {
    for (const [rel, content] of Object.entries(all)) {
      fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
  };
  write(files(null));
  let commit = null;
  if (hasGit()) {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'dev@orbit.test');
    git('config', 'user.name', 'Dev');
    git('config', 'core.autocrlf', 'false');
    git('add', 'package.json', 'src/orbit.js', 'test/orbit.test.js', 'README.md', 'CLAUDE.md', 'docs/setup.md', '.gitignore');
    git('commit', '-q', '-m', 'Orbit shop');
    commit = git('rev-parse', '--short', 'HEAD');
    fs.writeFileSync(path.join(root, 'src/extra.js'), 'exports.x = 1;\n');
    git('add', 'src/extra.js');
    git('commit', '-q', '-m', 'Extra');
    write({ '.orbit/next-session.md': files(commit)['.orbit/next-session.md'] });
  }
  // The temporary file is two days old, so cleanup counts it as safe.
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(root, '.keel/local/tmp/old-scan.json'), old, old);
  const userSettings = path.join(root, '..', `${path.basename(root)}-user-settings.json`);
  fs.writeFileSync(userSettings, JSON.stringify({ enabledPlugins: { 'orbit@orbit-tools': true, 'keel@keel': true, 'other@market': false } }));
  return { root, userSettings, git: commit !== null };
}

module.exports = { makeOldSystem, hasGit };
