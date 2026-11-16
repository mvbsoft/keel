'use strict';
// A feature on several repositories. Another repository is named by its repository name
// (lib/plans-format.js repoNames: the remote's last part, else the folder's name; owner/name when two
// share one); this machine's repos map (lib/plans-settings.js) says where it is.
// - A ticket's `repo: <name>`, only for another repository (no field = this project): with `type: ticket`
//   the ticket is planned here from that repository's code; with `type: stub` (lib/plans-stubs.js) that
//   repository is not on this machine; with `type: elsewhere` the ticket itself lives in that
//   repository, in its own folder of the feature (<its tickets_dir>/<feature>/tickets/, the same
//   T-number), whose plan.md has only `type: plan`, `status`, `feature` and `home: <this repository's
//   name>`. The file here holds no status: its status, depends_on and review are read there.
// - plan.md `after_commit_repos: <name>=<commit>, ...`: each other repository's HEAD when its facts were
//   last checked, as `after_commit` is this project's.
// Nothing here writes; git only reads (rev-parse, remote, ls-files).
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('./config.js');
const { settings, settingsFile, validName } = require('./plans-settings.js');
const { git, clean } = require('./repo-read.js');
const { samePath } = require('./safe-path.js');
const { repoNames } = require('./plans-format.js');

// How many folders next to the project are looked at, per parent folder.
const SCAN_MAX = 200;
// The status of an elsewhere ticket whose file cannot be read.
const UNKNOWN = 'unknown';

const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const isFolder = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const slashes = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
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

// The names this project goes by: its name and owner/name.
const ownNames = (root) => { const n = repoNames(root); return new Set([n.name, n.full]); };

// Whether keel is set up in a folder: "keel set up", "no keel", or what is wrong with its config.
function keelText(folder) {
  const { state } = checkConfig(folder);
  return state === 'ok' ? 'keel set up' : state === 'missing' ? 'no keel' : `.keel/config.json ${state}`;
}

// `folder` (a real path, as git prints it) spelled through the nearest ancestor of `root` it lies under,
// so a link in root's path (macOS /var -> /private/var) shows as the user gave it; else `folder`.
function asGiven(folder, root) {
  const target = real(folder);
  for (let a = path.dirname(root); ; a = path.dirname(a)) {
    const r = path.relative(real(a), target);
    if (!r.startsWith('..') && !path.isAbsolute(r)) return path.join(a, r);
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

// plans.js repos: this project and the repositories a feature may also touch, each with the name a
// ticket's repo: and the repos map use: the repos map, then the git repositories next to the project.
// Next to it, a name that two of them share is given as owner/name.
function reposCommand(root) {
  const s = settings(root);
  const own = repoNames(root);
  const lines = [];
  const seen = [];
  for (const [name, folder] of Object.entries(s.repos)) {
    seen.push(folder);
    let state = !isFolder(folder) ? 'not on this machine' : !isRepoTop(folder) ? 'not a git repository' : null;
    if (!state) {
      const n = repoNames(folder);
      state = `${keelText(folder)}${name !== n.name && name !== n.full ? `, named ${n.name} (not ${name})` : ''}`;
    }
    lines.push(`- ${clean(folder, 200)}: repos map ${clean(name, 120)}, ${state}`);
  }
  const { folders, notes } = nextTo(root);
  const near = folders.filter((f) => !seen.some((x) => same(x, f))).map((folder) => ({ folder, n: repoNames(folder) }));
  const taken = [own.name, ...Object.keys(s.repos)];
  for (const { folder, n } of near) {
    const clash = taken.includes(n.name) || near.filter((x) => x.n.name === n.name).length > 1;
    lines.push(`- ${clean(slashes(folder), 200)}: next to this project, ${clash ? n.full : n.name}, ${keelText(folder)}`);
  }
  const count = Object.keys(s.repos).length;
  return [
    `repos: ${count + near.length} (repos map ${count}, next to this project ${near.length})`,
    `this project: ${own.name} (${clean(slashes(root), 200)})`,
    ...lines,
    ...notes,
  ];
}

// The repository a ticket is for: this project (`own`), or another one's name with its folder from the
// repos map, or `why` it has none on this machine. `bad`: the field is no repository name.
function targetOf(root, t, s = settings(root)) {
  const name = given(t.fm.repo) ? t.fm.repo.trim() : null;
  if (!name || ownNames(root).has(name)) return { own: true, name: null, folder: root };
  if (!validName(name)) return { own: false, bad: true, name, folder: null };
  const folder = s.repos[name];
  const why = !folder ? `no folder for ${name} in the repos map: plans.js settings set --repo ${name}=<folder>`
    : !isFolder(folder) ? `${folder} is not on this machine` : null;
  return { own: false, name, folder: why ? null : folder, why };
}

// A repos map in git is not this machine's own: another repository's folder is never taken from it for
// a write.
const mapTracked = (root) => Boolean(git(root, ['ls-files', '--', rel(root, settingsFile(root))]));

// The repository of a new ticket for another repository, --repo <name> (planned here) or --elsewhere
// <name> (the ticket goes into that repository): { name, folder } (name null: this project, only for
// --repo), or { why }. It is in the repos map, on this machine and a git repository; --elsewhere also
// needs keel set up there and a repos map that is not in git.
function ticketRepo(root, value, flag) {
  if (typeof value !== 'string' || !value.trim()) return { why: `${flag} needs a repository name: ${flag} <name> (plans.js repos lists them)` };
  const name = value.trim();
  if (ownNames(root).has(name)) return flag === '--repo' ? { name: null, folder: root } : { why: `${flag}: ${clean(name, 120)} is this project` };
  if (!validName(name)) return { why: `${flag}: "${clean(name, 120)}" is not a repository name (plans.js repos lists them)` };
  const folder = settings(root).repos[name];
  if (!folder) return { why: `${flag}: no folder for ${name} in the repos map: plans.js settings set --repo ${name}=<folder>` };
  if (!isFolder(folder)) return { why: `${flag}: ${clean(folder, 200)} (${name}) is not on this machine: plan a stub for it (--stub ${name})` };
  if (same(folder, root)) return { why: `${flag}: ${clean(folder, 200)} (${name}) is this project` };
  if (!isRepoTop(folder)) return { why: `${flag}: ${clean(folder, 200)} (${name}) is not a git repository` };
  if (flag === '--elsewhere') {
    if (keelText(folder) !== 'keel set up') return { why: `${flag}: ${clean(folder, 200)} (${name}): ${keelText(folder)}; plan the ticket here (--repo ${name})` };
    if (mapTracked(root)) return { why: `${flag}: the repos map ${rel(root, settingsFile(root))} is in git; keel writes into another repository only through this machine's own map: git rm --cached ${rel(root, settingsFile(root))}` };
  }
  return { name, folder };
}

// An elsewhere ticket's file in its repository: { name, folder, d (the feature there), t (the ticket
// there) }, or { why } it cannot be read. Read in that repository's working tree, never fetched.
function elsewhereOf(root, d, t, s = settings(root)) {
  const target = targetOf(root, t, s);
  if (target.own) return { why: 'its repo: is this project' };
  if (target.bad) return { why: `repo "${clean(target.name, 120)}" is no repository name` };
  if (!target.folder) return { why: clean(target.why, 300) };
  const drafts = require('./plans-drafts.js');
  const there = drafts.listDrafts(target.folder).find((x) => x.feature === d.feature && !x.local);
  const where = `${clean(slashes(target.folder), 200)}`;
  if (!there || !given(there.fm.home)) return { why: `no ${d.feature} of this plan in ${where}` };
  if (!ownNames(root).has(there.fm.home.trim())) return { why: `${d.feature} in ${where} belongs to ${clean(there.fm.home, 120)}` };
  const found = drafts.tickets(there).find((x) => x.id === t.id);
  if (!found) return { why: `no ${t.id} in ${where}/${rel(target.folder, there.folder)}/tickets/` };
  return { name: target.name, folder: target.folder, d: there, t: found };
}

// The feature's tickets as their statuses are: an elsewhere ticket with the front matter and text of
// its file there (`there`: elsewhereOf), or status unknown (`unknown`: why) when that cannot be read.
function withElsewhere(root, d, list, s = settings(root)) {
  return list.map((t) => {
    if (t.fm.type !== 'elsewhere') return t;
    const e = elsewhereOf(root, d, t, s);
    if (e.why) return { ...t, fm: { ...t.fm, status: UNKNOWN }, unknown: e.why };
    return { ...t, fm: { ...e.t.fm, id: t.id, type: 'elsewhere', repo: t.fm.repo }, text: e.t.text, there: e };
  });
}

// The other repositories the tickets name (repo:), stubs left out: their repository is not here.
const namedRepos = (root, list) => [...new Set(list.filter((t) => t.fm.type !== 'stub').map((t) => targetOf(root, t)).filter((x) => !x.own && !x.bad).map((x) => x.name))];

const headOf = (folder) => git(folder, ['rev-parse', '--short', 'HEAD']);

function commitsOf(fm) {
  const out = new Map();
  if (!given(fm.after_commit_repos)) return out;
  for (const part of fm.after_commit_repos.split(/[\s,;]+/)) {
    const m = /^(.+)=([0-9a-f]{4,40})$/i.exec(part);
    if (m && validName(m[1])) out.set(m[1], m[2]);
  }
  return out;
}

const commitsText = (map) => (map.size ? [...map].map(([n, c]) => `${n}=${c}`).join(', ') : '-');

// after_commit_repos for the repositories `names`: the old commits kept, the HEAD of each one taken
// from its folder when it is on this machine: of every one with `all`, else of the new ones only.
function recordCommits(fm, names, s, all = false) {
  const old = commitsOf(fm);
  const out = new Map();
  for (const n of names) {
    const folder = s.repos[n];
    const head = (all || !old.has(n)) && folder && isFolder(folder) ? headOf(folder) : null;
    if (head) out.set(n, head);
    else if (old.has(n)) out.set(n, old.get(n));
  }
  return out;
}

// The repositories of `names` on this machine with no commit yet: stale has nothing to compare with.
const noCommitNotes = (names, s) => names
  .filter((n) => s.repos[n] && isFolder(s.repos[n]) && !headOf(s.repos[n]))
  .map((n) => `note: ${n} has no commit yet: stale cannot check its tickets until it has one`);

module.exports = {
  reposCommand, targetOf, ticketRepo, elsewhereOf, withElsewhere, namedRepos, headOf, commitsOf, commitsText,
  recordCommits, noCommitNotes, isFolder, isRepoTop, same, ownNames, keelText, UNKNOWN,
};
