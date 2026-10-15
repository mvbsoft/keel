'use strict';
// SessionStart hook: gives the model keel's working standards (hooks/standards.md), tells it which language to
// talk and write plans in, and the project's code-comment rules (the only thing it reads from the project
// config; keel commands check the config when they run). Warns about an old Node on a fresh start only.
// Adds nothing in a project keel is not set up in (scripts/lib/active.js). Fails soft: never blocks a session.
const fs = require('node:fs');
const path = require('node:path');
const { commentRules } = require('./comment-rules.js');
const { standards } = require('./standards.js');
const { pickLanguage, translator } = require('../scripts/lib/i18n.js');
const { effectiveOptions } = require('../scripts/lib/options.js');

const MIN_NODE = 22;

// The code alone can be misread ("uk" as UK English): give the language's English name with it.
function languageName(code) {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.replace(/_/g, '-'));
    return name && name.toLowerCase() !== code.toLowerCase() ? `${name} (${code})` : code;
  } catch { return code; }
}

function main() {
  let source = '';
  let sessionId = '';
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    source = String(input.source || '');
    sessionId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.session_id) ? input.session_id : '';
  } catch { /* no input: treat as a start */ }
  const root = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!require('../scripts/lib/active.js').configured(project)) return null;
  const language = effectiveOptions(project).conversation_language;
  // The other keel scripts need Node 22: say so once, on a fresh start.
  const oldNode = Number(process.versions.node.split('.')[0]) < MIN_NODE && (source === 'startup' || !source);
  return {
    ...(oldNode && { systemMessage: translator(pickLanguage())('start.old_node', { min: MIN_NODE, found: process.versions.node }) }),
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${standards(root)}
keel: talk to the user and write plans in this language: ${languageName(language)}. If the user explicitly asks for another language in this session, use that one for this session only. Code, paths, commands and technical names stay as they are.${sessionId ? `
keel session id (for --session): ${sessionId}` : ''}

${commentRules(root, project)}`,
    },
  };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
