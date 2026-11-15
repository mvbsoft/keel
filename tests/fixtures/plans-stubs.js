'use strict';
// Throwaway repositories for the stub tests (tests/plans-stubs*.test.js): projects/api (API) plans a
// feature whose admin part (ADM) is in a repository that is not on this machine at first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./tmp.js');

const SCRIPTS = path.join(__dirname, '..', '..', 'plugins', 'keel', 'scripts');
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);

const CONFIG = (prefix) => ({
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
  planning: { ticket_prefix: prefix, tickets: 'repo' },
});

const FEATURE = 'message-notify';
const PLAN = `.keel/local/plans/keel/${FEATURE}`;
const OUT = `tickets/${FEATURE}`;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const script = (name) => (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, name), dir, ...args],
  { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'en' } }).stdout.trim().split('\n');
const run = script('plans.js');
const page = script('feature-page.js');
const slash = (p) => p.replace(/\\/g, '/');
const line = (out, name) => (out.find((l) => l.startsWith(`${name}: `)) || '').slice(name.length + 2);

function repo(parent, name, prefix) {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'core.autocrlf', 'false');
  write(dir, '.keel/config.json', JSON.stringify(CONFIG(prefix)));
  write(dir, '.keel/.gitignore', 'local/\n');
  write(dir, 'src/app.js', 'module.exports = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const planText = `# ${FEATURE}

## In plain words
The chat icon counts new messages; the admin shows them too.

## Level

## Decisions
D1. One event for every client.

## Contract

## Out of scope

## Design sketch

## Terms

## What was gathered

## Open questions

## Tickets
T1 event
T2 admin counter

## Next action
Export.
`;

const ticketText = (id) => `# [${id}] Event

## In plain words
A person sees one more thing on the screen.

## Goal
Send the event.

## Acceptance criteria
- [ ] Given a message, when it arrives, then the event goes out

## How to check
\`npm test\`

## Boundaries
- always: keep the old route
- ask first: a new dependency
- never: delete a file

## Where to look
\`src/app.js:1\`

## Out of scope

## Why
D1.

## Dependencies
`;

const stubText = (id) => `# [${id}] Admin counter

## In plain words
The operator sees the number of new messages next to Chats.

## Example
- A client writes to support -> the admin shows 1 next to Chats.

## Goal
The admin shows the unread messages and updates them on the event.

## Acceptance criteria
- [ ] A client writes, then the number grows by one

## How to check
Open the admin as an operator, write to support from another account: 1 shows next to Chats.

## Out of scope
Sounds.

## Why
D1.

## Dependencies
Needs the event of T1.
`;

const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));

// projects/api (API) plans; the admin repository (ADM) is not on this machine.
function world() {
  const tmp = tempDir('keel-stubs-');
  const projects = path.join(tmp, 'projects');
  return { projects, api: repo(projects, 'api', 'API') };
}

// A draft: T1 the event, T2 the admin's stub depending on it, T3 an API ticket that needs the stub.
function draft(w) {
  run(w.api, 'new', FEATURE);
  run(w.api, 'ticket', FEATURE, '--title', 'Event');
  const made = run(w.api, 'ticket', FEATURE, '--title', 'Admin counter', '--stub', 'ADM', '--depends', 'T1');
  run(w.api, 'ticket', FEATURE, '--title', 'Event for the admin', '--slug', 'admin-event', '--depends', 'T2');
  body(w.api, `${PLAN}/plan.md`, planText);
  body(w.api, `${PLAN}/tickets/T1-event.md`, ticketText('T1'));
  body(w.api, `${PLAN}/tickets/T2-admin-counter.md`, stubText('T2'));
  body(w.api, `${PLAN}/tickets/T3-admin-event.md`, ticketText('T3'));
  return made;
}

function exported(w) {
  draft(w);
  run(w.api, 'reviewed', FEATURE, 'T1', 'T2', 'T3');
  assert.deepEqual(run(w.api, 'state', FEATURE, 'ready'), ['status: ready']);
  return run(w.api, 'export', FEATURE);
}

// The admin repository arrives: on this machine, in the repos map, on the feature branch.
function adminHere(w) {
  const admin = repo(w.projects, 'admin', 'ADM');
  run(w.api, 'settings', 'set', '--repo', `ADM=${slash(admin)}`);
  git(admin, 'switch', '-q', '-c', FEATURE);
  return admin;
}

module.exports = {
  SCRIPTS, gitTest, CONFIG, FEATURE, PLAN, OUT, git, write, readRel, has, script, run, page, slash, line,
  repo, planText, ticketText, stubText, body, world, draft, exported, adminHere,
};
