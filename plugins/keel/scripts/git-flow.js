'use strict';
// Git steps of keel's autonomous mode, plus `status` for both modes. Each command
// does one step and stops on anything unusual instead of guessing: a conflict is aborted and listed,
// a rejected push is explained, and nothing is ever forced or rebased; only delete-branch deletes, and
// Claude Code asks before it (hooks/own-files.js).
// Usage: node git-flow.js <projectDir> <command> [options]
//   status                            branch, remote, ahead/behind, changed files
//   start --name <b> [--from <base>]  create the task branch: from the updated base when the tree is
//                                     clean; from HEAD, carrying the changes, when it is not
//   switch --name <b>                 switch to an existing branch (clean tree only)
//   commit --message-file <f> [--tickets <K1,K2>]   stage every changed file except secret and planning
//                                     ones, drop AI trailers from the message, commit (never on the main
//                                     branch); the ticket files of the keys --tickets names go in (tickets
//                                     a session marked done), as the finished task's own does with --finish
//   sync [--from <base>]              merge the updated base into the current branch; on the base itself
//                                     (a feature branch shared with others), merge its remote copy: the
//                                     others' pushes (the main branch: only when it moves forward); none
//                                     yet: nothing to pull
//   push                              push the current branch with upstream tracking
//   merge [--into <target>]           merge the current branch into target with --no-ff, push target;
//                                     when the push is refused, target is reset to where it was
//   trust                             record that the user confirmed autonomous git for this project on
//                                     this machine (lib/trust.js); never allowed without a prompt
//   delete-branch --name <b> [--remote]  delete a task branch (/keel:tasks drop): never the main branch or
//                                     the current one; --remote also deletes it on the remote
// start, commit, sync and push take `--finish <task id> --session <id>` in a finish whose task folder
// went to keel's trash: when the step stops, the task is put back at once (`restored:`), so a finish
// never ends without a commit and without its task. A commit records the finish as committed
// (lib/finish.js); a push that completes after that commit ends it.
// First output line: `git-flow: ok | stopped | unavailable`; then `reason:` and details. Exit code 0.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadProject, parseArgs } = require('./lib/project.js');
const { trustState, trust } = require('./lib/trust.js');
const { linkOnWay, safeLocalWrite, realPath, samePath } = require('./lib/safe-path.js');
const { readFinish, clearFinish, markCommitted, validSid } = require('./lib/finish.js');
const { stripAttribution } = require('./lib/attribution.js');
const { untrackedRecord, fileStamp } = require('./lib/diff.js');
const { planningFiles } = require('./lib/planning.js');

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANG: 'C', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' };

function git(root, args, input) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: ENV, input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: (r.stdout || '').trim(), raw: r.stdout || '', err: (r.stderr || '').trim() };
}
const gitOk = (root, args) => git(root, args).ok;
// Branch names compare without case where the file system does (Main and main are one ref file).
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const sameBranch = (a, b) => typeof a === 'string' && typeof b === 'string' && (FOLD ? a.toLowerCase() === b.toLowerCase() : a === b);
const TRUST_TEXT = {
  confirmed: 'confirmed',
  changed: 'settings changed since you confirmed — run trust again (Claude Code asks before each git step until then)',
  none: 'not confirmed (Claude Code asks before each git step; confirm once with the trust command)',
};
const firstLines = (text, n = 4) => text.split('\n').filter(Boolean).slice(0, n).join(' | ');

class Stop extends Error {
  constructor(reason, details = []) { super(reason); this.details = details; }
}

// `git status --porcelain -z`: [{ xy, path, orig }]
function changedFiles(root) {
  const r = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!r.ok) throw new Stop(`git status failed: ${firstLines(r.err)}`);
  const parts = r.raw.split('\0'); // raw: a leading space is part of the status
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const f = { xy: e.slice(0, 2), path: e.slice(3), orig: null };
    if (f.xy[0] === 'R' || f.xy[0] === 'C') f.orig = parts[++i];
    files.push(f);
  }
  return files;
}

// The remote keel works with: origin, else the first one.
const pickRemote = (remotes) => (remotes.includes('origin') ? 'origin' : remotes[0] || null);

function context(root) {
  const { config, isSecret } = loadProject(root);
  const repo = git(root, ['rev-parse', '--git-dir']);
  if (!repo.ok) throw new Stop(/dubious ownership/i.test(repo.err) ? `git does not trust this folder's owner: ${firstLines(repo.err)}` : 'not a git repository');
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).out || null;
  const remotes = git(root, ['remote']).out.split('\n').filter(Boolean);
  const remote = pickRemote(remotes);
  const top = git(root, ['rev-parse', '--show-toplevel']).out;
  let atTop = false;
  try { atTop = samePath(realPath(path.resolve(top)), realPath(root)); } catch { /* unreadable: not the top */ }
  const busy = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].find((ref) => gitOk(root, ['rev-parse', '-q', '--verify', ref]));
  return { root, config, isSecret, main: config.git.main_branch, branch, remote, busy, top, atTop };
}

// An untracked file that was there at the task start and has not changed since: not this task's work
// (verification leaves it out too), so it is neither committed nor in the way of a step.
function notTaskWork(ctx, f) {
  if (f.xy !== '??') return false;
  if (ctx.before === undefined) ctx.before = untrackedRecord(ctx.root);
  const b = ctx.before;
  return Boolean(b) && Object.prototype.hasOwnProperty.call(b, f.path) && b[f.path] !== null && b[f.path] === fileStamp(ctx.root, f.path);
}

// Planning's files (lib/planning.js) are not a task's work: its commit leaves them out and they do not
// block a step. Only the tickets a commit names go in (the finished task's own, a session's --tickets),
// so their `done` lands with the code. Keys compare without case.
function planningOf(ctx) {
  if (!ctx.planning) ctx.planning = planningFiles(ctx.root);
  return ctx.planning;
}

function requireReady(ctx, { clean = false } = {}) {
  // git reports paths from the repository's top folder; keel's steps read them from the project folder.
  if (!ctx.atTop) throw new Stop(`the project folder is not the top folder of its git repository (${ctx.top}); keel's git steps run only there`);
  if (ctx.busy) throw new Stop(`a git operation is in progress (${ctx.busy}); finish or abort it first`);
  if (!ctx.branch) throw new Stop('HEAD is detached; switch to a branch first');
  if (clean) {
    // What commit leaves out on purpose (secret files, keel's own .keel/local, planning) does not block a step:
    // otherwise a finish whose commit kept a modified .env out could never update or merge. git itself
    // still refuses a merge that would overwrite such a file.
    const dirty = changedFiles(ctx.root).filter((f) => !(f.path === '.keel/local' || f.path.startsWith('.keel/local/') || ctx.isSecret(f.path) || notTaskWork(ctx, f) || planningOf(ctx)(f.path)));
    if (dirty.length) throw new Stop('the working tree has uncommitted changes', [`changed: ${dirty.slice(0, 10).map((f) => f.path).join(', ')}${dirty.length > 10 ? ` (+${dirty.length - 10})` : ''}`]);
  }
}

const exists = (root, ref) => gitOk(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]);
const sha = (root, ref) => git(root, ['rev-parse', '--short', ref]).out;

function fetch(ctx) {
  if (!ctx.remote) return;
  const r = git(ctx.root, ['fetch', '--prune', ctx.remote]);
  if (!r.ok) throw new Stop(`fetch from ${ctx.remote} failed: ${firstLines(r.err)}`);
}

// The freshest known version of a branch: the remote one when it exists, else the local one.
function freshRef(ctx, branch) {
  if (ctx.remote && exists(ctx.root, `refs/remotes/${ctx.remote}/${branch}`)) return `${ctx.remote}/${branch}`;
  if (exists(ctx.root, `refs/heads/${branch}`)) return branch;
  return null;
}

function validName(root, name) {
  if (typeof name !== 'string' || !name) throw new Stop('--name is required');
  if (!gitOk(root, ['check-ref-format', '--branch', name])) throw new Stop(`"${name}" is not a valid branch name`);
}

// Classifies a refused push from git's stderr (GitHub, GitLab, Bitbucket and plain server hooks).
function pushRefusal(err) {
  if (/protected branch|GH006|pre-receive hook declined|not allowed to (push|force)|denied to update|refusing to update|push declined|branch is protected/i.test(err)) return 'protected';
  if (/non-fast-forward|fetch first|\[rejected\]|tip of your current branch is behind/i.test(err)) return 'behind';
  return 'failed';
}

function conflictStop(ctx, what, abortArgs) {
  const files = git(ctx.root, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  git(ctx.root, abortArgs);
  return new Stop(`conflict while ${what}; the merge was aborted, the tree is as before`, [`conflicts: ${files.join(', ') || '(unknown)'}`]);
}

const commands = {
  status(ctx) {
    const out = [`branch: ${ctx.branch || '(detached HEAD)'}`, `main branch: ${ctx.main}`, `mode: ${ctx.config.git.mode}`, `remote: ${ctx.remote || 'none'}`];
    if (ctx.config.git.mode === 'autonomous') out.push(`autonomous on this machine: ${TRUST_TEXT[trustState(ctx.root)]}`);
    if (ctx.busy) out.push(`in progress: ${ctx.busy}`);
    const up = git(ctx.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (up.ok) {
      const c = git(ctx.root, ['rev-list', '--left-right', '--count', '@{u}...HEAD']).out.split(/\s+/);
      out.push(`upstream: ${up.out} (behind ${c[0]}, ahead ${c[1]}, as of the last fetch)`);
    } else out.push('upstream: none');
    const files = changedFiles(ctx.root);
    out.push(`changed files: ${files.length}${files.length ? ` (${files.slice(0, 10).map((f) => f.path).join(', ')}${files.length > 10 ? ', ...' : ''})` : ''}`);
    return out;
  },

  start(ctx, opts) {
    requireReady(ctx);
    validName(ctx.root, opts.name);
    if (exists(ctx.root, `refs/heads/${opts.name}`)) throw new Stop(`branch ${opts.name} already exists; use switch to continue on it`);
    const base = typeof opts.from === 'string' ? opts.from : ctx.main;
    const dirty = changedFiles(ctx.root);
    if (dirty.length) {
      const r = git(ctx.root, ['checkout', '-b', opts.name]);
      if (!r.ok) throw new Stop(`could not create ${opts.name}: ${firstLines(r.err)}`);
      return [`branch: ${opts.name} (new, from ${ctx.branch} at ${sha(ctx.root, 'HEAD')})`, `carried: ${dirty.length} changed files`,
        `note: the tree had changes, so the branch starts from the current commit, not from the updated ${base}; sync brings ${base} in later`];
    }
    fetch(ctx);
    const from = freshRef(ctx, base);
    if (!from) throw new Stop(`base branch ${base} not found`);
    const r = git(ctx.root, ['checkout', '--no-track', '-b', opts.name, from]);
    if (!r.ok) throw new Stop(`could not create ${opts.name}: ${firstLines(r.err)}`);
    return [`branch: ${opts.name} (new, from ${from} at ${sha(ctx.root, 'HEAD')})`];
  },

  switch(ctx, opts) {
    requireReady(ctx, { clean: true });
    validName(ctx.root, opts.name);
    fetch(ctx);
    const local = exists(ctx.root, `refs/heads/${opts.name}`);
    const remoteRef = ctx.remote && exists(ctx.root, `refs/remotes/${ctx.remote}/${opts.name}`) ? `${ctx.remote}/${opts.name}` : null;
    if (!local && !remoteRef) throw new Stop(`branch ${opts.name} not found locally or on the remote`);
    const r = local ? git(ctx.root, ['checkout', opts.name]) : git(ctx.root, ['checkout', '--track', '-b', opts.name, remoteRef]);
    if (!r.ok) throw new Stop(`could not switch to ${opts.name}: ${firstLines(r.err)}`);
    const out = [`branch: ${opts.name}`];
    if (local && remoteRef) {
      const ff = git(ctx.root, ['merge', '--ff-only', remoteRef]);
      out.push(ff.ok ? `updated from ${remoteRef}: ${sha(ctx.root, 'HEAD')}` : `warning: local ${opts.name} and ${remoteRef} have diverged; not changed`);
    }
    return out;
  },

  commit(ctx, opts) {
    requireReady(ctx);
    if (sameBranch(ctx.branch, ctx.main)) throw new Stop(`on the main branch ${ctx.main}; create the task branch first (start)`);
    if (typeof opts['message-file'] !== 'string') throw new Stop('--message-file is required');
    const tmp = path.join(ctx.root, '.keel', 'local', 'tmp');
    const messageFile = path.resolve(ctx.root, opts['message-file']);
    if (path.relative(tmp, messageFile).startsWith('..') || path.isAbsolute(path.relative(tmp, messageFile))) throw new Stop('the message file must be inside .keel/local/tmp/');
    // A linked message file would put another file's text into a commit that gets pushed.
    const linked = linkOnWay(ctx.root, messageFile);
    if (linked) throw new Stop(`the message file is not read: ${linked}`);
    let message;
    try { message = stripAttribution(fs.readFileSync(messageFile, 'utf8')); } catch (e) { throw new Stop(`cannot read the message file: ${e.message}`); }
    if (!message) throw new Stop('the commit message is empty');

    if (opts.tickets === true) throw new Stop('--tickets needs the keys: --tickets <K1,K2>');
    const carried = new Set([opts.finish, ...(typeof opts.tickets === 'string' ? opts.tickets.split(',') : [])]
      .filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().toLowerCase()));

    const files = changedFiles(ctx.root);
    const paths = new Set();
    const secret = [];
    const notTask = [];
    const planning = [];
    const planned = (p) => {
      const kind = planningOf(ctx)(p);
      return Boolean(kind) && !(kind.kind === 'ticket' && carried.has(String(kind.key).toLowerCase()));
    };
    for (const f of files) {
      if (notTaskWork(ctx, f)) { notTask.push(f.path); continue; }
      for (const p of [f.path, f.orig].filter(Boolean)) {
        // keel's machine-local files (agent replies, usage data, settings backups) never go into git,
        // even in a clone whose .keel/.gitignore is missing.
        if (p === '.keel/local' || p.startsWith('.keel/local/')) continue;
        if (ctx.isSecret(p)) secret.push(p);
        else if (planned(p)) { if (!planning.includes(p)) planning.push(p); }
        // Only a path with unstaged changes is added: a change already in the index (`git rm`, the
        // source of `git mv`) may be on neither side any more, and git add stops on such a pathspec.
        else if (p !== f.orig && f.xy[1] !== ' ') paths.add(p);
      }
    }
    if (paths.size) {
      const r = git(ctx.root, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], [...paths].join('\0'));
      if (!r.ok) throw new Stop(`git add failed: ${firstLines(r.err)}`);
    }
    // Secret files staged earlier by hand are taken out again. --no-renames lists both sides of a
    // staged move, so a secret moved away is caught too.
    const staged = git(ctx.root, ['diff', '--cached', '--name-only', '--no-renames', '-z']).out.split('\0').filter(Boolean);
    const stagedSecret = staged.filter((p) => ctx.isSecret(p));
    const stagedLocal = staged.filter((p) => p.startsWith('.keel/local/') && !ctx.isSecret(p));
    const stagedPlanning = staged.filter((p) => !ctx.isSecret(p) && !p.startsWith('.keel/local/') && planned(p));
    const kept = [...stagedSecret, ...stagedLocal, ...stagedPlanning];
    if (kept.length) git(ctx.root, ['reset', '-q', '--', ...kept]);
    for (const p of stagedPlanning) if (!planning.includes(p)) planning.push(p);
    for (const p of stagedSecret) if (!secret.includes(p)) secret.push(p);
    const out = secret.length ? [`not committed (secret files, by path only): ${secret.join(', ')}`] : [];
    if (notTask.length) out.push(`not committed (untracked before the task, unchanged): ${notTask.slice(0, 10).join(', ')}${notTask.length > 10 ? ` (+${notTask.length - 10})` : ''}`);
    if (planning.length) out.push(`not committed (planning files): ${planning.slice(0, 10).join(', ')}${planning.length > 10 ? ` (+${planning.length - 10})` : ''}`);
    if (staged.length === kept.length) return ['commit: nothing to commit', ...out];

    let msgFile;
    try { msgFile = safeLocalWrite(ctx.root, ['tmp', 'commit-message.clean.txt'], message + '\n'); } catch (e) { throw new Stop(e.message, out); }
    // The message is already trimmed; `strip` would also drop lines that start with # ("#42 Fix login").
    const r = git(ctx.root, ['commit', '-F', msgFile, '--cleanup=whitespace']);
    if (!r.ok) throw new Stop(`git commit failed (a project hook?): ${firstLines(r.err || r.out)}`, out);
    const count = git(ctx.root, ['show', '--name-only', '--format=', 'HEAD']).out.split('\n').filter(Boolean).length;
    return [`commit: ${sha(ctx.root, 'HEAD')} ${message.split('\n')[0]}`, `files: ${count}`, ...out];
  },

  sync(ctx, opts) {
    requireReady(ctx, { clean: true });
    const base = typeof opts.from === 'string' ? opts.from : ctx.main;
    // On the base itself (a feature branch several people work on) its remote copy holds the others' pushes.
    const onBase = sameBranch(ctx.branch, base);
    // A branch never pushed (or no remote) has nothing to pull: the finish goes on with the push.
    const noCopy = () => [`sync: nothing to pull (no ${ctx.remote ? `${ctx.remote}/${ctx.branch}` : 'remote'})`];
    if (onBase && !ctx.remote) return noCopy();
    fetch(ctx);
    let from;
    if (onBase) {
      from = exists(ctx.root, `refs/remotes/${ctx.remote}/${ctx.branch}`) ? `${ctx.remote}/${ctx.branch}` : null;
      if (!from) return noCopy();
      // keel never commits on the main branch: there the pull may only move it forward.
      if (sameBranch(ctx.branch, ctx.main) && Number(git(ctx.root, ['rev-list', '--count', `${from}..HEAD`]).out) > 0) throw new Stop(`local ${ctx.branch} has commits that ${from} does not have; sort that out by hand first`);
    } else {
      from = freshRef(ctx, base);
      if (!from) throw new Stop(`base branch ${base} not found`);
    }
    const count = Number(git(ctx.root, ['rev-list', '--count', `HEAD..${from}`]).out) || 0;
    if (!count) return [`sync: up to date with ${from}`];
    // --ff-only on the main branch, whatever merge.ff the user's git config sets.
    const r = git(ctx.root, ['merge', '--no-edit', ...(onBase && sameBranch(ctx.branch, ctx.main) ? ['--ff-only'] : []), from]);
    if (!r.ok) {
      if (gitOk(ctx.root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) throw conflictStop(ctx, `merging ${from} into ${ctx.branch}`, ['merge', '--abort']);
      throw new Stop(`merge of ${from} failed: ${firstLines(r.err || r.out)}`);
    }
    return [`sync: merged ${count} new commits from ${from} into ${ctx.branch} (${sha(ctx.root, 'HEAD')})`, 'run the gates again: the code changed'];
  },

  push(ctx) {
    requireReady(ctx);
    if (sameBranch(ctx.branch, ctx.main)) throw new Stop(`on the main branch ${ctx.main}; it is pushed only by merge`);
    if (!ctx.remote) return ['push: no remote, nothing pushed (the work is committed locally)'];
    const r = git(ctx.root, ['push', '-u', ctx.remote, `refs/heads/${ctx.branch}:refs/heads/${ctx.branch}`]);
    if (r.ok) return [`push: ${ctx.branch} -> ${ctx.remote}/${ctx.branch}`];
    const kind = pushRefusal(r.err);
    if (kind === 'behind') throw new Stop(`${ctx.remote}/${ctx.branch} has commits this branch does not have; look at them before pushing`, [`git: ${firstLines(r.err)}`]);
    throw new Stop(`push of ${ctx.branch} was refused (${kind})`, [`git: ${firstLines(r.err)}`]);
  },

  merge(ctx, opts) {
    requireReady(ctx, { clean: true });
    const source = ctx.branch;
    const target = typeof opts.into === 'string' ? opts.into : ctx.main;
    if (sameBranch(source, target)) throw new Stop(`already on ${target}; run merge from the task branch`);
    fetch(ctx);
    if (ctx.remote) {
      const pushed = exists(ctx.root, `refs/remotes/${ctx.remote}/${source}`) && git(ctx.root, ['rev-parse', `${ctx.remote}/${source}`]).out === git(ctx.root, ['rev-parse', 'HEAD']).out;
      if (!pushed) throw new Stop(`${source} is not pushed as it is now; push it first`);
    }
    const localTarget = exists(ctx.root, `refs/heads/${target}`);
    const remoteTarget = ctx.remote && exists(ctx.root, `refs/remotes/${ctx.remote}/${target}`) ? `${ctx.remote}/${target}` : null;
    if (!localTarget && !remoteTarget) throw new Stop(`target branch ${target} not found`);
    const back = () => git(ctx.root, ['checkout', '-q', source]);

    let r = localTarget ? git(ctx.root, ['checkout', '-q', target]) : git(ctx.root, ['checkout', '-q', '--track', '-b', target, remoteTarget]);
    if (!r.ok) throw new Stop(`could not switch to ${target}: ${firstLines(r.err)}`);
    // Local target commits the remote lacks would be published by the push below.
    if (remoteTarget && (!gitOk(ctx.root, ['merge', '--ff-only', remoteTarget]) || Number(git(ctx.root, ['rev-list', '--count', `${remoteTarget}..HEAD`]).out) > 0)) {
      back();
      throw new Stop(`local ${target} has commits that ${remoteTarget} does not have; sort that out by hand first`);
    }
    const before = git(ctx.root, ['rev-parse', 'HEAD']).out;
    r = git(ctx.root, ['merge', '--no-ff', '--no-edit', source]);
    if (!r.ok) {
      const stop = gitOk(ctx.root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
        ? conflictStop(ctx, `merging ${source} into ${target}`, ['merge', '--abort'])
        : new Stop(`merge failed: ${firstLines(r.err || r.out)}`);
      back();
      throw stop;
    }
    const merged = sha(ctx.root, 'HEAD');
    if (!ctx.remote) return [`merge: ${source} -> ${target} (${merged}), local only: no remote`];
    r = git(ctx.root, ['push', ctx.remote, `refs/heads/${target}:refs/heads/${target}`]);
    if (r.ok) return [`merge: ${source} -> ${target} (${merged})`, `push: ${target} -> ${ctx.remote}/${target}`, `now on: ${target}`];
    // The merge commit was never published: put target back where it was. --keep, not --hard: a local
    // change the commit left out (a modified .env) came along with the checkout and must survive.
    const undo = git(ctx.root, ['reset', '-q', '--keep', before]);
    if (!undo.ok) throw new Stop(`the push of the merge was refused, and git reset --keep could not put ${target} back`, [`push: ${firstLines(r.err)}`, `reset: ${firstLines(undo.err || undo.out)}`, `now on: ${target}, which still holds the unpublished merge ${merged}`, `to undo it by hand: git reset --keep ${before.slice(0, 7)} && git checkout ${source}`]);
    back();
    const kind = pushRefusal(r.err);
    const details = [`git: ${firstLines(r.err)}`, `${target} reset to ${before.slice(0, 7)}; back on ${source}`];
    if (kind === 'protected') {
      details.push(`pull request: gh pr create --base ${target} --head ${source} --fill`);
      throw new Stop(`${target} is protected: the push of the merge was refused`, details);
    }
    throw new Stop(`the push of ${target} was refused (${kind})`, details);
  },

  'delete-branch'(ctx, opts) {
    requireReady(ctx);
    validName(ctx.root, opts.name);
    // The name is resolved to the local branch it reaches (exactly, else without case where refs
    // ignore case: `Main` deletes main on Windows and macOS); neither it nor the name may be the main
    // or the current branch.
    const local = git(ctx.root, ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']).out.split('\n').filter(Boolean);
    const name = local.find((b) => b === opts.name) || local.find((b) => sameBranch(b, opts.name)) || opts.name;
    for (const n of new Set([opts.name, name])) {
      if (sameBranch(n, ctx.main)) throw new Stop(`${opts.name} is the main branch; keel never deletes it`);
      if (sameBranch(n, ctx.branch)) throw new Stop(`${opts.name} is the current branch; switch to another one first`);
    }
    const out = [];
    if (local.includes(name)) {
      const at = sha(ctx.root, `refs/heads/${name}`);
      const r = git(ctx.root, ['branch', '-D', name]);
      if (!r.ok) throw new Stop(`could not delete ${name}: ${firstLines(r.err)}`);
      out.push(`deleted: ${name} (local, was at ${at}; git branch ${name} ${at} brings it back)`);
    } else out.push(`local: no branch ${opts.name}`);
    if (opts.remote === true) {
      if (!ctx.remote) out.push('remote: none');
      else {
        // The last known commit of the remote branch, so a branch only the remote held can come back.
        const tracked = exists(ctx.root, `refs/remotes/${ctx.remote}/${opts.name}`) ? sha(ctx.root, `refs/remotes/${ctx.remote}/${opts.name}`) : null;
        const r = git(ctx.root, ['push', ctx.remote, '--delete', `refs/heads/${opts.name}`]);
        if (!r.ok) throw new Stop(`could not delete ${opts.name} on ${ctx.remote}`, [...out, `git: ${firstLines(r.err)}`]);
        out.push(`deleted: ${ctx.remote}/${opts.name}${tracked ? ` (was at ${tracked}; git push ${ctx.remote} ${tracked}:refs/heads/${opts.name} brings it back while that commit is still here)` : ''}`);
      }
    }
    return out;
  },

  trust(ctx) {
    if (ctx.config.git.mode !== 'autonomous') throw new Stop('the git mode is not autonomous; nothing to confirm');
    const before = trustState(ctx.root);
    if (!trust(ctx.root)) return ['already confirmed'];
    return [before === 'changed' ? 'autonomous git confirmed again for this project on this machine, with its current git settings' : 'autonomous git confirmed for this project on this machine'];
  },
};

const FINISH_STEPS = new Set(['start', 'commit', 'sync', 'push']);

function run(root, command, opts) {
  const lines = step(root, command, opts);
  // A commit stages every change, a finished task's removal too.
  if (command === 'commit' && lines[0] === 'git-flow: ok') markCommitted(root);
  if (opts.finish === undefined || !FINISH_STEPS.has(command)) return lines;
  return [...lines, ...afterFinishStep(root, command, opts, lines[0] === 'git-flow: ok')];
}

// A finish's step that stopped puts its task back; a commit or a completed push moves the finish on.
function afterFinishStep(root, command, opts, ok) {
  const id = opts.finish;
  const sid = opts.session;
  if (typeof id !== 'string' || !validSid(sid)) return ['restore: not possible (--finish needs <task id> and --session <id>)'];
  const pending = readFinish(root, sid);
  const ours = pending && pending.id.toLowerCase() === id.toLowerCase();
  if (ok) {
    // A push ends the finish only after a commit holds the task's removal.
    if (command === 'push' && ours && pending.state === 'committed') clearFinish(root, sid);
    return [];
  }
  if (!ours) return [`restore: not needed (task ${id} was not moved to keel's trash in this session)`];
  // The removal is already committed: putting the folder back would undo the commit's work; the finish
  // goes on from the stopped step once its reason is fixed.
  if (pending.state === 'committed') return [`restore: not needed (the removal of task ${id} is committed; fix the reason above, then run this step again)`];
  const back = require('./lib/tasks.js').taskRestore(root, id, sid);
  if (back[0].startsWith('restored: ')) back.push(`task: ${id} is back and active; the finish did not complete (see reason above): fix it, then /keel:end-task again`);
  return back;
}

function step(root, command, opts) {
  if (!commands[command]) return ['git-flow: unavailable', `reason: unknown command "${command}" (status, start, switch, commit, sync, push, merge, trust, delete-branch)`];
  let ctx;
  try { ctx = context(root); } catch (e) {
    return ['git-flow: unavailable', `reason: ${e.message}`];
  }
  try {
    return ['git-flow: ok', ...commands[command](ctx, opts)];
  } catch (e) {
    if (e instanceof Stop) return ['git-flow: stopped', `reason: ${e.message}`, ...e.details];
    return ['git-flow: stopped', `reason: unexpected error: ${e.message}`];
  }
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    lines = run(path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd()), pos[1] || 'status', opts);
  } catch (e) {
    lines = ['git-flow: unavailable', `reason: ${e.message}`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { run, pushRefusal, git, context, requireReady, sameBranch, pickRemote, firstLines };
