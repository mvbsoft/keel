'use strict';
// UserPromptSubmit hook: a command the user types runs without the Skill tool, so skill-gate.js does not
// see it. A typed command of the other lane (scripts/lib/lanes.js) is blocked here, with the reason shown
// to the user in the conversation language. Claude Code reads a command only at the very start of the
// prompt, case as written, and runs a bare name (/start-task) as keel's command when no other command has
// it; both forms are read the same way, so the user's own /cleanup is refused in a planning conversation
// too. Only in a project keel is set up in. Fails soft: never blocks a prompt on an error.
const fs = require('node:fs');

const COMMAND = /^\/(?:keel:)?([a-z][a-z-]*)(?=\s|$)/;

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const m = COMMAND.exec(String(input.prompt || ''));
  if (!m) return null;
  const lanes = require('../scripts/lib/lanes.js');
  if (!lanes.COMMANDS.has(m[1])) return null;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!require('../scripts/lib/active.js').configured(project)) return null;
  const language = require('../scripts/lib/options.js').effectiveOptions(project).conversation_language;
  const reason = lanes.refusalText(project, input.session_id, m[1], language);
  return reason && { decision: 'block', reason };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
