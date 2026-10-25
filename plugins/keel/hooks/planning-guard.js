'use strict';
// PreToolUse hook on Edit, Write, NotebookEdit, Bash and PowerShell: while the conversation plans a
// feature (its chat mark, scripts/lib/plans.js), project files stay unchanged. Allowed: the feature's
// draft folder, the planning settings, keel's working files in .keel/local/tmp/, Claude Code's Plan Mode
// files in .keel/local/plans/claude/ (Plan Mode writes its plan with Write and Edit) and anything outside
// the project (memory, temporary files). A safeguard against slips, not a wall: shell commands are read
// with skill-hints.js shell(), which sees redirections, sed -i, cp and mv and PowerShell's write
// cmdlets, but not rm, git checkout, node -e and the like; keel's own scripts write only their own files.
// Fails soft.
const fs = require('node:fs');
const path = require('node:path');
const { validSid } = require('../scripts/lib/ids.js');

const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const within = (file, place) => fold(norm(file)) === fold(norm(place)) || fold(norm(file)).startsWith(`${fold(norm(place))}/`);

// The places a planning conversation may write in the project.
function allowedPlaces(root, feature) {
  const local = path.join(root, '.keel', 'local');
  const draft = require('../scripts/lib/plans.js').listDrafts(root).find((d) => d.feature === feature);
  return [
    ...(draft ? [draft.folder] : []),
    path.join(local, 'plans', 'keel', 'settings.json'),
    path.join(local, 'tmp'),
    path.join(local, 'plans', 'claude'),
  ];
}

// The files the tool call writes, as absolute paths.
function written(tool, args, cwd) {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const { shell } = require('./skill-hints.js');
    return shell(String(args.command || ''), cwd).uses.filter((u) => u.tool !== 'Read').map((u) => u.file);
  }
  const file = tool === 'NotebookEdit' ? args.notebook_path : args.file_path;
  return typeof file === 'string' ? [path.resolve(cwd, file)] : [];
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  const sid = input.session_id;
  // Most conversations do not plan: one file check before anything is loaded.
  if (!root || !validSid(sid) || !fs.existsSync(path.join(root, '.keel', 'local', 'plans', 'keel', 'sessions', `${sid}.json`))) return null;
  const feature = require('../scripts/lib/plans.js').planningMark(root, sid);
  if (!feature) return null;
  const places = allowedPlaces(root, feature);
  const blocked = written(input.tool_name, input.tool_input || {}, input.cwd || root)
    .find((f) => within(f, root) && !places.some((p) => within(f, p)));
  if (!blocked) return null;
  const file = path.relative(root, blocked).split(path.sep).join('/');
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `keel: this conversation plans ${feature}, so ${file} stays unchanged. This is planning; to change code, start a task in a new conversation.`,
    },
  };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
