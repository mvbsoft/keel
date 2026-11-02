'use strict';
// A feature on several repositories, while it is a draft (lib/plans.js):
// - plan.md `repos: [API, WEB]`: the ticket prefixes of its repositories, this project's first; `-` for
//   this project only.
// - a ticket's `repo: WEB`: the prefix of the repository the ticket is for, only when it is another one;
//   no field = this project.
// - plan.md `after_commit_repos: WEB=<commit>, MOB=<commit>`: each other repository's HEAD when its facts
//   were last checked, as `after_commit` is this project's.
// The folders come from the repos map (lib/plans-settings.js). Nothing here writes; git runs only
// rev-parse.
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('./config.js');
const { settings, PREFIX } = require('./plans-settings.js');
const { git, clean } = require('./repo-read.js');
const { samePath } = require('./safe-path.js');

// How many folders next to the project are looked at, per parent folder.
const SCAN_MAX = 200;

const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const slashes = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
// The long, real form: git prints C:/Users/runneradmin where Node may have C:\Users\RUNNER~1.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const same = (a, b) => samePath(slashes(real(a)), slashes(real(b)));

// The folder's git common directory (shared by all worktrees of one repository), or null.
function commonDir(folder) {
  const dir = git(folder, ['rev-parse', '--git-common-dir']);
  return dir ? path.resolve(folder, dir) : null;
}

// git walks up to parent folders, so a folder inside a repository answers too: only its top is one.
function isRepoTop(folder) {
  const top = git(folder, ['rev-parse', '--show-toplevel']);
  return top !== null && same(top, folder);
}

// The planning prefix a repository set in its .keel/config.json: `prefix` (null when none), or
// `broken` when the file is there but cannot be read. An outdated or invalid config still names its
// prefix: settings() would ignore it, but a prefix that differs from the map must not pass unseen.
function plannedPrefix(folder) {
  const { state, config } = checkConfig(folder);
  if (state === 'broken') return { broken: true, prefix: null };
  const p = config && config.planning && config.planning.ticket_prefix;
  return { broken: false, prefix: typeof p === 'string' ? p : null };
}

// `folder` (a real path, as git prints it) spelled through the nearest ancestor of `root` it lies under,
// so a link in root's path (macOS /var -> /private/var) shows as the user gave it; else `folder`.
function asGiven(folder, root) {
  const target = real(folder);
  for (let a = path.dirname(root); ; a = path.dirname(a)) {
    const rel = path.relative(real(a), target);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return path.join(a, rel);
    if (path.dirname(a) === a) return folder;
  }
}

// The git repositories next to the project: folders with a .git entry in the project's parent folder
// and, for a worktree, in the main worktree's parent; never this project nor another worktree of its
// repository; hidden folders and node_modules skipped.
function nextTo(root) {
  const own = commonDir(root);
  const parents = [path.dirname(root)];
  const mainParent = own && path.basename(own) === '.git' ? asGiven(path.dirname(path.dirname(own)), root) : null;
  if (mainParent && !same(mainParent, parents[0])) parents.push(mainParent);
  const out = [];
  const notes = [];
  for (const [i, parent] of parents.entries()) {
    // A project at a drive's root has no parent folder.
    if (same(parent, root)) continue;
    let names = [];
    try { names = fs.readdirSync(parent, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => e.name).sort(); } catch { continue; }
    if (names.length > SCAN_MAX) notes.push(`note: ${slashes(parent)} has ${names.length} folders; the first ${SCAN_MAX} were looked at`);
    for (const name of names.slice(0, SCAN_MAX)) {
      const folder = path.join(parent, name);
      if (same(folder, root)) continue;
      const dotGit = path.join(folder, '.git');
      let gitIsFolder;
      try { gitIsFolder = fs.statSync(dotGit).isDirectory(); } catch { continue; }
      // A .git folder is a main worktree's common dir; only a .git file (another worktree) needs git.
      const theirs = gitIsFolder ? dotGit : commonDir(folder);
      if (theirs && own && same(theirs, own)) continue;
      // Names in one folder are unique: only the second parent can repeat a folder.
      if (i === 0 || !out.some((f) => same(f, folder))) out.push(folder);
    }
  }
  return { folders: out, notes };
}

// What a planned prefix says about a folder: "planning prefix WEB", "no planning prefix", ...
function prefixText(folder, mapKey) {
  const p = plannedPrefix(folder);
  if (p.broken) return '.keel/config.json cannot be read';
  if (!p.prefix) return 'no planning prefix';
  return mapKey && p.prefix !== mapKey ? `planning prefix ${p.prefix} (not ${mapKey})` : `planning prefix ${p.prefix}`;
}

// plans.js repos: this project and the repositories a feature may also touch: the repos map, then the
// git repositories next to the project.
function reposCommand(root) {
  const s = settings(root);
  const lines = [];
  const seen = [];
  for (const [prefix, folder] of Object.entries(s.repos)) {
    seen.push(folder);
    const state = !isFolder(folder) ? 'not on this machine'
      : !isRepoTop(folder) ? 'not a git repository' : prefixText(folder, prefix);
    lines.push(`- ${clean(folder, 200)}: repos map ${prefix}, ${state}`);
  }
  const { folders, notes } = nextTo(root);
  let near = 0;
  for (const folder of folders) {
    if (seen.some((f) => same(f, folder))) continue;
    near += 1;
    lines.push(`- ${clean(slashes(folder), 200)}: next to this project, ${prefixText(folder, null)}`);
  }
  const count = Object.keys(s.repos).length;
  return [
    `repos: ${count + near} (repos map ${count}, next to this project ${near})`,
    `this project: ${s.ticket_prefix || '-'} (${clean(slashes(root), 200)})`,
    ...lines,
    ...notes,
  ];
}

const planRepos = (fm) => (given(fm.repos) ? fm.repos.replace(/[[\]]/g, '').split(/[\s,;]+/).filter(Boolean) : []);

function planReposProblems(fm, own) {
  const list = planRepos(fm);
  const out = [];
  for (const p of list) if (!PREFIX.test(p)) out.push(`plan.md: repos: "${clean(p, 20)}" is not a ticket prefix`);
  for (const p of new Set(list.filter((p, i) => list.indexOf(p) !== i))) out.push(`plan.md: repos: ${clean(p, 20)} appears twice`);
  if (list.length && own && list[0] !== own) out.push(`plan.md: repos: this project's prefix ${own} comes first`);
  return out;
}

// The other repositories a draft names: in `repos:` and in its tickets' `repo:`.
function namedRepos(fm, ticketList, own) {
  const all = [...planRepos(fm), ...ticketList.map((t) => t.fm.repo).filter(given)].map((p) => p.trim());
  return [...new Set(all)].filter((p) => p !== own);
}

// The repository a ticket is for: this project (`own`), or another one's prefix with its folder from
// the repos map, or `why` it has none on this machine. `bad`: the field is not a prefix.
function targetOf(root, t, s = settings(root)) {
  const repo = given(t.fm.repo) ? t.fm.repo.trim() : null;
  if (!repo || repo === s.ticket_prefix) return { own: true, prefix: s.ticket_prefix, folder: root };
  if (!PREFIX.test(repo)) return { own: false, bad: true, prefix: repo, folder: null };
  const folder = s.repos[repo];
  const why = !folder ? `no folder for ${repo} in the repos map: plans.js settings set --repo ${repo}=<folder>`
    : !isFolder(folder) ? `${folder} is not on this machine` : null;
  return { own: false, prefix: repo, folder: why ? null : folder, why };
}

const headOf = (folder) => git(folder, ['rev-parse', '--short', 'HEAD']);

function commitsOf(fm) {
  const out = new Map();
  if (!given(fm.after_commit_repos)) return out;
  for (const part of fm.after_commit_repos.split(/[\s,;]+/)) {
    const m = /^([A-Z][A-Z0-9]*)=([0-9a-f]{4,40})$/i.exec(part);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const commitsText = (map) => (map.size ? [...map].map(([p, c]) => `${p}=${c}`).join(', ') : '-');

// plans.js set --repos: the new `repos:` value from "WEB,MOB" (this project's prefix first, added when
// missing; `-` for this project only), or `why` it is refused. Each other repository must be in the
// repos map, on this machine, a git repository, and plan with the same prefix if it has one set; one
// with none set yet is taken, and its own config is not checked until a feature on several
// repositories can be exported.
function reposValue(root, raw, s = settings(root)) {
  const own = s.ticket_prefix;
  if (!own) return { why: 'this project has no planning prefix: /keel:configure planning' };
  if (typeof raw !== 'string' || !raw.trim()) return { why: 'give the prefixes, "WEB,MOB", or - for this project only' };
  if (raw.trim() === '-') return { list: [], value: '-' };
  const asked = raw.split(/[\s,;]+/).filter(Boolean).map((p) => p.toUpperCase());
  const others = [];
  for (const p of asked) {
    if (!PREFIX.test(p)) return { why: `"${clean(p, 20)}" is not a ticket prefix (2-10 capital letters and digits, starting with a letter)` };
    if (p === own && s.repos[p] && !same(s.repos[p], root)) return { why: `the repos map gives this project's prefix ${own} to ${clean(s.repos[p], 200)}: two repositories in one plan need different prefixes (/keel:configure planning there)` };
    if (p === own) continue;
    if (others.includes(p)) return { why: `${p} is named twice` };
    const folder = s.repos[p];
    if (!folder) return { why: `no folder for ${p} in the repos map: plans.js settings set --repo ${p}=<folder>` };
    if (!isFolder(folder)) return { why: `${clean(folder, 200)} (${p}) is not on this machine: plan stubs for it instead` };
    if (same(folder, root)) return { why: `${clean(folder, 200)} (${p}) is this project` };
    if (!isRepoTop(folder)) return { why: `${clean(folder, 200)} (${p}) is not a git repository` };
    const planned = plannedPrefix(folder);
    if (planned.broken) return { why: `${clean(folder, 200)}/.keel/config.json cannot be read: fix it there with /keel:configure` };
    if (planned.prefix === own) return { why: `${clean(folder, 200)} (${p}) plans with this project's prefix ${own}: two repositories in one plan need different prefixes (/keel:configure planning there)` };
    if (planned.prefix && planned.prefix !== p) return { why: `${clean(folder, 200)} plans with the prefix ${planned.prefix}, not ${p}: plans.js settings set --repo ${planned.prefix}=<folder>` };
    for (const [q, f] of Object.entries(s.repos)) if (q !== p && others.includes(q) && same(f, folder)) return { why: `${p} and ${q} are the same folder` };
    others.push(p);
  }
  const list = others.length ? [own, ...others] : [];
  return { list, value: list.length ? `[${list.join(', ')}]` : '-' };
}

// after_commit_repos for `list`: the old commits kept, the HEAD of each repository in `fresh` (or of
// the new ones only) taken from its folder when it is on this machine.
function recordCommits(fm, list, s, fresh = null) {
  const old = commitsOf(fm);
  const out = new Map();
  for (const p of list.filter((x) => x !== s.ticket_prefix)) {
    const folder = s.repos[p];
    const take = fresh === 'all' || !old.has(p);
    const head = take && folder && isFolder(folder) ? headOf(folder) : null;
    if (head) out.set(p, head);
    else if (old.has(p)) out.set(p, old.get(p));
  }
  return out;
}

// The other repositories of `list` on this machine with no commit yet: stale has nothing to compare with.
const noCommitNotes = (list, s) => list
  .filter((p) => p !== s.ticket_prefix && s.repos[p] && isFolder(s.repos[p]) && !headOf(s.repos[p]))
  .map((p) => `note: ${p} has no commit yet: stale cannot check its tickets until it has one`);

module.exports = {
  reposCommand, planRepos, planReposProblems, namedRepos, targetOf, headOf, commitsOf, commitsText, reposValue, recordCommits,
  noCommitNotes,
};
