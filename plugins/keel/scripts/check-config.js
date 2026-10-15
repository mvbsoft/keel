'use strict';
// First step of every keel command (run from the skill with !`node ...`). Prints a short report the
// command reads; always exits 0 so the command itself decides what to do.
// Usage: node check-config.js <projectDir> [--profile]
//   keel-config: ok | missing | broken | outdated | invalid
//   reason: <first problems>            (when not ok)
//   profile: ok | missing | invalid | stale   (with --profile)
//   git: none | not installed | refused      (only when keel cannot use git here: it needs a repository)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MIN_NODE = 22;

function report(projectDir, withProfile) {
  const lines = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) {
    return [`keel-config: unavailable`, `reason: keel needs Node.js ${MIN_NODE} or newer, found ${process.versions.node} (https://nodejs.org)`];
  }
  const { checkConfig } = require('./lib/config.js');
  const { state, errors } = checkConfig(projectDir);
  lines.push(`keel-config: ${state}`);
  if (state !== 'ok') lines.push(`reason: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
  if (withProfile) {
    const file = path.join(projectDir, '.keel', 'profile.json');
    if (!fs.existsSync(file)) lines.push('profile: missing');
    else {
      const { validate } = require('./lib/schema.js');
      let profile;
      try { profile = require('./lib/json.js').readJsonFile(file); } catch { profile = null; }
      const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'profile.schema.json'), 'utf8'));
      if (!profile || validate(profile, schema).length) lines.push('profile: invalid');
      else {
        const { fingerprint } = require('./scan.js');
        lines.push(profile.manifest_fingerprint === fingerprint(projectDir) ? 'profile: ok' : 'profile: stale (package or build files changed since the last scan)');
      }
    }
  }
  const repo = spawnSync('git', ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (repo.error) lines.push('git: not installed (keel needs git: https://git-scm.com)');
  else if (/dubious ownership/i.test(repo.stderr || '')) lines.push(`git: refused (git does not trust the owner of this folder; git's own fix: git config --global --add safe.directory "${projectDir.replace(/\\/g, '/')}")`);
  else if (repo.status !== 0 || repo.stdout.trim() !== 'true') lines.push('git: none (not a git repository; keel needs one to see what changed and to keep each task on its branch)');
  return lines;
}

let lines;
try {
  // Arguments are read like every keel script (and like hooks/own-files.js): the project comes first.
  const { opts, pos } = require('./lib/project.js').parseArgs(process.argv.slice(2));
  lines = report(path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd()), opts.profile !== undefined);
} catch (e) {
  lines = ['keel-config: unavailable', `reason: the check itself failed: ${e.message}`];
}
process.stdout.write(lines.join('\n') + '\n');
process.exit(0);
