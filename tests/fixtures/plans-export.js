'use strict';
// Throwaway projects for the plans.js export, commit and push tests: a bare repository plays the
// server, a second clone plays a colleague. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tempDir } = require('./tmp.js');
const { PLUGIN, SCRIPTS, gitTest, CONFIG, write, exists, git, line } = require('./keel-project.js');

const LOCAL = '.keel/local/plans/keel';
const readRel = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const run = (dir, ...args) => spawnSync(process.execPath, [path.join(SCRIPTS, 'plans.js'), dir, ...args], { encoding: 'utf8' }).stdout.trim().split('\n');
const body = (dir, rel, text) => write(dir, rel, readRel(dir, rel).replace(/^(---\n[\s\S]*?\n---\n)[\s\S]*$/, (m, fm) => `${fm}\n${text}`));
const front = (dir, rel, key, value) => write(dir, rel, readRel(dir, rel).replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`));
// The planning section of .keel/config.json, as /keel:configure planning writes it.
const planning = (dir, fields) => {
  const config = JSON.parse(readRel(dir, '.keel/config.json'));
  write(dir, '.keel/config.json', JSON.stringify({ ...config, planning: { ...config.planning, ...fields } }));
};

const PLAN_BODY = `# S3 storage

## In plain words
Upload and download files on S3; T1 comes first.

## Level
Tickets for one repository.

## Decisions
D1. Use the SDK (T2 builds on T1).

## Contract
PUT /files/{name} stores a file.

## Out of scope
Deleting files.

## Design sketch
Files go to S3.

## Terms
Bucket: the S3 folder of the project.

## What was gathered
src/app.js has no upload yet.

## Open questions

## Tickets
T1 client

## Stubs
The web app shows the files T1 uploads.

## Next action
Export.
`;

const TICKET_BODY = (id, where = '`src/app.js:1`') => `# [${id}] Title of ${id}

## In plain words
A file you upload lands in the bucket.

## Goal
Do one thing after T1; not T10, T20 or xT1.

## Acceptance criteria
- [ ] Given a file, when uploaded, then it is in the bucket

## How to check
\`npm test\`

## Boundaries
- always: keep the old route
- ask first: a new dependency
- never: delete a file

## Where to look
${where}

## Out of scope

## Why
D1.

## Dependencies
`;

// A project with keel's config, src/app.js, one commit on main and, when asked, a remote with main pushed.
function setup({ remote = true, config = {} } = {}) {
  const tmp = tempDir('keel-export-');
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.com');
  git(work, 'config', 'core.autocrlf', 'false');
  write(work, '.keel/config.json', JSON.stringify(CONFIG(config)));
  write(work, '.keel/.gitignore', 'local/\n');
  write(work, 'src/app.js', 'module.exports = 1;\n');
  write(work, 'src/other.js', 'module.exports = 2;\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'init');
  let server = null;
  if (remote) {
    server = path.join(tmp, 'server.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', server]);
    git(work, 'remote', 'add', 'origin', server);
    git(work, 'push', '-q', '-u', 'origin', 'main');
  }
  return { tmp, work, server };
}

// A colleague's clone that pushes a branch with one file.
function otherPush(server, tmp, branch, rel, text) {
  const other = path.join(tmp, `other-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=false', server, other]);
  git(other, 'config', 'user.name', 'Other');
  git(other, 'config', 'user.email', 'other@example.com');
  git(other, 'checkout', '-q', '-b', branch);
  write(other, rel, text);
  git(other, 'add', '-A');
  git(other, 'commit', '-q', '-m', `add ${rel}`);
  git(other, 'push', '-q', 'origin', branch);
}

// A ready draft with `n` tickets (T2 depends on T1) in the folder plans.js new picks.
function ready(dir, feature, n = 2, folder = `${LOCAL}/${feature}`) {
  run(dir, 'new', feature);
  body(dir, `${folder}/plan.md`, PLAN_BODY);
  for (let i = 1; i <= n; i++) {
    run(dir, 'ticket', feature, '--title', `Ticket ${i}`, ...(i > 1 ? ['--depends', `T${i - 1}`] : []));
    body(dir, `${folder}/tickets/T${i}-ticket-${i}.md`, TICKET_BODY(`T${i}`));
  }
  run(dir, 'reviewed', feature, ...Array.from({ length: n }, (_, i) => `T${i + 1}`));
  assert.deepEqual(run(dir, 'state', feature, 'ready'), ['status: ready']);
}

const trashed = (dir) => { try { return fs.readdirSync(path.join(dir, '.keel', 'local', 'trash')); } catch { return []; } };

module.exports = { PLUGIN, SCRIPTS, gitTest, CONFIG, LOCAL, git, write, readRel, exists, run, line, body, front, planning, TICKET_BODY, setup, otherPush, ready, trashed };
