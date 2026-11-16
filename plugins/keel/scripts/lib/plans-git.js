'use strict';
// A feature folder and git: plans.js commit and push (the folder goes into git as it is, nothing is
// renamed or removed), the fetch of plans.js tickets --fetch, and git's one warning about a ticket: its
// branch is merged into the plan's merge_into, but its status is not done. The status in the file is
// the only state; git never sets one. Claude Code asks before every commit and push (hooks/own-files.js).
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { repoDir } = require('./plans-settings.js');
const { git: readGit, read, clean } = require('./repo-read.js');
const flow = require('../git-flow.js');

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const gitText = (r) => clean(flow.firstLines(r.err || r.out, 2), 300);
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const gitPaths = (root, [command, ...args]) => (readGit(root, [command, '-z', ...args]) || '').split('\0').filter(Boolean);

// Whether the project is in a git repository, and its remote (git-flow's choice) after a fetch. `notes`
// says when the branches are known only as this clone has them; `failed`: there is a remote and the fetch
// failed. A remote that never answers (a stalled proxy or VPN) is a failed fetch after `timeoutMs`.
function fetched(root, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (readGit(root, ['rev-parse', '--git-dir']) === null) return { repo: false, failed: false, notes: ['fetch: not a git repository'] };
  const remote = flow.pickRemote((readGit(root, ['remote']) || '').split('\n').filter(Boolean));
  if (!remote) return { repo: true, failed: false, notes: ['fetch: no remote, skipped'] };
  const failed = (why) => ({ repo: true, failed: true, notes: [`fetch: ${remote} failed (${why}); branches as this clone knows them`] });
  let r;
  try { r = flow.git(root, ['fetch', '--prune', remote], undefined, timeoutMs); } catch (e) {
    if (e.code !== 'ETIMEDOUT') throw e;
    return failed(`no answer in ${Math.round(timeoutMs / 1000)} s`);
  }
  return r.ok ? { repo: true, failed: false, notes: [] } : failed(gitText(r));
}
// Room for a slow but working fetch, under Claude Code's 2-minute limit for a shell command.
const FETCH_TIMEOUT_MS = 60 * 1000;

// --- the warning ---

// A branch as git finds it: the local one, else the remote's.
function refOf(root, branch, remote) {
  for (const ref of [`refs/heads/${branch}`, ...(remote ? [`refs/remotes/${remote}/${branch}`] : [])]) {
    if (readGit(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]) !== null) return ref;
  }
  return null;
}

// `warn:` lines for the tickets that are not done and whose `branch` is merged into the plan's
// merge_into. Merged: the branch's last commit is in merge_into's history but not on its first-parent
// line, so a branch just made from merge_into (no commit of its own yet) is not taken for merged.
// shortcut: a fast-forward or squash merge is not seen; the task's base commit would show both.
function mergedWarnings(root, d, list) {
  const open = list.filter((t) => !plans.CLOSED.includes(t.fm.status) && given(t.fm.branch));
  if (!open.length || !given(d.fm.merge_into) || readGit(root, ['rev-parse', '--git-dir']) === null) return [];
  const remote = flow.pickRemote((readGit(root, ['remote']) || '').split('\n').filter(Boolean));
  const into = refOf(root, d.fm.merge_into, remote);
  if (!into) return [];
  const line = new Set((readGit(root, ['rev-list', '--first-parent', into]) || '').split('\n').filter(Boolean));
  const out = [];
  for (const t of open) {
    const ref = t.fm.branch === d.fm.merge_into ? null : refOf(root, t.fm.branch, remote);
    const tip = ref ? readGit(root, ['rev-parse', `${ref}^{commit}`]) : null;
    if (!tip || line.has(tip) || readGit(root, ['merge-base', '--is-ancestor', tip, into]) === null) continue;
    out.push(`warn: ${t.id}: its branch ${clean(t.fm.branch, 80)} is merged into ${clean(d.fm.merge_into, 80)}, but the ticket is ${clean(t.fm.status || 'without a status', 20)}: plans.js status ${d.feature} ${t.id} done once its work is finished`);
  }
  return out;
}

// --- commit and push ---

// git-flow's checks: a repository whose top folder is the project, no merge, rebase or cherry-pick in
// progress, on a branch, and not the main one.
function gitReady(root, what) {
  let ctx;
  try {
    ctx = flow.context(root);
    flow.requireReady(ctx);
  } catch (e) { return { why: refuse(what, e.message) }; }
  if (flow.sameBranch(ctx.branch, ctx.main)) return { why: refuse(what, `on the main branch ${ctx.main}; planning files go to a feature branch first`) };
  return { ctx };
}

// The feature's folder in the repository: { folder, removed } (removed: HEAD has it and the working
// tree no longer has, after plans.js drop), or { why }.
function featureFiles(root, feature, what) {
  if (!plans.validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}"`) };
  const found = plans.listDrafts(root).filter((d) => d.feature === feature);
  const inRepo = found.find((d) => !d.local);
  if (inRepo) return { folder: inRepo.folder, removed: false };
  const dir = repoDir(root);
  const folder = dir ? path.join(dir, feature) : null;
  if (folder && !fs.existsSync(folder) && gitPaths(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', `${rel(root, folder)}/`]).length) return { folder, removed: true };
  if (found.length) return { why: refuse(what, `${feature} is on this machine only (place pc): none of it goes into git`) };
  return { why: refuse(what, `no feature "${feature}" in the repository`) };
}

// The paths of this machine in the files under `paths` that differ from HEAD or are new.
function localInChanges(root, paths) {
  const folders = plans.machineFolders(root);
  // --cached too: before the first commit there is no HEAD to compare with.
  const changed = new Set([['diff', '--name-only', 'HEAD'], ['diff', '--cached', '--name-only'], ['ls-files', '-o', '--exclude-standard']].flatMap((a) => gitPaths(root, [...a, '--', ...paths])));
  return [...changed].filter((p) => /\.md$/i.test(p)).flatMap((p) => {
    const text = read(path.join(root, p));
    return text === null ? [] : plans.localProblems(p, text, folders);
  });
}

// --repo (another repository's folder) is not taken here: a feature lives in one repository's folder.
const noRepo = (what, repo) => (repo !== undefined ? refuse(what, '--repo: a feature is committed and pushed in the repository that holds its folder; run it there') : null);

function commitFeature(root, feature, { repo } = {}) {
  const what = 'commit';
  const other = noRepo(what, repo);
  if (other) return other;
  const { ctx, why } = gitReady(root, what);
  if (!ctx) return why;
  const c = featureFiles(root, feature, what);
  if (c.why) return c.why;
  const p = rel(root, c.folder);
  const local = c.removed ? [] : localInChanges(root, [p]);
  if (local.length) return [...refuse(what, `${local.length} paths of this machine in the files to commit; write them from the repository's root`), ...local.map((x) => `- ${x}`)];
  let r = flow.git(root, ['add', '-A', '--', p]);
  if (!r.ok) return refuse(what, `git add failed: ${gitText(r)}`);
  if (!flow.git(root, ['diff', '--cached', '--name-only', '--', p]).out) return ['commit: nothing to commit'];
  const inHead = gitPaths(root, ['ls-tree', '--name-only', 'HEAD', '--', `${p}/`]).length > 0;
  const message = c.removed ? `Remove the ${feature} plan` : inHead ? `Update the ${feature} plan` : `Plan ${feature}`;
  // Only these paths: changes staged before stay staged and out of this commit.
  r = flow.git(root, ['commit', '-q', '-m', message, '--', p]);
  if (!r.ok) return refuse(what, `git commit failed (a project hook?): ${gitText(r)}`);
  return [`committed: ${flow.git(root, ['rev-parse', '--short', 'HEAD']).out} ${message}`];
}

function pushFeature(root, feature, { repo } = {}) {
  const what = 'push';
  const other = noRepo(what, repo);
  if (other) return other;
  const { ctx, why } = gitReady(root, what);
  if (!ctx) return why;
  const c = featureFiles(root, feature, what);
  if (c.why) return c.why;
  if (!ctx.remote) return ['push: no remote, nothing pushed'];
  const b = ctx.branch;
  const r = flow.git(root, ['push', '-u', ctx.remote, `refs/heads/${b}:refs/heads/${b}`]);
  if (r.ok) return [`pushed: ${b} -> ${ctx.remote}/${b}`];
  const kind = flow.pushRefusal(r.err);
  if (kind === 'behind') return refuse(what, `${ctx.remote}/${b} has commits this branch does not have; look at them before pushing: ${gitText(r)}`);
  const refused = refuse(what, `the push of ${b} was refused (${kind}): ${gitText(r)}`);
  if (kind !== 'failed') return refused;
  // No network or no access: the same step, with its confirmation, once that is fixed.
  const script = path.join(__dirname, '..', 'plans.js').split(path.sep).join('/');
  return [...refused, `retry: node "${script}" "${root.split(path.sep).join('/')}" push ${feature}`];
}

module.exports = { commitFeature, pushFeature, fetched, mergedWarnings };
