'use strict';
// The keys of exported tickets, and plans.js commit and push: the planning files go into git. The export
// itself: lib/plans-export-repos.js.
// - Keys: <prefix>-<n>, n = 1 + the highest number of the prefix (notes.js TRACKER, exact: PROJ-10 is not
//   PROJ-101) in the commit messages and ticket file names of every branch, the branch names, and the
//   file names in the repository's ticket folders and in this machine's feature folders, after a fetch.
// - Commit and push check the keys again: a key another ticket file took (on any branch or in the working
//   tree) gets a new number while the ticket is not on a remote yet. A ticket folder HEAD has and the
//   working tree no longer has (a dropped feature) is committed as its removal.
// - An exported feature is reopened for editing (plans.js mark set, ticket, check) in its folder: a new
//   ticket takes the next key the same way; depends_on are keys.
// Claude Code asks before every commit and push (hooks/own-files.js).
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { settings, exportDir } = require('./plans-settings.js');
const { git: readGit, read, frontmatter, clean } = require('./repo-read.js');
const { linkOnWay, safeLocalPath, samePath } = require('./safe-path.js');
const { moveToTrash, restore } = require('./trash.js');
const { repoName, ticketLine } = require('./plans-format.js');
const { TRACKER } = require('../notes.js');
const flow = require('../git-flow.js');

const TEMP = '.export-tmp';
// How deep the file names of ticket folders are read: <folder>/<feature>/<file> and a little more.
const WALK_DEPTH = 4;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const gitText = (r) => clean(flow.firstLines(r.err || r.out, 2), 300);

// --- keys ---

const prefixOfKey = (key) => key.slice(0, key.lastIndexOf('-')).toUpperCase();
const numberOfKey = (key) => Number(key.slice(key.lastIndexOf('-') + 1));
const byNumber = (a, b) => prefixOfKey(a).localeCompare(prefixOfKey(b)) || numberOfKey(a) - numberOfKey(b);

// The highest number of the prefix's keys in a text, any case; 0 for none.
function highestIn(text, prefix) {
  let top = 0;
  for (const m of String(text || '').matchAll(TRACKER)) {
    if (prefixOfKey(m[1]) === prefix) top = Math.max(top, numberOfKey(m[1]));
  }
  return top;
}

// File names under the folders; temporary export folders are skipped.
function fileNames(dirs) {
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isFile()) out.push(e.name);
      else if (e.isDirectory() && depth < WALK_DEPTH && !e.name.endsWith(TEMP)) walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return out;
}

// The folders whose file names count: the repository's ticket and draft folders, this machine's feature
// folders.
function keyFolders(root, s) {
  const repo = [exportDir(root, s), ...plans.draftDirs(root).filter((d) => !d.local).map((d) => d.dir)].filter(Boolean);
  let local = [];
  try { local = fs.readdirSync(plans.base(root), { withFileTypes: true }).filter((e) => e.isDirectory() && plans.validFeature(e.name)).map((e) => path.join(plans.base(root), e.name)); } catch { /* none */ }
  return [...new Set(repo), ...local];
}

// The highest number the prefix has anywhere keys are looked for (see the top of this file). Only the
// commit messages that name a key of the prefix are read, so a long history stays small. A git source
// that cannot be read is named in `notes`: keys may then be incomplete.
function highestKey(root, prefix, s, repo, notes = []) {
  const texts = [fileNames(keyFolders(root, s)).join('\n')];
  if (repo) {
    const sources = [
      ['commit messages', ['log', '--all', '-i', '--extended-regexp', `--grep=${prefix}-[0-9]`, '--format=%B']],
      ['ticket file names', ['log', '--all', '--name-only', '--format=', '--', `:(icase)*${prefix}-*.md`]],
      ['branch names', ['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads', 'refs/remotes']],
    ];
    const unread = [];
    for (const [name, args] of sources) {
      const text = readGit(root, args);
      if (text === null) unread.push(name);
      texts.push(text);
    }
    if (unread.length) notes.push(`keys: may be incomplete (git could not read the ${unread.join(', ')}); check that the new keys are free`);
  }
  return Math.max(0, ...texts.map((t) => highestIn(t, prefix)));
}

// Whether the project is in a git repository, and its remote (git-flow's choice) after a fetch. `notes`
// says when keys come from less than the remote knows; `failed`: there is a remote and the fetch failed.
// A remote that never answers (a stalled proxy or VPN) is a failed fetch after `timeoutMs`, not a hang.
function fetched(root, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (readGit(root, ['rev-parse', '--git-dir']) === null) return { repo: false, failed: false, notes: ['fetch: not a git repository; keys from the files here only'] };
  const remote = flow.pickRemote((readGit(root, ['remote']) || '').split('\n').filter(Boolean));
  if (!remote) return { repo: true, failed: false, notes: ['fetch: no remote, skipped; keys from this clone only'] };
  const failed = (why) => ({ repo: true, failed: true, notes: [`fetch: ${remote} failed (${why}); keys from what this clone knows`] });
  let r;
  try { r = flow.git(root, ['fetch', '--prune', remote], undefined, timeoutMs); } catch (e) {
    if (e.code !== 'ETIMEDOUT') throw e;
    return failed(`no answer in ${Math.round(timeoutMs / 1000)} s`);
  }
  return r.ok ? { repo: true, failed: false, notes: [] } : failed(gitText(r));
}
// Room for a slow but working fetch, under Claude Code's 2-minute limit for a shell command.
const FETCH_TIMEOUT_MS = 60 * 1000;

// --- files ---

// A path keel writes, moves or removes: under .keel/local through safeLocalPath, in the repository with
// no link on the way.
function safe(root, file, local) {
  if (local) return safeLocalPath(root, ...path.relative(path.join(root, '.keel', 'local'), file).split(path.sep));
  const why = linkOnWay(root, file);
  if (why) throw new Error(`${why}: keel does not write through it`);
  return file;
}

// The exported tickets in a folder (front matter `type: ticket` with a key), and its overview.
function folderFiles(folder) {
  let names = [];
  try { names = fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name); } catch { /* none */ }
  return names.map((name) => { const file = path.join(folder, name); const text = read(file) || ''; return { name, file, text, fm: frontmatter(text) }; });
}
const exportedTickets = (folder) => folderFiles(folder).filter((t) => t.fm.type === 'ticket' && t.fm.key);

// --- the exported feature, reopened ---

const KEY = /^[A-Z][A-Z0-9]+-\d+$/;
// Branches without a commit for longer are not read for a feature's tickets (as plans.js tickets).
const RECENT_DAYS = 30;

// The folders among git's paths (from the project folder) that hold a ticket-named file
// (<KEY>-<slug>.md) and are named after the feature, as absolute paths. The tickets_dir setting is this
// machine's: a colleague's feature folder may be anywhere.
function namedFolders(root, feature, paths) {
  const named = new RegExp(`(?:^|/)${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[A-Za-z][A-Za-z0-9]+-\\d+(?:-[^/]*)?\\.md$`);
  const rels = [...new Set(paths.filter((p) => named.test(p)).map((p) => p.slice(0, p.lastIndexOf('/'))))].sort();
  return rels.map((r) => path.join(root, ...r.split('/')));
}
const gitPaths = (root, [command, ...args]) => (readGit(root, [command, '-z', ...args]) || '').split('\0').filter(Boolean);

// The feature's exported tickets in the working tree: <tickets_dir>/<feature>/, this machine's
// <base>/<feature>/tickets/, else any folder of the project named after the feature with a ticket-named
// file git sees (committed or not, not ignored). null when none holds a ticket.
function featureFolder(root, feature) {
  const dir = exportDir(root);
  const found = (folder, local) => {
    const list = exportedTickets(folder).sort((a, b) => byNumber(a.fm.key, b.fm.key));
    return list.length ? { folder, local, list } : null;
  };
  const first = (dir && found(path.join(dir, feature), false)) || found(path.join(plans.base(root), feature, 'tickets'), true);
  if (first) return first;
  for (const folder of namedFolders(root, feature, gitPaths(root, ['ls-files', '-co', '--exclude-standard']))) {
    const f = found(folder, false);
    if (f) return f;
  }
  return null;
}

// A branch whose tree has the feature's ticket files (<KEY>-<slug>.md in a folder named after the
// feature), or null: the feature's own branch first, then the local branches, then the remote's. Other
// branches count only with a commit in the last RECENT_DAYS days, so hundreds of old remote branches
// are not read. A branch at HEAD's commit is never named: switching to it changes nothing.
function branchWith(root, feature, now = Date.now()) {
  const head = readGit(root, ['rev-parse', '-q', '--verify', 'HEAD']);
  const since = now / 1000 - RECENT_DAYS * 86400;
  const refs = (readGit(root, ['for-each-ref', '--format=%(objectname) %(committerdate:unix) %(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n')
    .map((l) => /^([0-9a-f]+) (\d*) (refs\/(heads|remotes)\/(.+))$/.exec(l)).filter((m) => m && m[1] !== head && !(m[4] === 'remotes' && /\/HEAD$/.test(m[5])))
    .map((m) => ({ sha: m[1], date: Number(m[2]), name: m[5], remote: m[4] === 'remotes' }))
    .map((r) => ({ ...r, rank: ((r.remote ? r.name.slice(r.name.indexOf('/') + 1) : r.name) === feature ? 0 : 2) + (r.remote ? 1 : 0) }))
    .filter((r) => r.rank < 2 || r.date >= since)
    .sort((a, b) => a.rank - b.rank);
  if (!refs.length) return null;
  // Only the .md files directly in a folder named after the feature, from the project folder: a diff
  // against the empty tree takes the glob pathspec ls-tree does not.
  const empty = readGit(root, ['hash-object', '-t', 'tree', '--stdin'], '');
  if (!empty) return null;
  const has = new Map();
  for (const r of refs) {
    // The same commit is read once.
    if (!has.has(r.sha)) has.set(r.sha, namedFolders(root, feature, gitPaths(root, ['diff', '--relative', '--name-only', '--no-renames', empty, r.sha, '--', `:(glob)**/${feature}/*.md`])).length > 0);
    if (has.get(r.sha)) return r.name;
  }
  return null;
}

// The keys no ticket file has: not in the feature, on a branch, in the working tree or in this
// machine's feature folders. Another repository's key is looked for only in that repository
// (lib/plans-neighbours.js), never among the file names here: `where` says where it is missing, `notes`
// the ones not checked.
function missingKeys(root, keys, f) {
  const own = new Set(f.list.map((t) => t.fm.key.toUpperCase()));
  const rest = [...new Set(keys)].filter((k) => !own.has(k));
  const other = require('./plans-neighbours.js').lookUp(root, rest);
  const local = rest.filter((k) => !other.foreign(k));
  // Another repository's key is missing only when that repository lacks it; not checked is never missing.
  const out = (here) => ({ missing: [...here, ...rest.filter((k) => other.missing.has(k))], where: other.missing, notes: other.notes });
  const valid = local.filter((k) => KEY.test(k));
  if (!valid.length) return out(local);
  const { taken } = keyCheck(root, valid, f.folder);
  const names = fileNames(keyFolders(root, settings(root))).map((n) => n.toUpperCase());
  return out(local.filter((k) => !KEY.test(k) || (!taken.has(k) && !names.some((n) => n === `${k}.MD` || n.startsWith(`${k}-`)))));
}

// "API-121" or "API-121 in <folder> (<server data>)" for a key missingKeys found missing.
const missingText = (m, k) => `${clean(k)}${m.where.has(k) ? ` ${m.where.get(k)}` : ''}`;

// plans.js ticket on an exported feature: the next key of the feature's prefix (fetch, the highest
// anywhere + 1), <KEY>-<slug>.md beside the others with a sibling's feature, branch and merge_into; then
// its line in the Tickets of every overview of the feature on this machine. `repo`: another repository
// of the overview takes the ticket, with its own key and siblings (lib/plans-export-repos.js).
function exportedTicket(root, feature, f, { title, slug, deps, repo }) {
  const what = 'ticket';
  const across = require('./plans-export-repos.js');
  const at = repo !== undefined && repo.trim().toUpperCase() !== settings(root).ticket_prefix ? across.otherFeature(root, feature, f, repo, what) : { root, f };
  if (at.why) return at.why;
  // The fetch first: a key the dependencies name may be on the remote only.
  const git = fetched(root);
  const there = at.root === root ? git : fetched(at.root);
  const depends = deps.map((x) => x.toUpperCase());
  const m = missingKeys(root, depends, f);
  if (m.missing.length) return refuse(what, `--depends: no ticket ${m.missing.map((x) => missingText(m, x)).join(', ')}`);
  const sibling = at.f.list[0];
  const prefix = prefixOfKey(sibling.fm.key);
  // The folder's own keys too: found by its name, it may be outside the folders highestKey reads, and a
  // new ticket there is not in git yet.
  const own = at.f.list.filter((t) => prefixOfKey(t.fm.key) === prefix).map((t) => numberOfKey(t.fm.key));
  const key = `${prefix}-${Math.max(highestKey(at.root, prefix, settings(at.root), there.repo, there.notes), ...own) + 1}`;
  const file = path.join(at.f.folder, `${key}-${slug}.md`);
  const shown = at.root === root ? rel(root, file) : file.split(path.sep).join('/');
  if (fs.existsSync(file)) return refuse(what, `${shown} exists`);
  const t = plans.fromTemplate('ticket.md', {
    type: 'ticket', key, status: 'todo', feature: sibling.fm.feature || feature,
    ...(plans.PAGE_CODE.test(sibling.fm.page || '') ? { page: sibling.fm.page } : {}), branch: sibling.fm.branch || '-',
    merge_into: sibling.fm.merge_into || '-', depends_on: `[${depends.join(', ')}]`,
  });
  try { plans.writeFile(at.root, { local: at.f.local }, file, t.text(t.body.replace(/^# .*$/m, () => `# [${key}] ${title}`))); } catch (e) { return refuse(what, e.message); }
  const overviews = across.addToOverviews(root, feature, f, ticketLine(key, title, repoName(at.root)));
  return [`created: ${shown}`, `ticket: ${key}`, ...overviews, ...[...m.notes].map(([k, why]) => require('./plans-neighbours.js').noteLine(key, k, why)), ...git.notes, ...(there === git ? [] : there.notes.map((n) => `note: ${at.prefix}: ${n}`))];
}

// plans.js check on an exported feature: each ticket's structure as in a draft, its key, status and
// depends_on (keys of the feature or other existing ones), no cycles.
function exportedProblems(root, f) {
  const out = [];
  const list = f.list.map((t) => ({ ...t, id: t.fm.key.toUpperCase(), deps: plans.ticketIds(t.fm.depends_on).map((x) => x.toUpperCase()) }));
  const m = missingKeys(root, list.flatMap((t) => t.deps.filter((x) => x !== t.id)), f);
  const missing = new Set(m.missing);
  const notes = [];
  const twins = new Map();
  for (const t of list) twins.set(t.id, [...(twins.get(t.id) || []), t.name]);
  for (const [id, names] of twins) if (names.length > 1) out.push(`${id}: duplicate key (${names.length} files: ${names.sort().map((n) => clean(n)).join(', ')})`);
  for (const t of list) {
    const upper = t.name.toUpperCase();
    if (!upper.startsWith(`${t.id}-`) && upper !== `${t.id}.MD`) out.push(`${t.id}: the file name ${clean(t.name)} does not start with the key`);
    if (!['todo', 'done'].includes(t.fm.status)) out.push(`${t.id}: status is "${clean(t.fm.status || '')}"; todo or done`);
    out.push(...plans.ticketProblems(root, t.id, t.text));
    for (const dep of t.deps) {
      if (dep === t.id) out.push(`${t.id}: depends on itself`);
      else if (missing.has(dep)) out.push(`${t.id}: depends on ${clean(dep)}, which does not exist${m.where.has(dep) ? ` ${m.where.get(dep)}` : ''}`);
      else if (m.notes.has(dep)) notes.push(require('./plans-neighbours.js').noteLine(t.id, dep, m.notes.get(dep)));
    }
  }
  for (const c of plans.cycles(list.map((t) => ({ id: t.id, fm: { depends_on: t.deps.join(',') } })))) out.push(`dependency cycle: ${c}`);
  const folders = plans.machineFolders(root);
  const overview = read(path.join(f.folder, 'README.md'));
  if (overview !== null) out.push(...plans.localProblems('README.md', overview, folders));
  for (const r of plans.researchTexts(f.folder)) out.push(...plans.localProblems(r.name, r.text, folders));
  return { out, count: list.length, notes };
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

// The feature's planning files in the repository: its draft there, its ticket folder and the exported
// tickets in it, or the removal of a ticket folder HEAD has and the working tree no longer has.
// { why } when none of it belongs in git.
function featureFiles(root, feature, what) {
  if (!plans.validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}"`) };
  const drafts = plans.listDrafts(root).filter((d) => d.feature === feature);
  const draft = drafts.find((d) => !d.local) || null;
  // The ticket folder as plans.js mark set, ticket and check find it, wherever tickets_dir points.
  const found = featureFolder(root, feature);
  const dir = exportDir(root);
  const folder = found && !found.local ? found.folder : dir ? path.join(dir, feature) : null;
  const list = found && !found.local ? found.list : [];
  if (!draft && !list.length) {
    const preferred = (a, b) => (samePath(a, folder || '') ? -1 : samePath(b, folder || '') ? 1 : 0);
    const gone = namedFolders(root, feature, gitPaths(root, ['ls-tree', '-r', '--name-only', 'HEAD'])).filter((f) => !fs.existsSync(f)).sort(preferred)[0];
    if (gone) return { draft: null, folder: gone, list, exported: false, removed: true, keys: [] };
    if (drafts.length) return { why: refuse(what, `the draft of ${feature} is on this machine: none of it goes into git`) };
    if (fs.existsSync(path.join(plans.base(root), feature, 'tickets'))) return { why: refuse(what, `the tickets of ${feature} are on this machine (tickets pc): none of it goes into git`) };
    return { why: refuse(what, `no draft or exported tickets "${feature}" in the repository`) };
  }
  const exported = list.length > 0 && (!draft || plans.stateOf(draft) === 'exported');
  return { draft, folder, list, exported, keys: list.map((t) => t.fm.key.toUpperCase()) };
}

// Our keys another ticket file has (<key>.md or <key>-<slug>.md outside our folder, on a local or remote
// branch or in the working tree): key -> where. And our keys a remote already has in our folder.
function keyCheck(root, keys, folder) {
  const named = new RegExp(`(?:^|/)(${keys.join('|')})(?:-[^/]*)?\\.md$`, 'i');
  const ours = `${rel(root, folder).toLowerCase()}/`;
  const taken = new Map();
  const published = new Map();
  const look = (paths, where, remote) => {
    for (const p of paths) {
      const m = named.exec(p);
      if (!m) continue;
      const key = m[1].toUpperCase();
      if (!p.toLowerCase().startsWith(ours)) { if (!taken.has(key)) taken.set(key, `${p} ${where}`); } else if (remote && !published.has(key)) published.set(key, where);
    }
  };
  const trees = new Map();
  const refs = (readGit(root, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n').filter(Boolean);
  for (const line of refs) {
    const [sha, ref] = [line.slice(0, line.indexOf(' ')), line.slice(line.indexOf(' ') + 1)];
    // The same commit is read once.
    if (!trees.has(sha)) trees.set(sha, (readGit(root, ['ls-tree', '-r', '-z', '--name-only', sha]) || '').split('\0').filter(Boolean));
    look(trees.get(sha), `on ${ref.replace(/^refs\/(heads|remotes)\//, '')}`, ref.startsWith('refs/remotes/'));
  }
  look((readGit(root, ['ls-files', '-z', '-co', '--exclude-standard']) || '').split('\0').filter(Boolean), 'in the working tree', false);
  return { taken, published };
}

// New numbers for the taken keys (key -> the repository folder its prefix is counted in), in key order.
function newNumbers(taken, notes) {
  const next = new Map();
  return new Map([...taken.keys()].sort(byNumber).map((k) => {
    const p = prefixOfKey(k);
    const root = taken.get(k);
    if (!next.has(p)) next.set(p, highestKey(root, p, settings(root), true, notes) + 1);
    const n = next.get(p);
    next.set(p, n + 1);
    return [k, `${p}-${n}`];
  }));
}

// The keys of `map` replaced in every file of a feature folder (ticket files renamed); `local`: the folder
// is under .keel/local.
function rewriteKeys(root, folder, map, local = false) {
  const re = new RegExp(`(?<![A-Za-z0-9_-])(${[...map.keys()].join('|')})(?!\\d)`, 'gi');
  for (const f of folderFiles(folder)) {
    const key = String(f.fm.key || '').toUpperCase();
    const name = f.fm.type === 'ticket' && map.has(key) && f.name.toUpperCase().startsWith(key) ? `${map.get(key)}${f.name.slice(key.length)}` : f.name;
    const text = f.text.replace(re, (m) => map.get(m.toUpperCase()));
    if (text === f.text && name === f.name) continue;
    fs.writeFileSync(safe(root, path.join(folder, name), local), text);
    if (name !== f.name) fs.rmSync(safe(root, f.file, local), { force: true });
  }
}

const renumberedLines = (map) => [...map].map(([k, v]) => `renumbered: ${k} -> ${v}`);

// The keys of an exported feature checked in each of its repositories on this machine (`repos`:
// [{ prefix, root }]; one for a feature on one repository), each against its own git. A taken key gets
// a new number counted in its repository and is replaced in every feature folder of the feature, also
// one on this machine only (tickets pc), so depends_on and the overview stay the same everywhere.
// { lines } or { why } (a published key is never renumbered).
function keysAcross(repos, feature, fetchedRoot, notes) {
  const found = repos.map((r) => ({ ...r, f: featureFolder(r.root, feature) })).filter((r) => r.f);
  const taken = new Map();
  // Tickets on this machine never reach git, so only a repository's tickets can be taken.
  for (const r of found.filter((x) => !x.f.local)) {
    if (r.root !== fetchedRoot) notes.push(...fetched(r.root).notes.map((n) => `note: ${r.prefix}: ${n}`));
    const keys = r.f.list.map((t) => t.fm.key.toUpperCase());
    const k = keyCheck(r.root, keys, r.f.folder);
    const stuck = [...k.taken.keys()].find((x) => k.published.has(x));
    if (stuck) return { why: publishedTaken(stuck, k.taken, k.published) };
    for (const key of k.taken.keys()) taken.set(key, r.root);
  }
  if (!taken.size) return { lines: [] };
  const map = newNumbers(taken, notes);
  for (const r of found) rewriteKeys(r.root, r.f.folder, map, r.f.local);
  return { lines: renumberedLines(map) };
}

// Whether git knows a path: in the working tree, the index or HEAD.
const known = (root, p) => fs.existsSync(path.join(root, p)) || Boolean(readGit(root, ['ls-files', '--', p])) || Boolean(readGit(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', p]));

// An exported draft's own files: plan.md, reviews/, its T-files and, when the tickets went to another
// folder, research/ (export copied it there).
function draftFiles(root, d, folder) {
  const own = [plans.PLAN_FILE, 'reviews', ...(folder && samePath(path.resolve(folder), path.resolve(d.folder)) ? [] : ['research'])];
  const out = own.map((n) => path.join(d.folder, n)).filter((f) => fs.existsSync(f));
  let names = [];
  try { names = fs.readdirSync(path.join(d.folder, 'tickets')).filter((n) => plans.TICKET_FILE.test(n)); } catch { /* none */ }
  return [...out, ...names.map((n) => path.join(d.folder, 'tickets', n))].map((f) => rel(root, f));
}

// A key of ours another ticket file has, while ours is already on a remote.
const publishedTaken = (k, taken, published) => `${k} is also ${taken.get(k)}, and this feature's ${k} is already ${published.get(k)}: a published key is not renumbered; settle the duplicate by hand`;

// `repo`: the prefix of another repository of the feature's overview: the commit runs there, its folder
// taken from this project's repos map (lib/plans-export-repos.js).
function commitFeature(project, feature, { repo } = {}) {
  const what = 'commit';
  const at = require('./plans-export-repos.js').repoFor(project, feature, repo, what);
  if (at.why) return at.why;
  const root = at.root;
  const { ctx, why } = gitReady(root, what);
  if (!ctx) return why;
  const c = featureFiles(root, feature, what);
  if (c.why) return c.why;
  const renumbered = [];
  let notes = [];
  // The result first, then the renumbering (files renamed even when the commit stops) and the notes.
  const done = (result) => [...[].concat(result), ...renumbered, ...notes];
  if (c.exported) {
    notes = fetched(root).notes;
    let r;
    try { r = keysAcross(at.repos.length > 1 ? at.repos : [{ prefix: at.prefix, root }], feature, root, notes); } catch (e) { return done(refuse(what, `renumbering failed: ${e.message}`)); }
    if (r.why) return done(refuse(what, r.why));
    renumbered.push(...r.lines);
  }
  if (c.draft && plans.stateOf(c.draft) === 'exported') {
    const r = moveToTrash(root, draftFiles(root, c.draft, c.folder), 'planning');
    if (r.failed.length) {
      // All or none: what did go comes back, so the next run still sees the exported draft.
      if (r.batch) restore(root, r.batch);
      return done(refuse(what, `the draft's files did not go to keel's trash: ${r.failed.map((f) => `${f.path}: ${f.reason}`).join(', ')}`));
    }
    for (const dir of [path.join(c.draft.folder, 'tickets'), c.draft.folder]) { try { fs.rmdirSync(dir); } catch { /* not empty */ } }
  }
  // The draft folder, also after an earlier run moved the draft away, and the ticket folder when it holds
  // exported tickets (other files there are not planning's to commit).
  const folders = [c.draft && c.draft.folder, ...plans.draftDirs(root).filter((d) => !d.local).map((d) => path.join(d.dir, feature)), c.list.length || c.removed ? c.folder : null];
  const paths = [...new Set(folders.filter(Boolean).map((f) => rel(root, f)))].filter((p) => known(root, p));
  if (!paths.length) return done('commit: nothing to commit');
  let r = flow.git(root, ['add', '-A', '--', ...paths]);
  if (!r.ok) return done(refuse(what, `git add failed: ${gitText(r)}`));
  if (!flow.git(root, ['diff', '--cached', '--name-only', '--', ...paths]).out) return done('commit: nothing to commit');
  // No keys in the message: a commit with a key reads as work on that ticket. Tickets HEAD already has
  // in the folder (a reopened feature) are updated; a draft committed there before does not count.
  const inHead = c.exported && gitPaths(root, ['ls-tree', '--name-only', 'HEAD', '--', `${rel(root, c.folder)}/`])
    .some((p) => /^[A-Za-z][A-Za-z0-9]+-\d+(?:-[^/]*)?\.md$/.test(p.slice(p.lastIndexOf('/') + 1)));
  const message = c.removed ? `Remove the ${feature} tickets` : inHead ? `Update the ${feature} tickets` : c.exported ? `Add the ${feature} tickets` : `Plan ${feature}`;
  // Only these paths: changes staged before stay staged and out of this commit.
  r = flow.git(root, ['commit', '-q', '-m', message, '--', ...paths]);
  if (!r.ok) return done(refuse(what, `git commit failed (a project hook?): ${gitText(r)}`));
  return done(`committed: ${flow.git(root, ['rev-parse', '--short', 'HEAD']).out} ${message}`);
}

function pushFeature(project, feature, { repo } = {}) {
  const what = 'push';
  const at = require('./plans-export-repos.js').repoFor(project, feature, repo, what);
  if (at.why) return at.why;
  const root = at.root;
  const { ctx, why } = gitReady(root, what);
  if (!ctx) return why;
  const c = featureFiles(root, feature, what);
  if (c.why) return c.why;
  if (!ctx.remote) return ['push: no remote, nothing pushed'];
  const { notes } = fetched(root);
  if (c.exported) {
    const { taken, published } = keyCheck(root, c.keys, c.folder);
    const k = [...taken.keys()].sort(byNumber)[0];
    if (k && published.has(k)) return refuse(what, publishedTaken(k, taken, published));
    if (k) return refuse(what, `${k} is also ${taken.get(k)}: commit again (plans.js commit ${feature} gives it a new number), then push`);
  }
  const b = ctx.branch;
  const r = flow.git(root, ['push', '-u', ctx.remote, `refs/heads/${b}:refs/heads/${b}`]);
  if (r.ok) return [`pushed: ${b} -> ${ctx.remote}/${b}`, ...notes];
  const kind = flow.pushRefusal(r.err);
  if (kind === 'behind') return refuse(what, `${ctx.remote}/${b} has commits this branch does not have; look at them before pushing: ${gitText(r)}`);
  const refused = refuse(what, `the push of ${b} was refused (${kind}): ${gitText(r)}`);
  if (kind !== 'failed') return refused;
  // No network or no access: the same step, with its key check and confirmation, once that is fixed.
  const script = path.join(__dirname, '..', 'plans.js').split(path.sep).join('/');
  return [...refused, `retry: node "${script}" "${project.split(path.sep).join('/')}" push ${feature}${repo !== undefined && root !== project ? ` --repo ${at.prefix}` : ''}`];
}

module.exports = {
  commitFeature, pushFeature, fetched, highestKey, keyCheck,
  // for lib/plans.js, lib/plans-drafts.js and lib/plans-check.js
  featureFolder, branchWith, exportedTicket, exportedProblems,
  // for lib/plans-export-repos.js
  TEMP, safe, folderFiles,
};
