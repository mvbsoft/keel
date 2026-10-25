'use strict';
// configure sections 1 and 10: the settings keel recommends, for the machine and for one project.
// Every key has a home: the machine only (statusLine), the project only (plansDirectory,
// permissions.allow), or both, where a project value wins over the machine value. `show` reads the
// machine's user settings and the project's local settings (personal, outside git) and says, per key,
// what is set at each level, what applies and what keel recommends. `apply` writes only the keys listed
// in KEYS, merging into the existing file (other keys stay as they are) after a backup copy: the project
// file's in <project>/.keel/local/backups/, the machine file's next to it. keel's own options
// (conversation_language, allow_opus, prompt_preview) go, for a project, to .keel/local/options.json:
// Claude Code keeps plugin options for the whole machine only. keel lets `show` run without a prompt;
// Claude Code asks the user before `apply` and `move-plans` run.
// Usage: node claude-settings.js <projectDir> show
//        node claude-settings.js <projectDir> apply <changes.json>
//        node claude-settings.js <projectDir> move-plans   Plan Mode files keel's older plansDirectory
//                                                           left in .keel/local/plans/ go to its claude/
//   changes.json: { "user": { "<key>": value }, "project": { "<key>": value } }; in "project", null
//   removes the project's value, so the machine value applies again.
// The user settings file is ~/.claude/settings.json ($CLAUDE_CONFIG_DIR when set); KEEL_USER_SETTINGS
// points it elsewhere (tests).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs } = require('./lib/project.js');
const { projectOptions, writeProjectOptions, optionsFile } = require('./lib/options.js');
const { loadMachineConfig } = require('./lib/usage-config.js');
const { readJsonFile } = require('./lib/json.js');
const { safeLocalPath } = require('./lib/safe-path.js');

// Keys a project may set for itself over the machine value (sources: settings-reference.md in the
// Claude Code docs, where each of these has the scope "any file"; numbers: the owner's choices).
// `was`: what older keel versions recommended, so configure check can name a recommendation that changed.
const BOTH = {
  showClearContextOnPlanAccept: { recommended: true, why: 'approving a plan can clear the planning context and start from the plan alone' },
  autoCompactWindow: { recommended: 300000, why: 'compact at about 300k tokens instead of about 967k: each request in a long session re-reads less' },
  bashOutputMaxChars: { recommended: 15000, why: 'longer command output goes to a file with a preview instead of the conversation' },
  attribution: { recommended: { commit: '', pr: '', sessionUrl: false }, why: 'no AI attribution in commits and pull requests' },
  conversation_language: { option: true, why: 'the language keel talks and plans in' },
  allow_opus: { option: true, why: 'off: keel agents that would run on Opus run on Sonnet' },
};
const KEYS = {
  user: {
    ...BOTH,
    statusLine: { why: 'the keel status line (or a wrapper around yours) records plan-limit percentages for the cost report' },
  },
  project: {
    ...BOTH,
    prompt_preview: { option: true, why: 'send the first 100 characters of each request to the usage page (the machine value is in usage.json)' },
    plansDirectory: { recommended: './.keel/local/plans/claude', was: ['./.keel/local/plans'], why: 'Plan Mode files stay in the project, outside git, in their own folder beside the planning drafts (.keel/local/plans/keel)' },
    'permissions.allow': { list: true, why: 'the gate commands run without a prompt, also in parallel agents' },
  },
};
const PLUGIN_OPTIONS = new Set(['conversation_language', 'allow_opus']);
const KEEL_OPTIONS = new Set(['conversation_language', 'allow_opus', 'prompt_preview']);
const homeOf = (key) => (KEYS.user[key] && KEYS.project[key] ? 'machine or project' : KEYS.user[key] ? 'machine' : 'project');

function userFile() {
  if (process.env.KEEL_USER_SETTINGS) return process.env.KEEL_USER_SETTINGS;
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}
const projectFile = (root) => path.join(root, '.claude', 'settings.local.json');

function readJson(file) {
  if (!fs.existsSync(file)) return { exists: false, value: {} };
  const value = readJsonFile(file);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file} is not a JSON object`);
  return { exists: true, value };
}

// keel's id in the settings: the enabled keel@<marketplace>, else keel@keel.
function keelId(settings) {
  const ids = [...Object.keys(settings.enabledPlugins || {}), ...Object.keys(settings.pluginConfigs || {})];
  return ids.find((id) => id.startsWith('keel@')) || 'keel@keel';
}

function current(settings, key) {
  if (PLUGIN_OPTIONS.has(key)) {
    const cfg = (settings.pluginConfigs || {})[keelId(settings)];
    return cfg && cfg.options ? cfg.options[key] : undefined;
  }
  if (key === 'permissions.allow') return (settings.permissions || {}).allow;
  return settings[key];
}

// Plan Mode files in .keel/local/plans/ itself: Claude Code wrote them there while plansDirectory was
// keel's older ./.keel/local/plans. keel's own planning files live in subfolders, never at this level.
function oldPlans(root) {
  try { return fs.readdirSync(safeLocalPath(root, 'plans'), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort(); } catch { return []; }
}

// Moves them into claude/; a name already there stays where it is.
function movePlans(root) {
  const from = safeLocalPath(root, 'plans');
  const to = safeLocalPath(root, 'plans', 'claude');
  const moved = [];
  const kept = [];
  const names = oldPlans(root);
  if (names.length) fs.mkdirSync(to, { recursive: true });
  for (const name of names) {
    if (fs.existsSync(path.join(to, name))) { kept.push(name); continue; }
    fs.renameSync(path.join(from, name), path.join(to, name));
    moved.push(name);
  }
  return { moved, kept };
}

function show(root) {
  const user = readJson(userFile());
  const project = readJson(projectFile(root));
  const own = projectOptions(root);
  const rows = [];
  for (const [scope, keys] of Object.entries(KEYS)) {
    for (const [key, spec] of Object.entries(keys)) {
      const now = scope === 'user' ? current(user.value, key) : KEEL_OPTIONS.has(key) ? own[key] : current(project.value, key);
      const row = { scope, key, home: homeOf(key), now, recommended: spec.recommended, why: spec.why };
      if (spec.recommended !== undefined) row.matches = JSON.stringify(now) === JSON.stringify(spec.recommended);
      if (scope === 'project' && (KEYS.user[key] || key === 'prompt_preview')) {
        row.machine = key === 'prompt_preview' ? loadMachineConfig().prompt_preview : current(user.value, key);
        row.applies = now !== undefined ? 'project' : 'machine';
      }
      rows.push(row);
    }
  }
  const perModel = Object.entries(user.value.modelSettings || {}).filter(([, v]) => v && v.autoCompactWindow !== undefined).map(([m, v]) => `${m}: ${v.autoCompactWindow}`);
  return { user_file: userFile(), project_file: projectFile(root), options_file: optionsFile(root), rows, per_model_compact: perModel, old_plans: oldPlans(root) };
}

function report(r) {
  const out = [`machine settings (every project on this machine): ${r.user_file}`,
    `project settings (this project only, personal, outside git): ${r.project_file}; keel's own options: ${r.options_file}`];
  const value = (v) => (v === undefined ? 'not set' : Array.isArray(v) ? `${v.length} rules` : JSON.stringify(v));
  for (const row of r.rows) {
    let line = `- ${row.scope} ${row.key} [${row.home}]: ${value(row.now)}`;
    if (row.applies) line += row.applies === 'project' ? ' (wins over the machine value)' : ` (the machine value applies: ${value(row.machine)})`;
    else if (row.recommended !== undefined) line += row.matches ? ' (as keel recommends)' : ` | keel recommends ${JSON.stringify(row.recommended)}`;
    out.push(`${line} | ${row.why}`);
  }
  if (r.old_plans.length) out.push(`- old Plan Mode files in .keel/local/plans/: ${r.old_plans.length} (move-plans moves them to .keel/local/plans/claude/)`);
  if (r.per_model_compact.length) out.push(`- user modelSettings auto-compact per model (wins over autoCompactWindow for that model): ${r.per_model_compact.join(', ')}`);
  return out.join('\n');
}

function merge(settings, key, value) {
  if (value === null) {
    if (key === 'permissions.allow') throw new Error('permissions.allow cannot be removed by keel');
    delete settings[key];
  } else if (PLUGIN_OPTIONS.has(key)) {
    const id = keelId(settings);
    settings.pluginConfigs = settings.pluginConfigs || {};
    settings.pluginConfigs[id] = settings.pluginConfigs[id] || {};
    settings.pluginConfigs[id].options = { ...(settings.pluginConfigs[id].options || {}), [key]: value };
  } else if (key === 'permissions.allow') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error('permissions.allow must be a list of strings');
    settings.permissions = settings.permissions || {};
    settings.permissions.allow = [...new Set([...(settings.permissions.allow || []), ...value])];
  } else if (key === 'attribution' && value && typeof value === 'object') {
    settings.attribution = { ...(typeof settings.attribution === 'object' ? settings.attribution : {}), ...value };
  } else {
    settings[key] = value;
  }
}

function apply(root, changesFile) {
  const changes = readJsonFile(changesFile);
  // { "permissions": { "allow": [...] } } is the same as { "permissions.allow": [...] }
  const project = changes.project;
  if (project && project.permissions && typeof project.permissions === 'object' && Object.keys(project.permissions).every((k) => k === 'allow')) {
    project['permissions.allow'] = project.permissions.allow;
    delete project.permissions;
  }
  const unknown = Object.entries(changes).flatMap(([scope, keys]) => (KEYS[scope] ? Object.keys(keys || {}).filter((k) => !KEYS[scope][k]).map((k) => `${scope}.${k}`) : [scope]));
  if (unknown.length) throw new Error(`keel does not write these settings: ${unknown.join(', ')}`);
  const nullUser = Object.entries(changes.user || {}).filter(([, v]) => v === null).map(([k]) => `user.${k}`);
  if (nullUser.length) throw new Error(`a machine value is changed, not removed: ${nullUser.join(', ')}`);
  const written = [];
  try {
    // keel's own options for a project go to .keel/local/options.json, the rest to the settings file.
    const options = Object.fromEntries(Object.entries(project || {}).filter(([k]) => KEEL_OPTIONS.has(k)));
    if (Object.keys(options).length) {
      writeProjectOptions(root, options);
      for (const k of Object.keys(options)) delete project[k];
      written.push({ file: optionsFile(root), keys: Object.keys(options), backup: null });
    }
    for (const [scope, keys] of Object.entries(changes)) {
      if (!keys || !Object.keys(keys).length) continue;
      const file = scope === 'user' ? userFile() : projectFile(root);
      const { exists, value } = readJson(file);
      for (const [key, v] of Object.entries(keys)) merge(value, key, v);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      let backup = null;
      if (exists) {
        // A project file's backup goes to .keel/local/backups (git-ignored), not beside it, where git
        // would list it as untracked. The machine file is outside any repository: its backup stays beside it.
        const backupDir = scope === 'user' ? path.dirname(file) : path.join(root, '.keel', 'local', 'backups');
        fs.mkdirSync(backupDir, { recursive: true });
        backup = path.join(backupDir, `${path.basename(file)}.keel-backup-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`);
        fs.copyFileSync(file, backup);
      }
      fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
      written.push({ file, keys: Object.keys(keys), backup });
    }
  } catch (e) {
    // Files written before the failure stay written: the caller reports them.
    e.written = written;
    throw e;
  }
  return written;
}

if (require.main === module) {
  const { pos } = parseArgs(process.argv.slice(2));
  const root = path.resolve(pos[0] || '.');
  const say = (w) => process.stdout.write(`written ${w.file}: ${w.keys.join(', ')}${w.backup ? `; previous file kept as ${w.backup}` : ''}\n`);
  try {
    if (pos[1] === 'show') process.stdout.write(`${report(show(root))}\n`);
    else if (pos[1] === 'apply' && pos[2]) apply(root, path.resolve(pos[2])).forEach(say);
    else if (pos[1] === 'move-plans') {
      const { moved, kept } = movePlans(root);
      process.stdout.write(`moved to .keel/local/plans/claude/: ${moved.length}${kept.length ? `; left in place (the same name is already there): ${kept.join(', ')}` : ''}\n`);
    } else process.stdout.write('usage: node claude-settings.js <projectDir> show | apply <changes.json> | move-plans\n');
  } catch (e) {
    const done = e.written || [];
    done.forEach(say);
    process.stdout.write(`claude-settings: ${done.length ? 'stopped, nothing more written' : 'nothing written'} (${e.message})\n`);
    process.exitCode = 1;
  }
}

module.exports = { KEYS, show, apply, report, userFile, keelId, homeOf, movePlans };
