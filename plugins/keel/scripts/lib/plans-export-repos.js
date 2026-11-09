'use strict';
// plans.js export: a ready plan's tickets go into the feature folder with keys shared across the
// repository (lib/plans-export.js counts them). A feature on several repositories (plan.md `repos:`)
// goes into each of them by that repository's own settings: its prefix, keys, ticket place and main
// branch, with one overview, the same word for word in all.
// - Export is all or nothing: every repository checked and every key counted first, the T-numbers
//   replaced in one pass, the files written into a temporary folder next to each target, then the
//   renames: the other repositories first, this project last. A draft in the repository whose folder is
//   the target gets the new files beside its own (they never clash with plan.md, tickets/ and reviews/).
//   A run that fails before the end is rolled back: no feature folder anywhere, the plan ready. The next
//   run removes what is left of an earlier one (a temporary folder, an overview and tickets of this
//   feature in the draft's folder) and starts again with the same keys. A run killed between two steps
//   may leave a state the next run refuses (a feature folder that exists); that one is settled by hand.
// - Another repository takes tickets only when it is ready: on the feature branch with a clean tree (or
//   as it is, --as-is, on another branch than its main one), its own prefix, no task a session works on,
//   no folder or draft of the feature yet. Its tickets on its machine (tickets: pc) need none of git.
// - A draft on this machine goes to keel's trash once exported; one in the repository leaves with the
//   commit of its tickets. The researcher's reports (the draft's research/) go with the tickets: into
//   research/ beside them (<feature>/tickets/research/ on this machine, <feature>/research/ in the
//   repository); another repository gets the reports its tickets or the overview name.
// - A stub (lib/plans-stubs.js) goes into this project's feature folder as <PREFIX>-S<n>-<slug>.md; its
//   repository is not one of the plan's and takes nothing.
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { settings, settingsFile, setUp, notSetUp, exportDir } = require('./plans-settings.js');
const { git: readGit, read, frontmatter, clean } = require('./repo-read.js');
const { samePath } = require('./safe-path.js');
const { moveToTrash, restore } = require('./trash.js');
const { overviewSections, repoName, isStub, frontText, bodyOf } = require('./plans-format.js');
const { namedRepos, planRepos, isFolder, isRepoTop } = require('./plans-repos.js');
const { busyTasks } = require('./tasks.js');
const { fetched, highestKey, TEMP, safe, folderFiles, featureFolder } = require('./plans-export.js');
const flow = require('../git-flow.js');

const README = 'README.md';
const stubs = () => require('./plans-stubs.js');

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const slashes = (p) => p.replace(/\\/g, '/');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const lf = (text) => String(text).replace(/\r\n/g, '\n');

// The researcher's reports of the draft (research/*.md), as they are. Anything else there (a link, a
// folder, another file) would leave with the draft without a copy, so it stops the export.
function researchFiles(d) {
  const dir = path.join(d.folder, 'research');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
  const other = entries.find((e) => !(e.isFile() && /\.md$/i.test(e.name)));
  if (other) throw new Error(`research/${other.name} is not a report: research/ holds only .md files; move it out`);
  return entries.map((e) => ({ name: `research/${e.name}`, text: fs.readFileSync(path.join(dir, e.name)) }));
}

// What an export into the draft's own folder that did not finish left there: its tickets and overview.
const leftovers = (d) => folderFiles(d.folder).filter((f) => ((f.fm.type === 'ticket' || isStub(f.fm)) && f.fm.feature === d.feature) || (f.fm.type === 'feature' && f.name === README));

// --- another repository of the plan ---

// Whether `folder` has a local branch or a remote's branch named `branch`.
function branchExists(folder, branch) {
  const refs = (readGit(folder, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']) || '').split('\n');
  return refs.some((r) => r === `refs/heads/${branch}` || (r.startsWith('refs/remotes/') && r.split('/').slice(3).join('/') === branch));
}

// Another repository as export writes into it: { t } (its target and notes), or { problems }, each
// { why, asIs } (asIs: what --as-is takes as it is). `p` holds the plan's prefix, branch and merge_into.
function neighbour(d, prefix, p) {
  const folder = p.s.repos[prefix];
  const no = (why) => ({ problems: [{ why }], folder: folder || 'no folder' });
  if (!folder) return no(`no folder in the repos map; plans.js settings set --repo ${prefix}=<folder>`);
  if (!isFolder(folder)) return no('is not on this machine; give its folder (plans.js settings set --repo), or plan stubs for it instead');
  if (!isRepoTop(folder)) return no('is not a git repository');
  const ns = settings(folder);
  if (!setUp(ns)) return no(`no planning settings: open a conversation in ${folder} and run /keel:configure planning`);
  if (ns.ticket_prefix === p.own) return no(`plans with this project's prefix ${p.own}: two repositories in one plan need different prefixes (/keel:configure planning there)`);
  if (ns.ticket_prefix !== prefix) return no(`plans with the prefix ${ns.ticket_prefix}, not ${prefix}: plans.js settings set --repo ${ns.ticket_prefix}=<folder>`);
  const local = ns.tickets !== 'repo';
  const dir = local ? plans.base(folder) : exportDir(folder, ns);
  if (!dir) return no('its planning.tickets_dir is not a folder keel uses: /keel:configure planning there');
  const target = path.join(dir, d.feature);
  const problems = [];
  const draft = plans.listDrafts(folder).find((x) => x.feature === d.feature);
  if (fs.existsSync(target)) problems.push({ why: `${rel(folder, target)}/ exists there; move it away` });
  else if (draft) problems.push({ why: `a draft ${d.feature} is there (${rel(folder, draft.folder)}/); finish it or move it away` });
  const notes = [];
  if (!local) {
    let g = null;
    try { g = flow.context(folder); flow.requireReady(g); } catch (e) { problems.push({ why: e.message }); }
    if (g && g.branch && g.branch !== p.branch) {
      const fix = branchExists(folder, p.branch) ? `switch to it: git -C "${folder}" switch ${p.branch}` : `create the branch: git -C "${folder}" switch -c ${p.branch}`;
      // The main branch is never taken as it is: commit refuses it.
      const main = flow.sameBranch(g.branch, g.main);
      problems.push({ why: `on ${g.branch}, not on ${p.branch}; ${fix}`, asIs: main ? null : `the tickets go to ${g.branch}` });
      if (!main) notes.push(`the tickets go to the open branch ${g.branch}, not ${p.branch}`);
    }
    // A temporary folder an earlier export left is removed before the writes, so it is not a change.
    const changed = (readGit(folder, ['status', '--porcelain', '--untracked-files=all']) || '').split('\n').filter((l) => l.trim() && !l.includes(`${TEMP}/`));
    if (changed.length) problems.push({ why: 'uncommitted changes; commit or stash them', asIs: 'they stay out of the tickets\' commit' });
    for (const id of busyTasks(folder)) problems.push({ why: `task ${id} is active there; finish or hand it off there (/keel:end-task)` });
  } else notes.push('its tickets are seen on this machine only');
  // --as-is takes the repository only when every problem there has an asIs: one without it still stops.
  const takenAsIs = p.asIs.includes(prefix) && problems.every((x) => x.asIs);
  if (problems.length && !takenAsIs) return { problems, folder };
  // The plan's merge_into goes to every repository only when it was set by hand (it differs from this
  // project's main branch); else each repository merges into its own.
  const mergeInto = p.explicitMerge ? p.mergeInto : plans.mainBranch(folder);
  if (p.explicitMerge && !branchExists(folder, mergeInto)) notes.push(`no branch ${mergeInto} there; its tickets merge into it`);
  return { t: { prefix, root: folder, s: ns, local, target, temp: `${target}${TEMP}`, own: false, mergeInto, notes: notes.map((n) => `note: ${prefix}: ${n}`) } };
}

// --- export ---

// `stop(step)`: tests interrupt the export after a step ('written', 'neighbours', 'moved') by throwing.
// `asIs`: the other repositories (prefixes) taken as they are: uncommitted changes or another branch.
function exportFeature(root, feature, { stop = () => {}, asIs = [] } = {}) {
  const what = 'export';
  const { d: found, why } = plans.needDraft(root, feature, what);
  if (!found) return why;
  let d;
  try { d = plans.settle(root, found); } catch (e) { return refuse(what, e.message); }
  if (d.fm.status !== 'ready') return refuse(what, `the plan is ${d.fm.status}; only a ready plan is exported (/keel:end-planning)`);
  const { out: problems } = plans.problems(root, d);
  if (problems.length) return refuse(what, `check finds ${problems.length} problems (plans.js check ${feature})`);
  const s = settings(root);
  if (!setUp(s)) return refuse(what, notSetUp(root));
  const own = s.ticket_prefix;
  const all = plans.tickets(d);
  const real = all.filter((t) => !isStub(t.fm));
  const others = namedRepos(d.fm, real, own);
  const multi = others.length > 0;
  const { branch, merge_into: mergeInto } = plans.branchesOf(root, d);
  if (!mergeInto) return refuse(what, `the plan names no branch to merge into: plans.js set ${feature} --merge-into <branch>`);
  const toRepo = s.tickets === 'repo';
  if (!toRepo && !d.local) return refuse(what, 'the draft is in the repository, so its tickets go there too, but planning.tickets in .keel/config.json is pc: plans.js settings set --draft pc for this machine, or /keel:configure planning for the team');
  const dir = toRepo ? exportDir(root, s) : null;
  if (toRepo && !dir) return refuse(what, 'planning.tickets_dir in .keel/config.json is not a folder keel uses: /keel:configure planning');
  // On this machine the feature folder takes the draft's place: <base>/<feature>/tickets/.
  const target = toRepo ? path.join(dir, feature) : d.folder;
  const intoDraft = toRepo && !d.local && samePath(path.resolve(target), path.resolve(d.folder));
  if (toRepo && !intoDraft && fs.existsSync(target)) return refuse(what, `${rel(root, target)}/ exists and is not this draft's folder: set another tickets_dir (/keel:configure planning) or move that folder away`);
  const withReadme = multi || all.length >= 2;
  // The overview goes beside the draft's files: a README of the user's own there is never replaced.
  const ownReadme = path.join(target, README);
  if (intoDraft && withReadme && fs.existsSync(ownReadme) && frontmatter(read(ownReadme) || '').type !== 'feature') {
    return refuse(what, `${rel(root, ownReadme)} is not keel's overview: move it away, then export again`);
  }
  const local = !toRepo;
  const ownTarget = { prefix: own, root, s, local, target, temp: intoDraft ? null : `${target}${TEMP}`, own: true, mergeInto, notes: [] };
  const targets = [ownTarget];

  // Every repository first: nothing is written while one is not ready.
  // A stub's repository in capitals, as plans.js check reads it: `adm` and `ADM` are one S-number sequence.
  const repoOf = (t) => (given(t.fm.repo) ? (isStub(t.fm) ? t.fm.repo.trim().toUpperCase() : t.fm.repo.trim()) : own);
  const empty = [own, ...others].find((x) => !real.some((t) => repoOf(t) === x));
  // Also a plan of stubs only: an exported feature is found by its tickets, so with none here it is lost.
  if (empty === own) return refuse(what, `this project (${own}) has no ticket: give it one; nothing exported, the plan stays ready`);
  if (multi && empty) return refuse(what, `${empty} is in repos but has no ticket: give it one, or leave it out (plans.js set ${feature} --repos); nothing exported, the plan stays ready`);
  if (multi && mapTracked(root)) return trackedMap(root, what);
  const p = { s, own, branch, mergeInto, explicitMerge: mergeInto !== plans.mainBranch(root), asIs: asIs.map((x) => x.toUpperCase()) };
  const notReady = [];
  for (const prefix of others) {
    const r = neighbour(d, prefix, p);
    if (r.t) targets.push(r.t);
    else notReady.push(...r.problems.map((x) => `not ready: ${prefix} (${r.folder}): ${x.why}${x.asIs ? ` (or --as-is ${prefix}: ${x.asIs})` : ''}`));
  }
  if (notReady.length) {
    const names = [...new Set(notReady.map((l) => /^not ready: (\S+)/.exec(l)[1]))];
    return [refuse(what, `not ready: ${names.join(', ')}; nothing exported, the plan stays ready`)[0], ...notReady];
  }
  const show = (t, p2) => (t.own ? rel(root, p2) : slashes(p2));

  try {
    for (const t of targets) {
      if (t.temp) fs.rmSync(safe(t.root, t.temp, t.local), { recursive: true, force: true });
      else for (const f of leftovers(d)) fs.rmSync(safe(root, f.file, false), { force: true });
    }
  } catch (e) { return refuse(what, `what an earlier export left is not removed: ${e.message}`); }

  // One T -> key map for every repository: each counts its own prefix in its own git and folders.
  const keys = new Map();
  const gitNotes = [];
  for (const t of targets) {
    const git = fetched(t.root);
    const first = highestKey(t.root, t.prefix, t.s, git.repo, git.notes) + 1;
    real.filter((x) => repoOf(x) === t.prefix).forEach((x, i) => keys.set(x.id, `${t.prefix}-${first + i}`));
    gitNotes.push(...git.notes.map((n) => (t.own ? n : `note: ${t.prefix}: ${n}`)));
    t.name = repoName(t.root);
  }
  // Stubs: <PREFIX>-S<n> in this project, per prefix.
  const stubList = all.filter((x) => isStub(x.fm));
  const stubFirst = stubs().firstStubNumbers(root, s, [...new Set(stubList.map(repoOf))], readGit(root, ['rev-parse', '--git-dir']) !== null);
  for (const x of stubList) {
    const p2 = repoOf(x);
    keys.set(x.id, `${p2}-S${stubFirst.get(p2)}`);
    stubFirst.set(p2, stubFirst.get(p2) + 1);
  }
  // T-numbers replaced in one pass, only those of the draft (T1 is never part of T10).
  const swap = (text) => text.replace(/\bT(\d+)\b/g, (m) => keys.get(m) || m);
  const byPrefix = new Map(targets.map((t) => [t.prefix, t]));
  // A draft made before plans carried the code gets one here.
  const page = plans.PAGE_CODE.test(d.fm.page || '') ? d.fm.page : plans.pageCode();
  const files = all.map((x) => {
    const stub = isStub(x.fm);
    const t = stub ? ownTarget : byPrefix.get(repoOf(x));
    const key = keys.get(x.id);
    const deps = plans.ticketIds(x.fm.depends_on).map((k) => keys.get(k) || k);
    const front = stub ? { type: 'stub', key, repo: repoOf(x), feature, page, depends_on: `[${deps.join(', ')}]` }
      : { type: 'ticket', key, status: 'todo', feature, page, branch, merge_into: t.mergeInto, depends_on: `[${deps.join(', ')}]` };
    return { id: x.id, key, stub, prefix: t.prefix, repo: stub ? stubs().stubRepoName(root, repoOf(x)) : t.name, name: `${key}-${x.name.replace(/^T\d+-/, '')}`, text: frontText(front) + swap(bodyOf(x.text)) };
  });
  let readme = null;
  if (withReadme) {
    const title = /^# (.+)$/m.exec(bodyOf(d.text));
    const sections = overviewSections(d.text, files, swap, multi ? targets.map((t) => ({ prefix: t.prefix, name: t.name })) : null);
    const front = multi ? { type: 'feature', repos: `[${targets.map((t) => t.prefix).join(', ')}]` } : { type: 'feature' };
    readme = { name: README, text: `${frontText(front)}# ${swap(title ? title[1].trim() : d.feature)}\n\n${sections}` };
  }
  let research;
  try { research = researchFiles(d); } catch (e) { return refuse(what, `${e.message}; nothing exported, the plan stays ready`); }
  for (const t of targets) {
    t.files = files.filter((f) => f.prefix === t.prefix);
    // This project keeps every report (a draft that is the feature folder has them); another repository
    // gets the ones its tickets or the overview name.
    const named = [...t.files.map((f) => f.text), readme ? readme.text : ''].join('\n');
    t.research = t.own ? (t.temp ? research : []) : research.filter((r) => named.includes(r.name));
    t.reports = t.own ? research.length : t.research.length;
  }

  const made = [];
  const renamed = [];
  let batch = null;
  let ownRenamed = false;
  let marked = false;
  try {
    for (const t of targets) {
      const into = t.temp ? path.join(t.temp, t.local ? 'tickets' : '') : t.target;
      for (const f of [...t.files, ...(readme ? [readme] : []), ...t.research]) {
        const file = path.join(into, f.name);
        plans.writeFile(t.root, { local: t.local }, file, f.text);
        if (!t.temp) made.push(file);
      }
    }
    stop('written');
    for (const t of targets.filter((x) => !x.own)) {
      fs.renameSync(safe(t.root, t.temp, t.local), safe(t.root, t.target, t.local));
      renamed.push(t);
    }
    stop('neighbours');
    // This project last: on this machine its feature folder takes the draft's place, so the draft goes
    // to keel's trash right before that rename.
    if (local) {
      plans.writePlan(root, d, { status: 'exported', export: 'pc' });
      marked = true;
      const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
      if (!r.batch) throw new Error(`the draft did not go to keel's trash: ${r.failed.map((f) => f.reason).join(', ')}`);
      batch = r.batch;
      stop('moved');
      fs.renameSync(safe(root, ownTarget.temp, true), safe(root, target, true));
      ownRenamed = true;
    } else {
      if (ownTarget.temp) { fs.renameSync(safe(root, ownTarget.temp, false), safe(root, target, false)); ownRenamed = true; }
      stop('moved');
      plans.writePlan(root, d, { status: 'exported', export: 'repo' });
      marked = true;
    }
  } catch (e) {
    // Back to before the run: the draft out of keel's trash, plan.md ready, nothing new left anywhere.
    const left = [];
    // `file`: a file this run wrote; plans.writeFile checked its path then.
    const remove = (t, p2, file = false) => { try { fs.rmSync(file ? p2 : safe(t.root, p2, t.local), { recursive: true, force: true }); } catch { left.push(`left: ${show(t, p2)}; remove it by hand`); } };
    try { if (batch && !ownRenamed) restore(root, batch); } catch { left.push(`left: the draft in keel's trash, batch ${batch}; /keel:cleanup restore ${batch}`); }
    try { if (marked) plans.writeFile(root, d, path.join(d.folder, plans.PLAN_FILE), d.text); } catch { left.push(`left: ${rel(root, path.join(d.folder, plans.PLAN_FILE))} marked exported; set its status back to ready by hand`); }
    for (const t of targets) if (t.temp) remove(t, t.temp);
    for (const t of renamed) remove(t, t.target);
    if (ownRenamed && toRepo) remove(ownTarget, target);
    for (const f of made) remove(ownTarget, f, true);
    if (left.length) return [refuse(what, `${e.message}; the plan stays ready, but not everything was removed`)[0], ...left];
    return refuse(what, `${e.message}; nothing exported, the plan stays ready`);
  }

  let draft;
  if (batch) draft = `draft: moved to keel's trash: batch ${batch}`;
  else if (d.local) {
    const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
    draft = r.batch ? `draft: moved to keel's trash: batch ${r.batch}` : `draft: not moved to keel's trash (${r.failed.map((f) => f.reason).join(', ')}); remove ${rel(root, d.folder)}/ by hand`;
  } else draft = `draft: plan.md, reviews/${ownTarget.temp && research.length ? ', research/' : ''} and T-files leave with the commit (plans.js commit ${feature})`;
  const shown = (t) => show(t, t.local ? path.join(t.target, 'tickets') : t.target);
  return [
    ...targets.flatMap((t) => {
      const n = t.files.filter((f) => f.stub).length;
      return [`exported: ${shown(t)}/ (${t.files.length - n} tickets${n ? `, ${n} stub${n === 1 ? '' : 's'}` : ''})`, ...t.files.map((f) => `- ${f.id} -> ${f.key}: ${shown(t)}/${f.name}${f.stub ? ' (stub)' : ''}`)];
    }),
    `readme: ${readme ? targets.map((t) => `${shown(t)}/${README}`).join(', ') : 'none (1 ticket)'}`,
    ...targets.filter((t) => t.reports).map((t) => `research: ${shown(t)}/research/ (${t.reports} reports)`),
    draft,
    ...gitNotes,
    ...targets.flatMap((t) => t.notes),
    ...(local ? ['note: these tickets are seen on this machine only'] : []),
  ];
}

// --- an exported feature in other repositories ---

// The repos map is this machine's: a map git tracks (a clone could bring one) never names a folder to write to.
const mapTracked = (root) => Boolean(readGit(root, ['ls-files', '--', rel(root, settingsFile(root))]));
const trackedMap = (root, what) => refuse(what, `the repos map ${rel(root, settingsFile(root))} is in git; keel takes another repository's folder only from this machine's own map: git rm --cached ${rel(root, settingsFile(root))}`);

// This project's prefix: its planning setting, else the one its own tickets of the feature carry (a
// clone with no planning settings).
const ownPrefix = (root, f) => settings(root).ticket_prefix || (f && f.list.length ? String(f.list[0].fm.key).replace(/-\d+$/, '').toUpperCase() : undefined);

// The prefixes of an exported feature's overview (`repos:` of README.md in its folder); none for a
// feature on one repository.
const overviewRepos = (f) => planRepos(frontmatter(read(path.join(f.folder, README)) || ''));

// The feature's folder in another repository of its overview (`repo`, a prefix): { root, f, prefix }, or
// { why }. The folder comes from this project's repos map.
function otherFeature(root, feature, f, repo, what) {
  const prefix = String(repo).trim().toUpperCase();
  const listed = overviewRepos(f);
  if (!listed.includes(prefix)) return { why: refuse(what, `--repo: ${clean(prefix, 20)} is not a repository of ${feature}'s overview (${listed.join(', ') || 'a feature on one repository'})`) };
  if (mapTracked(root)) return { why: trackedMap(root, what) };
  const folder = settings(root).repos[prefix];
  if (!folder || !isFolder(folder)) return { why: refuse(what, `--repo: ${prefix} has no folder on this machine${folder ? ` (${clean(folder, 200)})` : ''}`) };
  const nf = featureFolder(folder, feature);
  if (!nf) return { why: refuse(what, `--repo: no tickets of ${feature} in ${clean(folder, 200)}`) };
  // Tickets on that machine only (tickets pc) take a new ticket, but never go into git.
  if (nf.local && what !== 'ticket') return { why: refuse(what, `--repo: ${prefix} keeps the tickets of ${feature} on this machine only: nothing to ${what} there`) };
  return { root: folder, f: nf, prefix };
}

// Where plans.js commit or push runs: this project, or with `repo` another repository of the feature's
// overview ({ root, prefix }); and for the key check every repository of the overview on this machine
// (`repos`: [{ prefix, root }], empty for a feature on one repository).
function repoFor(root, feature, repo, what) {
  const f = plans.validFeature(feature) ? featureFolder(root, feature) : null;
  const own = ownPrefix(root, f);
  let at = { root, prefix: own };
  if (repo !== undefined && String(repo).trim().toUpperCase() !== own) {
    if (!f) return { why: refuse(what, `--repo: no tickets of ${clean(String(feature))} in this project, so no overview names its repositories`) };
    const o = otherFeature(root, feature, f, repo, what);
    if (o.why) return o;
    at = o;
  }
  const listed = f ? overviewRepos(f) : [];
  const tracked = listed.length > 1 && mapTracked(root);
  const repos = listed.map((p) => ({ prefix: p, root: p === own ? root : !tracked && settings(root).repos[p] }))
    .filter((r) => r.root && isFolder(r.root));
  return { root: at.root, prefix: at.prefix, repos };
}

// The Tickets section of an overview with `line` added after its last line.
function withTicketLine(text, line) {
  const lines = lf(text).split('\n');
  const at = lines.findIndex((l) => /^## Tickets\s*$/.test(l));
  if (at < 0) return `${text.replace(/\n*$/, '\n')}\n## Tickets\n${line}\n`;
  let end = at + 1;
  while (end < lines.length && !/^## /.test(lines[end])) end += 1;
  while (end > at + 1 && !lines[end - 1].trim()) end -= 1;
  lines.splice(end, 0, line);
  return lines.join('\n');
}

// A later ticket's line added to the Tickets of the feature's overview in every repository of the
// overview on this machine (this project's alone for a feature on one): `overview:` lines, and a `note:`
// for each repository whose overview is not updated.
function addToOverviews(root, feature, f, line) {
  const own = ownPrefix(root, f);
  const listed = overviewRepos(f);
  const tracked = listed.length > 1 && mapTracked(root);
  const out = [];
  for (const prefix of listed.length ? listed : [own]) {
    const folder = prefix === own ? root : !tracked && settings(root).repos[prefix];
    const where = prefix === own ? f : folder && isFolder(folder) ? featureFolder(folder, feature) : null;
    const file = where && path.join(where.folder, README);
    const text = file && read(file);
    if (!text || frontmatter(text).type !== 'feature') {
      if (listed.length) out.push(`note: ${prefix}: its overview is not updated (${tracked && prefix !== own ? 'the repos map is in git' : !folder || !isFolder(folder) ? 'not on this machine' : 'no overview of the feature there'})`);
      continue;
    }
    if (lf(text).split('\n').includes(line)) continue;
    try { plans.writeFile(folder, { local: where.local }, file, withTicketLine(text, line)); } catch (e) { out.push(`note: ${prefix}: its overview is not updated (${e.message})`); continue; }
    out.push(`overview: ${prefix === own ? rel(root, file) : slashes(file)}`);
  }
  return out;
}

module.exports = { exportFeature, repoFor, otherFeature, addToOverviews, mapTracked, trackedMap, neighbour };
