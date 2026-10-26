'use strict';
// plans.js export, commit and push: a ready plan's tickets go into the feature folder with keys shared
// across the repository, then the planning files go into git.
// - Keys: <prefix>-<n>, n = 1 + the highest number of the prefix (notes.js TRACKER, exact: PROJ-10 is not
//   PROJ-101) in the commit messages and ticket file names of every branch, the branch names, and the
//   file names in the repository's ticket folders and in this machine's feature folders, after a fetch.
// - Export is all or nothing: every key first, the T-numbers replaced in one pass, the files written into
//   a temporary folder next to the target, one rename. A draft in the repository whose folder is the
//   target gets the new files beside its own (they never clash with plan.md, tickets/ and reviews/).
//   A run that fails before the end is rolled back: no feature folder, the plan ready. The next run
//   removes what is left of an earlier one (a temporary folder, an overview and tickets of this feature
//   in the draft's folder) and starts again with the same keys. A run killed between two steps may leave
//   a state the next run refuses (a feature folder that exists); that one is settled by hand.
// - A draft on this machine goes to keel's trash once exported; one in the repository leaves with the
//   commit of its tickets.
// - Commit and push check the keys again: a key another ticket file took (on any branch or in the working
//   tree) gets a new number while the ticket is not on a remote yet.
// Claude Code asks before every commit and push (hooks/own-files.js).
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { git: readGit, read, frontmatter, clean } = require('./repo-read.js');
const { linkOnWay, safeLocalPath, samePath } = require('./safe-path.js');
const { moveToTrash, restore } = require('./trash.js');
const { sections } = require('./tasks.js');
const { checkConfig } = require('./config.js');
const { TRACKER } = require('../notes.js');
const flow = require('../git-flow.js');

const TEMP = '.export-tmp';
const README = 'README.md';
const README_SECTIONS = ['Summary', 'Problem / Goal', 'Decisions', 'Out of scope', 'Design sketch', 'Terms'];
// How deep the file names of ticket folders are read: <folder>/<feature>/<file> and a little more.
const WALK_DEPTH = 4;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const gitText = (r) => clean(flow.firstLines(r.err || r.out, 2), 300);

// --- keys ---

const prefixOfKey = (key) => key.slice(0, key.lastIndexOf('-')).toUpperCase();
const numberOfKey = (key) => Number(key.slice(key.lastIndexOf('-') + 1));
const byNumber = (a, b) => prefixOfKey(a).localeCompare(prefixOfKey(b)) || numberOfKey(a) - numberOfKey(b);

// The ticket prefix: the planning setting, else the first of comments.ticket_prefixes that is a valid one.
function prefixOf(root, s) {
  if (s.prefix) return s.prefix;
  const { state, config } = checkConfig(root);
  const list = state === 'ok' && config.comments && Array.isArray(config.comments.ticket_prefixes) ? config.comments.ticket_prefixes : [];
  return list.find((p) => typeof p === 'string' && !plans.SETTING_CHECKS.prefix(p)) || null;
}

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
  const repo = [plans.exportDir(root, s), ...plans.draftDirs(root).filter((d) => !d.local).map((d) => d.dir)].filter(Boolean);
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
// says when keys come from less than the remote knows.
function fetched(root) {
  if (readGit(root, ['rev-parse', '--git-dir']) === null) return { repo: false, notes: ['fetch: not a git repository; keys from the files here only'] };
  const remote = flow.pickRemote((readGit(root, ['remote']) || '').split('\n').filter(Boolean));
  if (!remote) return { repo: true, notes: ['fetch: no remote, skipped; keys from this clone only'] };
  const r = flow.git(root, ['fetch', '--prune', remote]);
  return { repo: true, notes: r.ok ? [] : [`fetch: ${remote} failed (${gitText(r)}); keys from what this clone knows`] };
}

// --- files ---

// A path keel writes, moves or removes: under .keel/local through safeLocalPath, in the repository with
// no link on the way.
function safe(root, file, local) {
  if (local) return safeLocalPath(root, ...path.relative(path.join(root, '.keel', 'local'), file).split(path.sep));
  const why = linkOnWay(root, file);
  if (why) throw new Error(`${why}: keel does not write through it`);
  return file;
}

const bodyOf = (text) => lf(text).replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();
const frontText = (front) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n`;

// The exported tickets in a folder (front matter `type: ticket` with a key), and its overview.
function folderFiles(folder) {
  let names = [];
  try { names = fs.readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name)).map((e) => e.name); } catch { /* none */ }
  return names.map((name) => { const file = path.join(folder, name); const text = read(file) || ''; return { name, file, text, fm: frontmatter(text) }; });
}
const exportedTickets = (folder) => folderFiles(folder).filter((t) => t.fm.type === 'ticket' && t.fm.key);

// What an export into the draft's own folder that did not finish left there: its tickets and overview.
const leftovers = (d) => folderFiles(d.folder).filter((f) => (f.fm.type === 'ticket' && f.fm.feature === d.feature) || (f.fm.type === 'feature' && f.name === README));

// The tickets and overview of the export: T-numbers replaced in one pass, only those of the draft (T1 is
// never part of T10).
function exportFiles(root, d, keys, front) {
  const swap = (text) => text.replace(/\bT(\d+)\b/g, (m) => keys.get(m) || m);
  const list = plans.tickets(d);
  const files = list.map((t) => {
    const key = keys.get(t.id);
    const deps = plans.ticketIds(t.fm.depends_on).map((x) => keys.get(x) || x);
    const text = frontText({ type: 'ticket', key, status: 'todo', ...front, depends_on: `[${deps.join(', ')}]` }) + swap(bodyOf(t.text));
    return { id: t.id, key, name: `${key}-${t.name.replace(/^T\d+-/, '')}`, text };
  });
  if (list.length < 2) return { files, readme: null };
  const secs = sections(d.text);
  const title = /^# (.+)$/m.exec(bodyOf(d.text));
  const parts = README_SECTIONS.filter((n) => secs[n]).map((n) => `## ${n}\n${swap(secs[n])}\n`);
  return { files, readme: { name: README, text: `${frontText({ type: 'feature' })}# ${swap(title ? title[1].trim() : d.feature)}\n\n${parts.join('\n')}` } };
}

// --- export ---

// `stop(step)`: tests interrupt the export after a step ('written', 'moved') by throwing.
function exportFeature(root, feature, { stop = () => {} } = {}) {
  const what = 'export';
  const { d: found, why } = plans.needDraft(root, feature, what);
  if (!found) return why;
  let d;
  try { d = plans.settle(root, found); } catch (e) { return refuse(what, e.message); }
  if (d.fm.status !== 'ready') return refuse(what, `the plan is ${d.fm.status}; only a ready plan is exported (/keel:end-planning)`);
  const { out: problems } = plans.problems(root, d);
  if (problems.length) return refuse(what, `check finds ${problems.length} problems (plans.js check ${feature})`);
  const s = plans.settings(root);
  if (!s.export) return refuse(what, 'where the tickets go is not set: plans.js settings set --export pc|repo');
  const prefix = prefixOf(root, s);
  if (!prefix) return refuse(what, 'no ticket prefix: plans.js settings set --prefix <PROJ>');
  const { branch, merge_into: mergeInto } = plans.branchesOf(root, d);
  if (!mergeInto) return refuse(what, `the plan names no branch to merge into: plans.js set ${feature} --merge-into <branch>`);
  const toRepo = s.export === 'repo';
  if (!toRepo && !d.local) return refuse(what, 'the draft is in the repository, so its tickets go there too: plans.js settings set --export repo');
  const dir = toRepo ? plans.exportDir(root, s) : null;
  if (toRepo && !dir) return refuse(what, 'export_dir is not a folder keel uses (plans.js settings)');
  // On this machine the feature folder takes the draft's place: <base>/<feature>/tickets/.
  const target = toRepo ? path.join(dir, feature) : d.folder;
  const intoDraft = toRepo && !d.local && samePath(path.resolve(target), path.resolve(d.folder));
  if (toRepo && !intoDraft && fs.existsSync(target)) return refuse(what, `${rel(root, target)}/ exists and is not this draft's folder: set another export_dir or move that folder away`);
  // The overview goes beside the draft's files: a README of the user's own there is never replaced.
  const ownReadme = path.join(target, README);
  if (intoDraft && plans.tickets(d).length >= 2 && fs.existsSync(ownReadme) && frontmatter(read(ownReadme) || '').type !== 'feature') {
    return refuse(what, `${rel(root, ownReadme)} is not keel's overview: move it away, then export again`);
  }
  const temp = intoDraft ? null : `${target}${TEMP}`;
  const local = !toRepo;
  try {
    if (temp) fs.rmSync(safe(root, temp, local), { recursive: true, force: true });
    else for (const f of leftovers(d)) fs.rmSync(safe(root, f.file, false), { force: true });
  } catch (e) { return refuse(what, `what an earlier export left is not removed: ${e.message}`); }

  const git = fetched(root);
  const first = highestKey(root, prefix, s, git.repo, git.notes) + 1;
  const keys = new Map(plans.tickets(d).map((t, i) => [t.id, `${prefix}-${first + i}`]));
  const { files, readme } = exportFiles(root, d, keys, { feature, branch, merge_into: mergeInto });
  const into = temp ? path.join(temp, local ? 'tickets' : '') : target;
  const made = [];
  let batch = null;
  let renamed = false;
  let marked = false;
  try {
    for (const f of readme ? [...files, readme] : files) {
      const file = path.join(into, f.name);
      plans.writeFile(root, { local }, file, f.text);
      if (!temp) made.push(file);
    }
    stop('written');
    if (local) {
      plans.writePlan(root, d, { status: 'exported', export: 'pc' });
      marked = true;
      const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
      if (!r.batch) throw new Error(`the draft did not go to keel's trash: ${r.failed.map((f) => f.reason).join(', ')}`);
      batch = r.batch;
      stop('moved');
      fs.renameSync(safe(root, temp, true), safe(root, target, true));
      renamed = true;
    } else {
      if (temp) { fs.renameSync(safe(root, temp, false), safe(root, target, false)); renamed = true; }
      stop('moved');
      plans.writePlan(root, d, { status: 'exported', export: 'repo' });
      marked = true;
    }
  } catch (e) {
    // Back to before the run: the draft out of keel's trash, plan.md ready, nothing new left.
    try { if (batch && !renamed) restore(root, batch); } catch { /* the trash keeps it */ }
    try { if (marked) plans.writeFile(root, d, path.join(d.folder, plans.PLAN_FILE), d.text); } catch { /* reported below */ }
    try { if (temp) fs.rmSync(safe(root, temp, local), { recursive: true, force: true }); } catch { /* the next run removes it */ }
    try { if (renamed && toRepo) fs.rmSync(safe(root, target, false), { recursive: true, force: true }); } catch { /* the next run refuses it */ }
    for (const f of made) { try { fs.rmSync(f, { force: true }); } catch { /* the next run removes it */ } }
    return refuse(what, `${e.message}; nothing exported, the plan stays ready`);
  }

  let draft;
  if (batch) draft = `draft: moved to keel's trash: batch ${batch}`;
  else if (d.local) {
    const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
    draft = r.batch ? `draft: moved to keel's trash: batch ${r.batch}` : `draft: not moved to keel's trash (${r.failed.map((f) => f.reason).join(', ')}); remove ${rel(root, d.folder)}/ by hand`;
  } else draft = `draft: plan.md, reviews/ and T-files leave with the commit (plans.js commit ${feature})`;
  const shown = rel(root, local ? path.join(target, 'tickets') : target);
  return [
    `exported: ${shown}/ (${files.length} tickets)`,
    ...files.map((f) => `- ${f.id} -> ${f.key}: ${shown}/${f.name}`),
    `readme: ${readme ? `${shown}/${README}` : 'none (1 ticket)'}`,
    draft,
    ...git.notes,
    ...(local ? ['note: these tickets are seen on this machine only'] : []),
  ];
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
// tickets in it. { why } when none of it belongs in git.
function featureFiles(root, feature, what) {
  if (!plans.validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}"`) };
  const drafts = plans.listDrafts(root).filter((d) => d.feature === feature);
  const draft = drafts.find((d) => !d.local) || null;
  const dir = plans.exportDir(root);
  const folder = dir ? path.join(dir, feature) : null;
  const list = folder ? exportedTickets(folder) : [];
  if (!draft && !list.length) {
    if (drafts.length) return { why: refuse(what, `the draft of ${feature} is on this machine: none of it goes into git`) };
    if (fs.existsSync(path.join(plans.base(root), feature, 'tickets'))) return { why: refuse(what, `the tickets of ${feature} are on this machine (export pc): none of it goes into git`) };
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

// New numbers for the taken keys, replaced in every file of the feature folder (files renamed).
function renumber(root, c, taken, notes) {
  const old = [...taken.keys()].sort(byNumber);
  const s = plans.settings(root);
  const next = new Map();
  const map = new Map(old.map((k) => {
    const p = prefixOfKey(k);
    if (!next.has(p)) next.set(p, highestKey(root, p, s, true, notes) + 1);
    const n = next.get(p);
    next.set(p, n + 1);
    return [k, `${p}-${n}`];
  }));
  const re = new RegExp(`(?<![A-Za-z0-9_-])(${old.join('|')})(?!\\d)`, 'gi');
  for (const f of folderFiles(c.folder)) {
    const key = String(f.fm.key || '').toUpperCase();
    const name = f.fm.type === 'ticket' && map.has(key) && f.name.toUpperCase().startsWith(key) ? `${map.get(key)}${f.name.slice(key.length)}` : f.name;
    const text = f.text.replace(re, (m) => map.get(m.toUpperCase()));
    if (text === f.text && name === f.name) continue;
    fs.writeFileSync(safe(root, path.join(c.folder, name), false), text);
    if (name !== f.name) fs.rmSync(safe(root, f.file, false), { force: true });
  }
  return old.map((k) => `renumbered: ${k} -> ${map.get(k)}`);
}

// Whether git knows a path: in the working tree, the index or HEAD.
const known = (root, p) => fs.existsSync(path.join(root, p)) || Boolean(readGit(root, ['ls-files', '--', p])) || Boolean(readGit(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', p]));

// An exported draft's own files: plan.md, reviews/ and its T-files.
function draftFiles(root, d) {
  const out = [plans.PLAN_FILE, 'reviews'].map((n) => path.join(d.folder, n)).filter((f) => fs.existsSync(f));
  let names = [];
  try { names = fs.readdirSync(path.join(d.folder, 'tickets')).filter((n) => plans.TICKET_FILE.test(n)); } catch { /* none */ }
  return [...out, ...names.map((n) => path.join(d.folder, 'tickets', n))].map((f) => rel(root, f));
}

// A key of ours another ticket file has, while ours is already on a remote.
const publishedTaken = (k, taken, published) => `${k} is also ${taken.get(k)}, and this feature's ${k} is already ${published.get(k)}: a published key is not renumbered; settle the duplicate by hand`;

function commitFeature(root, feature) {
  const what = 'commit';
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
    const { taken, published } = keyCheck(root, c.keys, c.folder);
    const stuck = [...taken.keys()].find((k) => published.has(k));
    if (stuck) return done(refuse(what, publishedTaken(stuck, taken, published)));
    if (taken.size) { try { renumbered.push(...renumber(root, c, taken, notes)); } catch (e) { return done(refuse(what, `renumbering failed: ${e.message}`)); } }
  }
  if (c.draft && plans.stateOf(c.draft) === 'exported') {
    const r = moveToTrash(root, draftFiles(root, c.draft), 'planning');
    if (r.failed.length) {
      // All or none: what did go comes back, so the next run still sees the exported draft.
      if (r.batch) restore(root, r.batch);
      return done(refuse(what, `the draft's files did not go to keel's trash: ${r.failed.map((f) => `${f.path}: ${f.reason}`).join(', ')}`));
    }
    for (const dir of [path.join(c.draft.folder, 'tickets'), c.draft.folder]) { try { fs.rmdirSync(dir); } catch { /* not empty */ } }
  }
  // The draft folder, also after an earlier run moved the draft away, and the ticket folder when it holds
  // exported tickets (other files there are not planning's to commit).
  const folders = [c.draft && c.draft.folder, ...plans.draftDirs(root).filter((d) => !d.local).map((d) => path.join(d.dir, feature)), c.list.length ? c.folder : null];
  const paths = [...new Set(folders.filter(Boolean).map((f) => rel(root, f)))].filter((p) => known(root, p));
  if (!paths.length) return done('commit: nothing to commit');
  let r = flow.git(root, ['add', '-A', '--', ...paths]);
  if (!r.ok) return done(refuse(what, `git add failed: ${gitText(r)}`));
  if (!flow.git(root, ['diff', '--cached', '--name-only', '--', ...paths]).out) return done('commit: nothing to commit');
  const keys = c.exported ? exportedTickets(c.folder).map((t) => t.fm.key.toUpperCase()).sort(byNumber) : [];
  const message = keys.length ? `${keys.join(', ')}: add the ${feature} tickets` : `Plan ${feature}`;
  // Only these paths: changes staged before stay staged and out of this commit.
  r = flow.git(root, ['commit', '-q', '-m', message, '--', ...paths]);
  if (!r.ok) return done(refuse(what, `git commit failed (a project hook?): ${gitText(r)}`));
  return done(`committed: ${flow.git(root, ['rev-parse', '--short', 'HEAD']).out} ${message}`);
}

function pushFeature(root, feature) {
  const what = 'push';
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
  return refuse(what, `the push of ${b} was refused (${kind}): ${gitText(r)}`);
}

module.exports = { exportFeature, commitFeature, pushFeature, highestKey, keyCheck };
