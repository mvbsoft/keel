'use strict';
// PreToolUse hook on Skill: in a project keel is not set up in (scripts/lib/active.js), keel's skills
// are refused, so the model uses its own knowledge or another skill there. /keel:configure and
// /keel:help stay available to set keel up. Fails soft: any error lets the skill run.
const fs = require('node:fs');

const ALWAYS = new Set(['configure', 'help']);

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const args = input.tool_input || {};
  const name = String(args.skill || args.command || args.name || '').replace(/^\//, '');
  if (!name.startsWith('keel:') || ALWAYS.has(name.slice(5))) return null;
  if (require('../scripts/lib/active.js').configured(process.env.CLAUDE_PROJECT_DIR || input.cwd)) return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'keel is not set up in this project, so its skills do not run here; go on without it. The user can set keel up with /keel:configure.' } };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
