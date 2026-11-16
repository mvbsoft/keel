'use strict';
// The planning settings, in two places:
// - .keel/config.json `planning` (in git, the same for the team): place (repo | pc, where a new
//   feature's folder goes), tickets_dir, language. /keel:configure asks them; without place planning
//   does not start.
// - .keel/local/plans/keel/settings.json (this machine): repos, where the neighbouring repositories are
//   on this machine: { "<name>": "<absolute folder>" }, the name as lib/plans-format.js repoNames gives
//   it (web, or team/web when two repositories share a name). keel 2.0.0's draft and draft_dir there
//   are not read.
const path = require('node:path');
const { checkConfig } = require('./config.js');
const { read } = require('./repo-read.js');
const { unsafeRel, safeLocalWrite } = require('./safe-path.js');
const { mainOf } = require('./project-dir.js');

const DEFAULTS = { tickets_dir: 'tickets' };
const PROJECT_KEYS = ['place', 'tickets_dir', 'language'];
// A repository's name: its remote's last part or its folder's name, owner/name for two of one name.
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const NAME_MAX = 120;
const validName = (name) => typeof name === 'string' && name.length <= NAME_MAX && NAME.test(name);
const NOT_SET_UP = 'planning is not set up in .keel/config.json: /keel:configure planning';

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
// This machine's planning files are, for a linked worktree, the main checkout's (lib/project-dir.js):
// another worktree session sees the same drafts and settings, and they outlive the worktree.
const base = (root) => path.join(mainOf(root), '.keel', 'local', 'plans', 'keel');
const settingsFile = (root) => path.join(base(root), 'settings.json');
const slashes = (v) => v.trim().replace(/\\/g, '/').replace(/\/+$/, '');

// Why a repository folder cannot hold planning files, or null. The places keel's scanner reads as
// another system (handoff/, handoffs/), hidden folders and docs/plans are never used.
function badFolder(root, dir) {
  if (typeof dir !== 'string' || !dir.trim()) return 'empty';
  const why = unsafeRel(root, dir);
  if (why) return why;
  // Empty parts dropped: path.join reads docs//plans as docs/plans.
  const parts = dir.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return 'a hidden folder';
  if (parts.some((p) => /^handoffs?$/i.test(p))) return 'handoff/ and handoffs/ belong to another system';
  if (/^docs\/plans(\/|$)/i.test(parts.join('/'))) return 'docs/plans is not for tickets';
  return null;
}

function repoProblem(name, folder) {
  if (!validName(name)) return 'the name is the repository name: letters, digits, . _ -, or owner/name for two of one name';
  if (typeof folder !== 'string' || !path.isAbsolute(folder.trim())) return 'the folder is an absolute path';
  return null;
}

// This machine's saved settings (only valid values) and whether the file exists.
function readSettings(root) {
  const text = read(settingsFile(root));
  let raw = null;
  try { raw = text === null ? null : JSON.parse(text); } catch { /* unreadable: defaults */ }
  const saved = {};
  if (raw && typeof raw === 'object') {
    if (raw.repos && typeof raw.repos === 'object' && !Array.isArray(raw.repos)) {
      const repos = Object.fromEntries(Object.entries(raw.repos).filter(([p, f]) => !repoProblem(p, f)));
      if (Object.keys(repos).length) saved.repos = repos;
    }
  }
  return { exists: text !== null, readable: text === null || (raw !== null && typeof raw === 'object'), saved };
}

// The project's planning section (null when a valid config has none) and repo_language (en without a
// valid config).
function projectPlanning(root) {
  const { state, config } = checkConfig(root);
  return { planning: state === 'ok' && config.planning ? config.planning : null, repoLanguage: (state === 'ok' && config.repo_language) || 'en' };
}

// The settings in effect. place is undefined when the project's planning section has none; the
// language defaults to repo_language.
function settings(root) {
  const { saved } = readSettings(root);
  const { planning, repoLanguage } = projectPlanning(root);
  const own = Object.fromEntries(Object.entries(planning || {}).filter(([k]) => PROJECT_KEYS.includes(k)));
  return { ...DEFAULTS, repos: {}, ...saved, language: repoLanguage, ...own };
}

const setUp = (s) => s.place !== undefined;

// Why planning is not set up: no section, or a config the check rejects (then its section is not used).
function notSetUp(root) {
  const { state, errors, config } = checkConfig(root);
  if (state === 'ok' || !config || !config.planning) return NOT_SET_UP;
  return `.keel/config.json is ${state} (${errors[0]}), so its planning section is not used: /keel:configure`;
}

function settingsShow(root) {
  const { exists, readable } = readSettings(root);
  const { planning } = projectPlanning(root);
  const s = settings(root);
  const mark = (k, own) => `${k}: ${s[k] === undefined ? '-' : s[k]}${own && k in own ? '' : s[k] === undefined ? '' : ' (default)'}`;
  const repos = Object.entries(s.repos).map(([p, f]) => `${p}=${f}`).join(', ');
  return [
    exists ? `settings: ${rel(root, settingsFile(root))}${readable ? '' : ' (unreadable: defaults in use)'}` : 'settings: none yet',
    `repos: ${repos || '-'}`,
    setUp(s) ? 'planning: .keel/config.json' : `planning: ${notSetUp(root)}`,
    ...PROJECT_KEYS.map((k) => mark(k, planning)),
  ];
}

// Why `name` does not name the git repository at `folder` (its name or owner/name), or null; a folder
// that is not on this machine or not a repository is taken as given.
function nameProblem(name, folder) {
  const repos = require('./plans-repos.js');
  if (!repos.isFolder(folder) || !repos.isRepoTop(folder)) return null;
  const n = require('./plans-format.js').repoNames(folder);
  return name === n.name || name === n.full ? null : `${slashes(folder)} is named ${n.name} (or ${n.full}): --repo ${n.name}=<folder>`;
}

function settingsSet(root, opts) {
  const updates = {};
  const { saved } = readSettings(root);
  if (opts.repo !== undefined) {
    const m = /^([^=]*)=(.*)$/.exec(typeof opts.repo === 'string' ? opts.repo : '');
    const why = m ? repoProblem(m[1], m[2]) || nameProblem(m[1], m[2].trim()) : 'give <name>=<absolute folder>';
    if (why) return refuse('settings set', `--repo: ${why}`);
    updates.repos = { ...saved.repos, [m[1]]: slashes(m[2]) };
  }
  if (!Object.keys(updates).length) return refuse('settings set', 'nothing to set: --repo <name>=<absolute folder>');
  try {
    safeLocalWrite(mainOf(root), ['plans', 'keel', 'settings.json'], JSON.stringify({ ...saved, ...updates }, null, 2) + '\n');
  } catch (e) { return refuse('settings set', e.message); }
  return settingsShow(root);
}

// The repository folder that holds the feature folders (tickets_dir), or null when it is not one keel
// uses.
function repoDir(root, s = settings(root)) {
  return badFolder(root, s.tickets_dir) ? null : path.join(root, s.tickets_dir);
}

module.exports = { base, settingsFile, badFolder, settings, setUp, notSetUp, settingsShow, settingsSet, repoDir, validName };
