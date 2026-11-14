'use strict';
// First step of every keel command (run from the skill with !`node ...`). Prints a short report the
// command reads; always exits 0 so the command itself decides what to do.
// Usage: node check-config.js <projectDir> [--profile]
//   keel-config: ok | missing | broken | outdated | invalid
//   reason: <first problems>            (when not ok)
//   settings on branch: <name>          (missing, and another local branch has the project's .keel/config.json:
//                                        the newest such branch; not printed when this branch itself has the file)
//   settings in folder: <path>          (right after it, when another worktree has that branch checked out:
//                                        the branch cannot be switched to here, work in that folder)
//   profile: ok | missing | invalid | stale   (with --profile; stale: the project's structure changed since
//                                              the last configure, not only package versions)
//   git: none | not installed | refused      (only when keel cannot use git here: it needs a repository)
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MIN_NODE = 22;
const MAX_BRANCHES = 50;
const GIT_TIMEOUT_MS = 5000;

const gitRun = (projectDir, args, input) => spawnSync('git', ['-C', projectDir, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, input });

// The newest local branch (by its last commit) that holds the project's .keel/config.json, as
// { name, folder } (folder: where another worktree has that branch checked out, else ''). null when git is
// missing, slow or fails, and when the current commit has the file itself (only deleted from the folder).
// The settings are committed with the first task's work, so the main branch gets them with that merge.
function branchWithSettings(projectDir) {
  const prefix = gitRun(projectDir, ['rev-parse', '--show-prefix']);
  if (prefix.error || prefix.status !== 0) return null;
  const file = `${prefix.stdout.trim()}.keel/config.json`;
  if (gitRun(projectDir, ['cat-file', '-e', `HEAD:${file}`]).status === 0) return null;
  // for-each-ref marks the checked-out branch with * (%(HEAD)): its files are the ones just checked.
  // %09 is a tab: a folder name may hold spaces.
  const refs = gitRun(projectDir, ['for-each-ref', '--sort=-committerdate', `--count=${MAX_BRANCHES + 1}`, '--format=%(HEAD)%09%(refname)%09%(worktreepath)', 'refs/heads']);
  if (refs.error || refs.status !== 0) return null;
  const branches = refs.stdout.split('\n').map((l) => l.split('\t'))
    .filter(([head, ref]) => head === ' ' && ref).slice(0, MAX_BRANCHES)
    .map(([, ref, folder]) => ({ name: ref.slice('refs/heads/'.length), folder: folder || '' }));
  if (!branches.length) return null;
  // One git process answers for all branches: "<sha> blob <size>" when the file is there, "... missing" when not.
  const found = gitRun(projectDir, ['cat-file', '--batch-check'], branches.map((b) => `refs/heads/${b.name}:${file}\n`).join(''));
  if (found.error || found.status !== 0) return null;
  const answers = found.stdout.split('\n');
  return branches.find((_, i) => / blob /.test(answers[i] || '')) || null;
}

// scanned: the project's scan, shared with config-check.js so the project is scanned once.
function report(projectDir, withProfile, scanned = memo(() => require('./scan.js').scan(projectDir))) {
  const lines = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE) {
    return [`keel-config: unavailable`, `reason: keel needs Node.js ${MIN_NODE} or newer, found ${process.versions.node} (https://nodejs.org)`];
  }
  const { checkConfig } = require('./lib/config.js');
  const { state, errors, config } = checkConfig(projectDir);
  lines.push(`keel-config: ${state}`);
  const elsewhere = state === 'missing' ? branchWithSettings(projectDir) : null;
  if (elsewhere) {
    lines.push(`reason: no .keel/config.json here; the settings are on branch ${elsewhere.name}, where they were committed with the work, and reach this branch when that branch is merged`);
    lines.push(`settings on branch: ${elsewhere.name}`);
    if (elsewhere.folder) lines.push(`settings in folder: ${elsewhere.folder}`);
  } else if (state !== 'ok') lines.push(`reason: ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
  if (withProfile) {
    const file = path.join(require('./lib/project-dir.js').configHome(projectDir), '.keel', 'profile.json');
    if (!fs.existsSync(file)) lines.push('profile: missing');
    else {
      const { validate } = require('./lib/schema.js');
      let profile;
      try { profile = require('./lib/json.js').readJsonFile(file); } catch { profile = null; }
      const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'profile.schema.json'), 'utf8'));
      if (!profile || validate(profile, schema).length) lines.push('profile: invalid');
      else {
        lines.push(isCurrent(projectDir, profile, config, scanned) ? 'profile: ok' : 'profile: stale (the project changed since the last configure; /keel:configure check says what to update)');
      }
    }
  }
  const repo = spawnSync('git', ['-C', projectDir, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (repo.error) lines.push('git: not installed (keel needs git: https://git-scm.com)');
  else if (/dubious ownership/i.test(repo.stderr || '')) lines.push(`git: refused (git does not trust the owner of this folder; git's own fix: git config --global --add safe.directory "${projectDir.replace(/\\/g, '/')}")`);
  else if (repo.status !== 0 || repo.stdout.trim() !== 'true') lines.push('git: none (not a git repository; keel needs one to see what changed and to keep each task on its branch)');
  return lines;
}

const memo = (fn) => { let v; return () => (v === undefined ? (v = fn()) : v); };

// The manifests are as scanned, or they changed (a dependency version, say) but nothing that makes
// the scan or the gates of the last configure out of date (lib/config-drift.js).
function isCurrent(projectDir, profile, config, scanned) {
  const result = scanned();
  if (profile.manifest_fingerprint === result.profile.manifest_fingerprint) return true;
  return !!config && require('./lib/config-drift.js').profileFits(projectDir, result, { config, profile });
}

module.exports = { report, memo };

if (require.main === module) {
  let lines;
  try {
    // Arguments are read like every keel script (and like hooks/own-files.js): the project comes first.
    const { opts, pos } = require('./lib/project.js').parseArgs(process.argv.slice(2));
    lines = report(require('./lib/project-dir.js').scriptProject(pos[0]), opts.profile !== undefined);
  } catch (e) {
    lines = ['keel-config: unavailable', `reason: the check itself failed: ${e.message}`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}
