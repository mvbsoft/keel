'use strict';
// Temporary folders for the tests. Each test file runs in its own process, so what is made or
// registered here is removed when that process exits: no test context is needed, which fixtures do not have.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = [];

// A file or folder a test made itself: removed at exit too.
function tempPath(p) {
  made.push(p);
  return p;
}

function tempDir(prefix) {
  return tempPath(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

process.on('exit', () => {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* in use: the OS clears Temp later */ }
  }
});

module.exports = { tempDir, tempPath };
