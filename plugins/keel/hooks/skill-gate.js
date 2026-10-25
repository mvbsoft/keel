'use strict';
// PreToolUse hook on Skill: in a project keel is not set up in (scripts/lib/active.js), keel's skills
// are refused, so the model uses its own knowledge or another skill there. /keel:configure,
// /keel:help and /keel:usage (machine-wide) stay available. A skill of the other lane, also by its bare
// name, is refused in a conversation that plans or works on a task (scripts/lib/lanes.js). Fails soft: any error lets the skill run.
const fs = require('node:fs');

const ALWAYS = new Set(['configure', 'help', 'usage']);

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const args = input.tool_input || {};
  const name = String(args.skill || args.command || args.name || '').replace(/^\//, '');
  const lanes = require('../scripts/lib/lanes.js');
  // A bare name (start-task) may run keel's skill, as a typed one does: the lanes count it as keel's.
  const bare = lanes.COMMANDS.has(name);
  if (!name.startsWith('keel:') && !bare) return null;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  // The reason goes to the model, which tells the user: English.
  const lane = lanes.refusalText(project, input.session_id, bare ? name : name.slice(5), 'en');
  if (lane) return deny(lane);
  if (bare || ALWAYS.has(name.slice(5))) return null;
  if (require('../scripts/lib/active.js').configured(project)) return null;
  return deny('keel is not set up in this project, so its skills do not run here; go on without it. The user can set keel up with /keel:configure.');
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
