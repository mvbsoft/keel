'use strict';
// PreToolUse hook on SubagentHandback: in auto mode Claude Code gives subagents this tool, and a keel
// agent's report arrives as its `message` input instead of the agent's last text. The report is saved
// where hooks/ledger.js saves a text reply (its own folder in a planning conversation), so the
// verification scripts read the real findings.
// Runs only in projects that have a .keel/ folder. Never blocks, prints nothing, fails soft.
const fs = require('node:fs');
const path = require('node:path');
const { saveReply } = require('./ledger.js');

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const message = input.tool_input && input.tool_input.message;
  if (input.tool_name !== 'SubagentHandback' || typeof message !== 'string' || !input.agent_id) return;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!project || !fs.existsSync(path.join(project, '.keel'))) return;
  saveReply(project, String(input.agent_type || ''), String(input.agent_id).replace(/[^A-Za-z0-9_-]/g, ''), message, { session: String(input.session_id || '') });
}

try { main(); } catch { /* never disturb the agent */ }
process.exit(0);
