'use strict';
// Throwaway repositories for the tests of a feature on several repositories (tests/plans-repos*.test.js,
// tests/plans-elsewhere.test.js, tests/plans-stubs.test.js): projects/api plans, projects/web has keel,
// projects/admin is a git repository without keel. No remote: each is named by its folder.
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./tmp.js');

const SCRIPTS = path.join(__dirname, '..', '..', 'plugins', 'keel', 'scripts');
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (extra = {}) => ({
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'autonomous', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  planning: { place: 'pc' },
  ...extra,
});

const FEATURE = 'message-notify';
const PLAN = `.keel/local/plans/keel/${FEATURE}`;
const THERE = `tickets/${FEATURE}`;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const script = (name) => (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, name), dir, ...args],
  { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'en' } }).stdout.trim().split('\n');
const run = script('plans.js');
const slash = (p) => p.replace(/\\/g, '/');
const front = (dir, rel, key, value) => write(dir, rel, readRel(dir, rel).replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));
const head = (dir) => git(dir, 'rev-parse', '--short', 'HEAD');

function commit(dir, message, files = {}) {
  for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

// A git repository `name` in `parent` with one commit on main; keel's config when `config` is given.
function repo(parent, name, config) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (config !== undefined) {
    write(dir, '.keel/config.json', typeof config === 'string' ? config : JSON.stringify(config));
    write(dir, '.keel/.gitignore', 'local/\n');
  }
  commit(dir, 'init', { 'src/app.js': 'module.exports = 1;\n' });
  return dir;
}

// projects/: api (keel), web (keel, src/badge.js), admin (git, no keel); api's repos map has web.
function world() {
  const tmp = tempDir('keel-repos-');
  const projects = path.join(tmp, 'projects');
  const api = repo(projects, 'api', CONFIG());
  const web = repo(projects, 'web', CONFIG());
  commit(web, 'badge', { 'src/badge.js': 'module.exports = 2;\n' });
  const admin = repo(projects, 'admin');
  run(api, 'settings', 'set', '--repo', `web=${slash(web)}`);
  return { tmp, projects, api, web, admin };
}

const ticketText = (id, where) => `# [${id}] Ticket ${id}

## In plain words
A person sees one more thing on the screen.

## Goal
Do one thing.

## Acceptance criteria
- [ ] Given a message, when it arrives, then the count grows

## How to check
\`npm test\`

## Boundaries
- always: keep the old route
- ask first: a new dependency
- never: delete a file

## Where to look
\`${where}\`

## Out of scope

## Why
D1.

## Dependencies
`;

const planText = `# ${FEATURE}

## In plain words
The chat icon counts new messages.

## Level

## Decisions
D1. Count on the server.

## Contract

## Out of scope

## Design sketch

## Terms

## What was gathered

## Open questions

## Tickets
T1 badge
T2 event

## Next action
Review.
`;

// The body of a file plans.js made, its front matter kept.
const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

module.exports = {
  SCRIPTS, gitTest, CONFIG, FEATURE, PLAN, THERE, git, write, readRel, has, script, run, slash, front, head, commit,
  repo, world, ticketText, planText, body,
};
