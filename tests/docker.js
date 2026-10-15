'use strict';
// Runs the test suite in a throwaway container on the minimum supported Node version.
// The repository is mounted read-only; the image must already be present (no pulls).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const IMAGE = process.env.KEEL_TEST_IMAGE || 'node:22-alpine';
const repo = path.resolve(__dirname, '..');
const args = ['run', '--rm', '--pull', 'never', '--network', 'none',
  '-v', `${repo}:/work:ro`, '-w', '/work', IMAGE, 'node', '--test', 'tests/**/*.test.js'];
const r = spawnSync('docker', args, { stdio: 'inherit' });
if (r.error) { console.error(`docker failed to start: ${r.error.message}`); process.exit(2); }
process.exit(r.status ?? 1);
