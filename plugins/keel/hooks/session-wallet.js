'use strict';
// SessionStart hook: notes which wallet (subscription, api or credit) a session pays from, one line per start, resume or
// clear (a clear starts a new session id) in <usageDir>/sessions.jsonl. The usage calculator joins it with
// the transcripts. Runs in every project.
// Prints nothing, never blocks, fails soft.
const fs = require('node:fs');
const path = require('node:path');
const { usageDir, loadMachineConfig, detectWallet } = require('../scripts/lib/usage-config.js');

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  // A compact keeps the session id, so it is not a new session.
  if (!['startup', 'resume', 'clear'].includes(input.source)) return;
  if (!input.session_id) return;
  const machine = loadMachineConfig();
  const line = {
    session_id: String(input.session_id),
    wallet: detectWallet({ projectDir: input.cwd, machine }),
    pc: machine.pc,
    user: machine.user,
    entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT || null,
    started: new Date().toISOString(),
  };
  const dir = usageDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'sessions.jsonl'), JSON.stringify(line) + '\n');
  // The status-line shim (usage-setup.js install-statusline) runs keel from the current plugin folder.
  if (fs.existsSync(path.join(dir, 'statusline.js'))) {
    fs.writeFileSync(path.join(dir, 'plugin-root.txt'), process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
  }
}

try { main(); } catch { /* never disturb the session */ }
process.exit(0);
