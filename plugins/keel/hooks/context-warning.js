'use strict';
// UserPromptSubmit hook: warns before Claude Code auto-compacts the conversation, so the user can run
// /compact with a focus or start a new session first. Only in a project keel is set up in. Fails soft: never blocks a prompt.
const fs = require('node:fs');
const path = require('node:path');
const { pickLanguage, translator } = require('../scripts/lib/i18n.js');
const { readJsonFile } = require('../scripts/lib/json.js');

const TAIL_BYTES = 512 * 1024;
// Warn at 90 %: still room for a /compact (it needs context for its own summary) and for a few more turns.
const WARN_AT = 0.9;
const WINDOW_MIN = 100000;
const WINDOW_MAX = 1000000;
// Claude Code compacts at the model's window minus a reserve: about 967k for a 1M window.
const WINDOW_1M = 967000;
const WINDOW_STANDARD = 200000;
// Known 200k models: Haiku, Claude 3.x, and Opus and Sonnet 4 up to 4.5 (4, 4-1, 4-5, with an optional date).
const STANDARD_MODEL = /haiku|claude-3|(opus|sonnet)-4(-[0-5])?(-\d{8})?$/;

function readJson(file) {
  try { return readJsonFile(file); } catch { return {}; }
}

// Last bytes of the transcript as whole lines (the first one may be cut, so it is dropped).
function tailLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    fs.closeSync(fd);
  }
}

// Context in use = the whole prompt of the latest API response: new, cache-written and cache-read input tokens.
// Subagent entries (isSidechain) have their own context, so they do not count. /compact keeps the old rows
// and then writes a compact_boundary row: what came before it no longer counts.
function latestUsage(lines) {
  let latest = null;
  let peak = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry && entry.type === 'system' && entry.subtype === 'compact_boundary') {
      latest = null;
      peak = 0;
      continue;
    }
    const usage = entry && entry.type === 'assistant' && !entry.isSidechain && entry.message && entry.message.usage;
    if (!usage) continue;
    const used = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
    if (!used) continue;
    latest = { used, model: entry.message.model || '' };
    peak = Math.max(peak, used);
  }
  return latest && { ...latest, peak };
}

// The window a settings file sets: a per-model value wins over the top-level key. 'auto' is a choice too
// (no custom window); anything else invalid is ignored.
function windowIn(settings, model) {
  const perModel = settings.modelSettings && settings.modelSettings[model];
  for (const value of [perModel && perModel.autoCompactWindow, settings.autoCompactWindow]) {
    if (value === 'auto') return 'auto';
    if (Number.isInteger(value) && value >= WINDOW_MIN && value <= WINDOW_MAX) return value;
  }
  return undefined;
}

// Claude Code clamps a custom window to at least 100k and at most the model's own window.
function threshold(info, project) {
  const own = modelWindow(info);
  const custom = customWindow(info, project);
  return custom === undefined ? own : Math.min(own, Math.max(WINDOW_MIN, custom));
}

function customWindow({ model }, project) {
  const fromEnv = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (/^\d+$/.test(fromEnv || '') && Number(fromEnv) > 0) return Number(fromEnv);
  const files = [
    path.join(project, '.claude', 'settings.local.json'),
    path.join(project, '.claude', 'settings.json'),
    // Required here, not at the top, so a broken import still ends in the silent catch below.
    require('../scripts/claude-settings.js').userFile(),
  ];
  for (const file of files) {
    const value = windowIn(readJson(file), model);
    if (value === 'auto') break;
    if (value !== undefined) return value;
  }
  return undefined;
}

function modelWindow({ model, peak }) {
  // shortcut: the transcript does not say which window the model has. Claude Code docs: the 4.x models
  // without [1m] compact at 200k; current Opus and Sonnet (4.6 and later) have a native 1M window. Haiku is
  // taken as 200k (an early warning, never a missed one). Redo when the hook input carries the model's window.
  const standard = STANDARD_MODEL.test(model) && !model.endsWith('[1m]');
  return standard && peak <= WINDOW_STANDARD ? WINDOW_STANDARD : WINDOW_1M;
}

function warning(used, limit) {
  const [usedK, limitK] = [used, limit].map((n) => `${Math.round(n / 1000)}k`);
  return translator(pickLanguage())('context.warning', { used: usedK, limit: limitK, percent: Math.round((used / limit) * 100) });
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!input.transcript_path) return null;
  const usage = latestUsage(tailLines(input.transcript_path));
  if (!usage) return null;
  const project = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (!require('../scripts/lib/active.js').configured(project)) return null;
  const limit = threshold(usage, project);
  if (usage.used < limit * WARN_AT) return null;
  const line = warning(usage.used, limit);
  // systemMessage is for the user, but whether UserPromptSubmit shows it is not documented; the model is
  // asked to repeat the line, so the user sees it either way.
  return {
    systemMessage: line,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `Start your reply with this one line for the user, word for word, then answer as usual: ${line}`,
    },
  };
}

let result;
try { result = main(); } catch { result = null; }
if (result) process.stdout.write(JSON.stringify(result));
process.exit(0);
