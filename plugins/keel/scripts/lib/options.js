'use strict';
// keel's own options that have a machine value and may have a value for one project. The machine
// value of conversation_language and allow_opus is the plugin option (Claude Code keeps plugin options
// for the whole machine only, even for a plugin installed in one project; it passes them as
// CLAUDE_PLUGIN_OPTION_*); prompt_preview's is in ~/.claude/keel/usage.json. A project value lives in
// <project>/.keel/local/options.json (personal, outside git) and wins over the machine value.
const path = require('node:path');
const { readJsonFile } = require('./json.js');

const OPTIONS = {
  conversation_language: { valid: (v) => typeof v === 'string' && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(v) },
  allow_opus: { valid: (v) => typeof v === 'boolean' },
  prompt_preview: { valid: (v) => typeof v === 'boolean' },
};
const OFF = new Set(['false', '0', 'no', 'off']);

const file = (root) => path.join(root, '.keel', 'local', 'options.json');

function projectOptions(root) {
  if (!root) return {};
  try {
    const raw = readJsonFile(file(root));
    return Object.fromEntries(Object.entries(raw || {}).filter(([k, v]) => OPTIONS[k] && OPTIONS[k].valid(v)));
  } catch { return {}; }
}

// The values that apply in a project, and where each came from.
function effectiveOptions(root = process.env.CLAUDE_PROJECT_DIR, env = process.env) {
  const own = projectOptions(root);
  const machine = {
    conversation_language: (env.CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE || '').trim() || 'en',
    allow_opus: !OFF.has((env.CLAUDE_PLUGIN_OPTION_ALLOW_OPUS || 'true').trim().toLowerCase()),
  };
  const out = {};
  for (const key of ['conversation_language', 'allow_opus']) {
    out[key] = key in own ? own[key] : machine[key];
    out[`${key}_from`] = key in own ? 'project' : 'machine';
  }
  return out;
}

// Writes the given project values; null removes one (the machine value applies again).
function writeProjectOptions(root, changes) {
  const bad = Object.entries(changes).filter(([k, v]) => !OPTIONS[k] || (v !== null && !OPTIONS[k].valid(v))).map(([k]) => k);
  if (bad.length) throw new Error(`keel does not write these project options (unknown key or bad value): ${bad.join(', ')}`);
  const next = { ...projectOptions(root) };
  for (const [k, v] of Object.entries(changes)) if (v === null) delete next[k]; else next[k] = v;
  require('./safe-path.js').safeLocalWrite(root, 'options.json', `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

module.exports = { OPTIONS, projectOptions, effectiveOptions, writeProjectOptions, optionsFile: file };
