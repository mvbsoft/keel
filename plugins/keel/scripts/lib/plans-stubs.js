'use strict';
// Stubs: tickets for a repository that is not on this machine (front matter `type: stub`; the sections
// that need no code of that repository, lib/plans-format.js STUB_SECTIONS). Their state is never read.
// - A draft: plans.js ticket <f> --title <t> --stub <PREFIX> makes T<n> from
//   templates/keel/planning/stub.md; tickets may name it in depends_on.
// - Export: each stub goes into this project's feature folder as <PREFIX>-S<n>-<slug>.md, n counted per
//   prefix past the highest S-number in this project's ticket folders and git, and gets its line in the
//   overview's Tickets. Its repository is not added to the overview's repos.
// - plans.js ticket <f> --from-stub <T | PREFIX-S<n>> once that repository is here (the repos map): in a
//   draft the stub becomes a full ticket in place (its repository added to the plan's repos); in an
//   exported feature the full ticket goes into that repository's feature folder with the next key there
//   and `replaces: <PREFIX>-S<n>`, the overview line changes to it and the stub goes to keel's trash. A
//   dependency on the stub key then reads the state of the ticket that replaces it
//   (lib/plans-state-rules.js stateIn), so no other ticket is edited. Both add Boundaries, Correct the
//   priors and Where to look as the template's placeholders: check stops until they are written.
const fs = require('node:fs');
const path = require('node:path');
const plans = require('./plans.js');
const { settings, PREFIX } = require('./plans-settings.js');
const { git, read, frontmatter, clean } = require('./repo-read.js');
const { setFront } = require('./tasks.js');
const { moveToTrash, restore } = require('./trash.js');
const { frontText, bodyOf, TICKET_SECTIONS, CODE_SECTIONS, STUB_KEY, isStub, heading, outsideFences, ticketLine, repoName } = require('./plans-format.js');
const { planRepos, isFolder } = require('./plans-repos.js');

const README = 'README.md';

const refuse = (why) => [`plans: ticket refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const upper = (k) => String(k).toUpperCase();
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const prefixOfStub = (key) => upper(key.slice(0, key.lastIndexOf('-S')));

// The exported stubs in a feature folder, as lib/plans-export.js folderFiles gives them.
const stubFiles = (folder) => require('./plans-export.js').folderFiles(folder).filter((t) => isStub(t.fm) && STUB_KEY.test(t.fm.key || ''));

// --- a draft ---

// The repository of a new stub (`--stub <PREFIX>`): { prefix }, or { why }. Never this project's, and
// never one on this machine: that one gets a ticket.
function stubRepo(root, value, feature) {
  if (typeof value !== 'string' || !value.trim()) return { why: '--stub needs the prefix of the repository that is not here: --stub WEB' };
  const prefix = value.trim().toUpperCase();
  const s = settings(root);
  if (!PREFIX.test(prefix)) return { why: `--stub: "${clean(prefix, 20)}" is not a ticket prefix (2-10 capital letters and digits, starting with a letter)` };
  if (prefix === s.ticket_prefix) return { why: `--stub: ${prefix} is this project: plan a ticket` };
  const folder = s.repos[prefix];
  if (folder && isFolder(folder)) return { why: `--stub: ${prefix} is on this machine (${clean(folder, 200)}): plan a ticket for it (plans.js set ${feature} --repos, then --repo ${prefix})` };
  return { prefix };
}

// The body with the sections a stub lacks (CODE_SECTIONS) put in their places, as the ticket template
// has them: placeholders plans.js check stops on until they are written.
function withCodeSections(body) {
  const blocks = (text) => {
    const lines = lf(text).split('\n');
    const plain = outsideFences(lines.join('\n')).split('\n');
    const out = [{ name: null, lines: [] }];
    lines.forEach((line, i) => {
      const m = /^##\s+(.*\S)\s*$/.exec(plain[i]);
      if (m) out.push({ name: m[1], lines: [line] }); else out[out.length - 1].lines.push(line);
    });
    return out;
  };
  const template = blocks(plans.fromTemplate('ticket.md', {}).body);
  const out = blocks(body.replace(/\n*$/, '\n'));
  for (const n of CODE_SECTIONS) {
    if (out.some((b) => b.name === n)) continue;
    const add = template.find((b) => b.name === n);
    const at = out.findIndex((b) => TICKET_SECTIONS.indexOf(b.name) > TICKET_SECTIONS.indexOf(n));
    const block = { name: n, lines: [...add.lines.join('\n').trimEnd().split('\n'), ''] };
    if (at < 0) { out[out.length - 1].lines.push(''); out.push(block); } else out.splice(at, 0, block);
  }
  return `${out.map((b) => b.lines.join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// A draft's stub becomes a full ticket in place: its repository joins the plan's repos (plans.js set,
// refused when that repository cannot), `type: stub` leaves its front matter, the code sections come in.
function fromStubDraft(root, feature, d, id) {
  const ask = upper(id);
  const t = plans.tickets(d).find((x) => x.id === ask);
  if (!t) return refuse(`--from-stub: no ticket ${clean(ask, 40)} in ${feature}`);
  if (!isStub(t.fm)) return refuse(`--from-stub: ${t.id} is no stub`);
  const prefix = given(t.fm.repo) ? t.fm.repo.trim().toUpperCase() : '';
  const s = settings(root);
  const folder = s.repos[prefix];
  if (!folder || !isFolder(folder)) return refuse(`--from-stub: ${clean(prefix, 20) || 'its repository'} is not on this machine yet: plans.js settings set --repo ${prefix || '<PREFIX>'}=<folder>`);
  const list = planRepos(d.fm);
  const set = list.includes(prefix) ? [] : plans.draftSet(root, feature, { repos: [...list, prefix].join(',') });
  if (set.length && set[0].startsWith('plans: ')) return refuse(`--from-stub: ${set[0].replace(/^plans: set refused \((.*)\)$/, '$1')}`);
  if (set.length) d = plans.settle(root, plans.needDraft(root, feature, 'ticket').d);
  const front = lf(t.text).match(/^---\n[\s\S]*?\n---\n?/)[0].replace(/^type:.*\n/m, '');
  try {
    plans.writeFile(root, d, t.file, `${front}\n${withCodeSections(bodyOf(t.text))}`);
    if (d.fm.status === 'ready') plans.writePlan(root, d, { status: 'draft', ready_hash: '-' });
  } catch (e) { return refuse(e.message); }
  return [
    `converted: ${t.id} (stub -> ticket for ${prefix})`,
    `file: ${rel(root, t.file)}`,
    ...set.filter((l) => /^(repos|after_commit_repos|status|note):/.test(l)),
    `next: write ${CODE_SECTIONS.join(', ')} from ${clean(folder, 200)}, then plans.js check ${feature} and a review of ${t.id}`,
  ];
}

// --- export ---

// The first free S-number of each prefix of `prefixes`: past the highest <PREFIX>-S<n> in the file names
// of this project's ticket folders and, in a git repository, of every branch.
function firstStubNumbers(root, s, prefixes, inRepo) {
  const { fileNames, keyFolders } = require('./plans-export.js');
  const texts = [fileNames(keyFolders(root, s)).join('\n')];
  const out = new Map();
  for (const prefix of prefixes) {
    const all = [...texts, inRepo ? git(root, ['log', '--all', '--name-only', '--format=', '--', `:(icase)*${prefix}-S*.md`]) || '' : ''];
    const re = new RegExp(`(?<![A-Za-z0-9])${prefix}-S(\\d+)(?![\\d])`, 'gi');
    let top = 0;
    for (const text of all) for (const m of text.matchAll(re)) top = Math.max(top, Number(m[1]));
    out.set(prefix, top + 1);
  }
  return out;
}

// The overview's name of a stub's repository: its folder's name in the repos map, else its prefix.
function stubRepoName(root, prefix) {
  const folder = settings(root).repos[prefix];
  return clean(folder ? path.basename(path.resolve(folder)) : prefix, 60);
}

// --- an exported feature ---

// The repository of an exported stub when it is on this machine now (its folder in the repos map), else
// null.
function hereNow(root, st) {
  const prefix = given(st.fm.repo) ? st.fm.repo.trim().toUpperCase() : prefixOfStub(st.fm.key);
  const folder = settings(root).repos[prefix];
  return folder && isFolder(folder) ? prefix : null;
}

// plans.js tickets <feature>: one line per stub of the feature folder in this working tree.
function stubLines(root, feature) {
  const f = plans.validFeature(feature) ? require('./plans-export.js').featureFolder(root, feature) : null;
  return (f ? stubFiles(f.folder) : []).sort((a, b) => require('./plans-state-read.js').byKey(a.fm.key, b.fm.key)).map((st) => {
    const prefix = hereNow(root, st);
    const why = prefix ? `${prefix} is on this machine now: plans.js ticket ${feature} --from-stub ${upper(st.fm.key)}` : 'its repository is not on this machine';
    return `  ${clean(st.fm.key, 40)} ${clean(heading(st.text)[1], 80)} — stub (${why})`;
  });
}

// plans.js check's note for a stub (`id`: a draft's T-number or an exported key) whose repository is here now.
const offerNote = (feature, id, prefix) => `note: ${id}: ${prefix} is on this machine now: turn the stub into a ticket (plans.js ticket ${feature} --from-stub ${id})`;

// plans.js check on an exported feature: a note per stub whose repository is here now.
const stubNotes = (root, f, feature) => stubFiles(f.folder).filter((st) => hereNow(root, st)).map((st) => offerNote(feature, upper(st.fm.key), hereNow(root, st)));

// Stub keys among dependencies (as written) of tickets of `feature`: `stubs` (upper case), and of those
// with no stub file in `folder`: `missing` (key -> where it is missing: no ticket of the feature in its
// repository replaces it) and `notes` (key -> why not checked).
function stubDeps(root, deps, folder, feature) {
  const stubs = [...new Set(deps.map(upper))].filter((k) => STUB_KEY.test(k));
  const here = new Set(stubFiles(folder).map((t) => upper(t.fm.key)));
  const rest = stubs.filter((k) => !here.has(k));
  const nb = require('./plans-neighbours.js');
  const states = rest.length ? nb.stubStates(root, rest) : new Map();
  const missing = new Map();
  const notes = new Map();
  for (const [k, raw] of states) {
    const s = nb.stubState(raw, feature, false);
    if (s.state === 'not found') missing.set(k, `(no stub here, and no ticket in ${raw.folder} replaces it)`);
    else if (s.state === nb.NOT_CHECKED) notes.set(k, s.why);
  }
  return { stubs, missing, notes };
}

// The overview with the stub's line changed to the ticket's and its repository in `repos:`.
function overviewWith(text, own, prefix, stubKey, line) {
  const list = planRepos(frontmatter(text));
  const repos = list.length ? (list.includes(prefix) ? list : [...list, prefix]) : [own, prefix];
  const re = new RegExp(`^- ${stubKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} .*$`, 'mi');
  const swapped = re.test(text) ? lf(text).replace(re, () => line) : lf(text);
  return setFront(swapped, { repos: `[${repos.join(', ')}]` });
}

// Where the full ticket of a stub goes in its repository: the feature's folder there when it has one (a
// ticket of the plan, or a stub converted before), as plans.js ticket --repo; else a new one, with the
// readiness an export asks of another repository (lib/plans-export-repos.js neighbour). { t } or { out }.
function stubTarget(root, feature, prefix, p) {
  const { featureFolder } = require('./plans-export.js');
  const folder = p.s.repos[prefix];
  const nf = folder && isFolder(folder) ? featureFolder(folder, feature) : null;
  if (nf) {
    const ns = settings(folder);
    if (ns.ticket_prefix !== prefix) return { out: refuse(`--from-stub: ${clean(folder, 200)} plans with the prefix ${clean(ns.ticket_prefix || 'none', 20)}, not ${prefix}`) };
    const there = nf.list[0].fm;
    return { t: { root: folder, s: ns, local: nf.local, into: nf.folder, made: null, keys: nf.list.map((x) => upper(x.fm.key)), branch: given(there.branch) ? there.branch : p.branch, mergeInto: given(there.merge_into) ? there.merge_into : p.mergeInto, notes: [] } };
  }
  const r = require('./plans-export-repos.js').neighbour({ feature }, prefix, { ...p, asIs: [] });
  if (!r.t) return { out: [refuse(`--from-stub: ${prefix} is not ready`)[0], ...r.problems.map((x) => `not ready: ${prefix} (${r.folder}): ${x.why}`)] };
  return { t: { ...r.t, into: r.t.local ? path.join(r.t.target, 'tickets') : r.t.target, made: r.t.target, keys: [], branch: p.branch } };
}

// The full ticket of an exported stub, in its repository (stubTarget). The stub goes to keel's trash
// first: of two runs at once only one gets it, and the other writes nothing.
function fromStubExported(root, feature, f, key) {
  const ask = upper(key);
  const st = stubFiles(f.folder).find((t) => upper(t.fm.key) === ask);
  if (!st) return refuse(`--from-stub: no stub ${clean(ask, 40)} in ${rel(root, f.folder)}/`);
  const across = require('./plans-export-repos.js');
  const { fetched, highestKey, safe } = require('./plans-export.js');
  if (across.mapTracked(root)) return across.trackedMap(root, 'ticket');
  const readmeFile = path.join(f.folder, README);
  const overview = read(readmeFile);
  if (overview === null || frontmatter(overview).type !== 'feature') return refuse(`--from-stub: no overview ${rel(root, readmeFile)} beside the stub`);
  const prefix = given(st.fm.repo) ? st.fm.repo.trim().toUpperCase() : prefixOfStub(ask);
  const s = settings(root);
  const sibling = f.list[0];
  const own = s.ticket_prefix || upper(sibling.fm.key.slice(0, sibling.fm.key.lastIndexOf('-')));
  const branch = given(sibling.fm.branch) ? sibling.fm.branch : feature;
  const mergeInto = given(sibling.fm.merge_into) ? sibling.fm.merge_into : plans.mainBranch(root);
  const at = stubTarget(root, feature, prefix, { s, own, branch, mergeInto, explicitMerge: mergeInto !== plans.mainBranch(root) });
  if (at.out) return at.out;
  const t = at.t;
  const fetch = fetched(t.root);
  // The folder's own keys too: a ticket there may not be in git yet.
  const number = (k) => Number(k.slice(k.lastIndexOf('-') + 1));
  const newKey = `${prefix}-${Math.max(highestKey(t.root, prefix, t.s, fetch.repo, fetch.notes), ...t.keys.filter((k) => k.startsWith(`${prefix}-`)).map(number)) + 1}`;
  const title = heading(st.text)[1];
  const slug = st.name.slice(ask.length + 1).replace(/\.md$/i, '') || 'ticket';
  const front = {
    type: 'ticket', key: newKey, status: 'todo', feature, ...(plans.PAGE_CODE.test(sibling.fm.page || '') ? { page: sibling.fm.page } : {}),
    branch: t.branch, merge_into: t.mergeInto, depends_on: given(st.fm.depends_on) ? st.fm.depends_on : '[]', replaces: ask,
  };
  const ticket = frontText(front) + withCodeSections(bodyOf(st.text)).replace(/^# \[[^\]\n]*\]/m, () => `# [${newKey}]`);
  const line = ticketLine(newKey, title, repoName(t.root));
  const next = overviewWith(overview, own, prefix, ask, line);
  const theirsFile = path.join(t.into, README);
  const theirs = read(theirsFile);
  const theirNext = theirs !== null && frontmatter(theirs).type === 'feature' ? overviewWith(theirs, own, prefix, ask, line) : next;
  const research = plans.researchTexts(f.folder).filter((x) => `${ticket}\n${next}`.includes(x.name));
  const file = path.join(t.into, `${newKey}-${slug}.md`);
  const shown = (p) => p.split(path.sep).join('/');
  if (fs.existsSync(file)) return refuse(`--from-stub: ${shown(file)} exists`);
  const moved = moveToTrash(root, [rel(root, st.file)], 'planning');
  if (!moved.batch) return refuse(`--from-stub: the stub did not go to keel's trash: ${moved.failed.map((x) => x.reason).join(', ')}; nothing converted`);
  const batch = moved.batch;
  // What this run wrote in that repository: the files it made (null) and the ones it changed (their old text).
  const wrote = [];
  let madeHere = false;
  try {
    // A new feature folder there is made first and alone: of two runs that both found none, the second
    // gets EEXIST here and writes nothing.
    if (t.made) {
      const made = safe(t.root, t.made, t.local);
      fs.mkdirSync(path.dirname(made), { recursive: true });
      fs.mkdirSync(made);
      madeHere = true;
    }
    for (const [name, text] of [[path.basename(file), ticket], [README, theirNext], ...research.map((x) => [x.name, x.text])]) {
      const target = path.join(t.into, name);
      if (!t.made) wrote.push({ target, old: read(target) });
      plans.writeFile(t.root, { local: t.local }, target, text);
    }
    plans.writeFile(root, { local: f.local }, readmeFile, next);
  } catch (e) {
    // Back to before: what this run wrote there (a feature folder it made goes whole), the stub back.
    const left = [];
    try {
      if (madeHere) fs.rmSync(safe(t.root, t.made, t.local), { recursive: true, force: true });
      for (const w of wrote.reverse()) {
        // A file under something that is not a folder was never made: Linux and macOS throw ENOTDIR on
        // rmSync for it even with force, which would stop the rest of this undo.
        if (w.old === null) { const p = safe(t.root, w.target, t.local); if (fs.existsSync(p)) fs.rmSync(p, { force: true }); }
        else plans.writeFile(t.root, { local: t.local }, w.target, w.old);
      }
    } catch { left.push(`left: what this run wrote in ${shown(t.into)}; put it back by hand`); }
    // restore reports by its result, not by a throw.
    try { if (!(restore(root, batch).restored || []).length) throw new Error('not restored'); } catch { left.push(`left: the stub in keel's trash, batch ${batch}; /keel:cleanup restore ${batch}`); }
    return [refuse(`${e.message}; nothing converted`)[0], ...left];
  }
  const others = planRepos(frontmatter(next)).filter((p) => p !== own && p !== prefix);
  return [
    `converted: ${ask} -> ${newKey}`,
    `created: ${shown(file)}`,
    `overview: ${rel(root, readmeFile)}, ${shown(theirsFile)}`,
    `stub: moved to keel's trash: batch ${batch}`,
    ...(others.length ? [`note: the overview in ${others.join(', ')} still lists ${ask}: plans.js align ${feature} --take ${own}`] : []),
    ...t.notes,
    ...fetch.notes.map((n) => `note: ${prefix}: ${n}`),
    `next: write ${CODE_SECTIONS.join(', ')} from ${shown(t.root)}, then plans.js check ${feature} there, and commit in both: plans.js commit ${feature}, plans.js commit ${feature} --repo ${prefix}`,
  ];
}

// plans.js ticket <feature> --from-stub <id>: a draft's T-number, or an exported stub's key.
function fromStub(root, feature, draft, exported, id) {
  if (typeof id !== 'string' || !id.trim()) return refuse('--from-stub needs the stub: --from-stub T5, or --from-stub WEB-S1 in an exported feature');
  if (exported) return fromStubExported(root, feature, exported, id.trim());
  return fromStubDraft(root, feature, draft, id.trim());
}

module.exports = { offerNote, stubFiles, stubRepo, fromStub, firstStubNumbers, stubRepoName, stubDeps, stubLines, stubNotes, withCodeSections };
