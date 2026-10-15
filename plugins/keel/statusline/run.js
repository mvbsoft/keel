'use strict';
// keel's status line. The installed command is node "~/.claude/keel/statusline.js", a shim that loads this
// file from the plugin folder in plugin-root.txt (scripts/usage-setup.js install-statusline).
// 1. Prints the status line: the user's previous command in 'wrap' mode, otherwise the vendored script.
//    The child's stdout goes out byte for byte.
// 2. After printing, records the plan-limit percentages from the same input (scripts/lib/limits.js).
// A failing recorder never changes or delays the printed line; the exit code is always 0.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TIMEOUT_MS = 5000;

function readStdin() {
  try { return fs.readFileSync(0); } catch { return Buffer.alloc(0); }
}

// usage.json is read directly: loadMachineConfig() may run git, too slow for a line drawn this often.
function statuslineConfig(dir) {
  try {
    const s = require('../scripts/lib/json.js').readJsonFile(path.join(dir, 'usage.json')).statusline;
    return s && typeof s === 'object' ? s : {};
  } catch { return {}; }
}

function runChild(input, cfg) {
  const opts = { input, timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] };
  const original = cfg.original && typeof cfg.original.command === 'string' ? cfg.original.command.trim() : '';
  if (cfg.mode === 'wrap' && original) return spawnSync(original, { ...opts, shell: true });
  if (process.platform === 'win32') {
    return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'statusline.ps1')], opts);
  }
  return spawnSync('bash', [path.join(__dirname, 'statusline.sh')], opts);
}

function writeOut(buf) {
  let off = 0;
  while (off < buf.length) {
    try { off += fs.writeSync(1, buf, off); } catch (e) { if (e.code !== 'EAGAIN') return; }
  }
}

function main() {
  const { usageDir } = require('../scripts/lib/usage-config.js');
  const input = readStdin();
  let r = null;
  try { r = runChild(input, statuslineConfig(usageDir())); } catch { /* nothing to print */ }
  if (r && !r.error && Buffer.isBuffer(r.stdout) && r.stdout.length) writeOut(r.stdout);
  try {
    const { recordSnapshot } = require('../scripts/lib/limits.js');
    recordSnapshot(JSON.parse(input.toString('utf8')), { src: 'statusline' });
  } catch { /* the line is already printed */ }
}

try { main(); } catch { /* never fail the status line */ }
process.exit(0);
