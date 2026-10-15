'use strict';
// PreToolUse hook on Agent: decides the model of every keel agent before it starts.
// - keel never runs Fable, whatever the main session runs on;
// - an agent without an explicit model would inherit the session's model, so it gets Sonnet;
// - with "Allow Opus for agents" off, Opus becomes Sonnet.
// - in a project keel has not started in (no .keel/ folder), keel's agents are refused, so a request
//   such as "review this" there uses another agent.
// Agents of other plugins and the user's own agents are left alone. Fails soft.
const fs = require('node:fs');
const path = require('node:path');


function frontmatterModel(pluginRoot, agentName) {
  if (!/^[a-z0-9-]+$/.test(agentName)) return null;
  let text;
  try { text = fs.readFileSync(path.join(pluginRoot, 'agents', `${agentName}.md`), 'utf8'); } catch { return null; }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = fm && /^model:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(fm[1]);
  return m ? m[1] : null;
}

// Returns [model to use, reason] or null when the requested model stays.
function decide(requested, allowOpus) {
  const model = (requested || '').toLowerCase();
  if (!model || model === 'inherit') return ['sonnet', 'it has no model of its own and would inherit the session model'];
  if (model.includes('fable')) return allowOpus ? ['opus', 'keel never runs Fable'] : ['sonnet', 'keel never runs Fable and "Allow Opus for agents" is off'];
  if (model.includes('opus') && !allowOpus) return ['sonnet', '"Allow Opus for agents" is off'];
  return null;
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const toolInput = input.tool_input || {};
  const type = String(toolInput.subagent_type || '');
  if (!type.startsWith('keel:')) return null;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (!require('../scripts/lib/active.js').started(project)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `keel is not set up in this project, so its agents do not run here. Use another agent (for example general-purpose); the user can set keel up with /keel:configure.` } };
  }
  const allowOpus = require('../scripts/lib/options.js').effectiveOptions(project).allow_opus;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..');
  const requested = toolInput.model || frontmatterModel(pluginRoot, type.slice('keel:'.length));
  const change = decide(requested, allowOpus);
  if (!change) return null;
  const [model, reason] = change;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      updatedInput: { ...toolInput, model },
      additionalContext: `keel: ${type} runs on ${model} because ${reason}.`,
    },
  };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
