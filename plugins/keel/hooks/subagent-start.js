'use strict';
// SubagentStart hook: gives keel's implementer the working standards (hooks/standards.md, without the rules
// for talking to the user) and the project's code-comment rules. A subagent does not receive what the
// SessionStart hook adds to the main session; Claude Code injects this context again after the implementer's
// conversation is compacted. Other agents get nothing. Fails soft.
const fs = require('node:fs');
const path = require('node:path');
const { commentRules } = require('./comment-rules.js');
const { standards } = require('./standards.js');

const AGENTS = new Set(['keel:implementer']);

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (!AGENTS.has(String(input.agent_type || ''))) return null;
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const context = `${standards(root, { implementer: true })}
${commentRules(root, project)}`;
  return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: context } };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
