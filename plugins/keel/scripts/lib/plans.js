'use strict';
// keel's planning drafts (/keel:start-planning). One feature = one draft folder until its tickets are
// exported:
// - Where: .keel/local/plans/keel/<feature>/ (this machine only), or <draft_dir>/<feature>/ in the
//   repository when settings say `draft: repo`. Both places are always read, so changing the setting
//   does not hide a draft.
// - plan.md (front matter `type: plan`, `status`, `branch`, `merge_into`, `last_ticket`...),
//   tickets/T<n>-<slug>.md (front matter `id`, `repo`, `depends_on`, `review_hash`), reviews/ (written by the
//   conversation). `branch` (the feature branch) and `merge_into` (where the feature merges) go into
//   every exported ticket (lib/plans-export.js), and so does `page`, the feature's random code that
//   names its page (feature-page.js) the same from every machine and repository.
// - States: draft -> ready -> exported, draft or ready -> abandoned, ready -> draft. A plan changed
//   after `ready` (its ready_hash no longer matches) is a draft again.
// - Settings: lib/plans-settings.js. The planning chat marks (in the main checkout, lib/chat-marks.js):
//   .keel/local/plans/keel/sessions/<session id>.json = { "feature": "<name>" }.
// - An exported feature is edited in its feature folder: mark set, ticket and check take it when no
//   draft of that name is here or the draft is exported (lib/plans-export.js).
// - A feature on several repositories: plan.md `repos`, a ticket's `repo`, plan.md
//   `after_commit_repos` (lib/plans-repos.js); check, stale and review read another repository's
//   tickets in its folder.
// - Reading and writing a draft: lib/plans-drafts.js; check and stale: lib/plans-check.js.
// Nothing here prints a draft's text beyond its name, state, counts and the problems check finds.
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('./config.js');
const { moveToTrash } = require('./trash.js');
const { git, clean } = require('./repo-read.js');
const { unsafeRel, localLink, safeLocalPath, safeLocalWrite } = require('./safe-path.js');
const { validSid } = require('./ids.js');
const { setFront, dateOf } = require('./tasks.js');
const { base, badFolder, settings } = require('./plans-settings.js');
const { MARKS, markHome, marksDir } = require('./chat-marks.js');
const {
  PLAN_FILE, STATES, TICKET_FILE, FEATURE_RULE, validFeature, draftDirs, listDrafts, needDraft,
  reopens, exportedHere, tickets, ticketIds, openQuestions, ticketHash, pageCode, PAGE_CODE, draftHash,
  stateOf, writePlan, settle, writeFile, where, draftList, draftFind,
} = require('./plans-drafts.js');
const {
  draftCheck, draftStale, problems, ticketProblems, cycles,
  mentionedFiles, machineFolders, localPaths, localProblems, researchTexts,
} = require('./plans-check.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates', 'keel', 'planning');
const MOVES = { draft: ['ready', 'abandoned'], ready: ['draft', 'exported', 'abandoned'], exported: [], abandoned: [] };
const SLUG_MAX = 60;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';

// The project's main branch (config git.main_branch), or null without a valid config.
function mainBranch(root) {
  const { state, config } = checkConfig(root);
  return state === 'ok' ? config.git.main_branch : null;
}

// --- making drafts and tickets ---

// A template without its comments, its front matter replaced by `front`.
function fromTemplate(name, front) {
  let body = lf(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'));
  // Until none is left: removing one comment must not join the halves of another.
  for (let before; before !== body;) { before = body; body = body.replace(/<!--[\s\S]*?-->\s*/g, ''); }
  body = body.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
  return { body, text: (b) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${b}` };
}

// Whether a local branch <feature> or the remote's <remote>/<feature> exists while HEAD is on another one.
function featureBranchElsewhere(root, feature) {
  if (git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) === feature) return false;
  const remote = require('../git-flow.js').pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean));
  const refs = [`refs/heads/${feature}`, ...(remote ? [`refs/remotes/${remote}/${feature}`] : [])];
  return refs.some((ref) => git(root, ['rev-parse', '-q', '--verify', ref]) !== null);
}

function draftNew(root, feature, now = new Date()) {
  if (!validFeature(feature)) return refuse('new', `invalid feature name "${clean(String(feature))}": ${FEATURE_RULE}`);
  const s = settings(root);
  const local = s.draft !== 'repo';
  if (!local && badFolder(root, s.draft_dir)) return refuse('new', `draft_dir "${clean(s.draft_dir)}": ${badFolder(root, s.draft_dir)}`);
  if (local && localLink(root)) return refuse('new', `${localLink(root)}: keel does not write through it`);
  // Taken: a draft in either place, or any folder of that name where the new one would go or where
  // the repository keeps features.
  const draft = listDrafts(root).find((d) => d.feature === feature);
  if (draft) return refuse('new', `a draft "${feature}" exists (${stateOf(draft)}, ${where(root, draft)}): continue it or pick another name`);
  const folder = path.join(local ? base(root) : path.join(root, s.draft_dir), feature);
  const repoDirs = [s.draft_dir, s.tickets_dir].filter((x) => x && !badFolder(root, x));
  const taken = [folder, ...repoDirs.map((x) => path.join(root, x, feature))].find((f) => fs.existsSync(f));
  if (taken) return refuse('new', `${rel(root, taken)}/ exists: pick another name`);
  // A draft committed on its feature branch is not seen from another branch: that branch takes the name.
  if (!local && featureBranchElsewhere(root, feature)) return refuse('new', `branch ${feature} exists and may hold this draft: switch to it, or pick another name`);
  const head = git(root, ['rev-parse', '--short', 'HEAD']);
  const front = { type: 'plan', status: 'draft', feature, page: pageCode(), language: s.language, export: '-', branch: feature, merge_into: mainBranch(root) || '-', repos: '-', created: dateOf(now), after_commit: head || '-', after_commit_repos: '-', last_ticket: 0, ready_hash: '-' };
  const t = fromTemplate(PLAN_FILE, front);
  const d = { feature, folder, local, text: '', fm: {} };
  try { writeFile(root, d, path.join(folder, PLAN_FILE), t.text(t.body.replace(/^# .*$/m, () => `# ${feature}`))); } catch (e) { return refuse('new', e.message); }
  return [`created: ${rel(root, path.join(folder, PLAN_FILE))}`, `draft: ${where(root, d)}`, 'status: draft', `language: ${s.language}`];
}

const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');

// A draft's ticket is T<n>; an exported feature's one takes the next key (lib/plans-export.js).
function ticketNew(root, feature, o) {
  const { d: found, why } = needDraft(root, feature, 'ticket');
  const ex = exportedHere(root, feature, found);
  if (!found && !ex) return why;
  const d = ex ? null : settle(root, found);
  if (d && !['draft', 'ready'].includes(d.fm.status)) return refuse('ticket', `the plan is ${d.fm.status}`);
  if (typeof o.title !== 'string' || !oneLine(o.title)) return refuse('ticket', 'needs --title');
  const slug = slugOf(typeof o.slug === 'string' ? o.slug : o.title);
  if (!slug) return refuse('ticket', 'the title has no English words for the file name: add --slug <english-words>');
  const deps = typeof o.depends === 'string' ? ticketIds(o.depends) : [];
  if (o.repo !== undefined && (typeof o.repo !== 'string' || !o.repo.trim())) return refuse('ticket', '--repo needs a ticket prefix: --repo WEB');
  if (ex) return require('./plans-export.js').exportedTicket(root, feature, ex, { title: oneLine(o.title), slug, deps, repo: o.repo });
  let repo = null;
  if (o.repo !== undefined) {
    const asked = o.repo.trim().toUpperCase();
    const own = settings(root).ticket_prefix;
    if (asked !== own && !repos().planRepos(d.fm).includes(asked)) return refuse('ticket', `--repo: ${clean(asked, 20)} is not in the plan's repos (plans.js set ${feature} --repos ...)`);
    if (asked !== own) repo = asked;
  }
  const all = tickets(d);
  const other = otherRepos(root, deps.filter((x) => !all.some((t) => t.id === x)));
  // Another repository's key is unknown only when that repository lacks it; not checked is never unknown.
  const unknown = deps.filter((x) => !all.some((t) => t.id === x) && (!other.foreign(x) || other.missing.has(x.toUpperCase())));
  if (unknown.length) return refuse('ticket', `--depends: no ticket ${unknown.map((x) => `${clean(x, 40)}${other.missing.has(x.toUpperCase()) ? ` ${other.missing.get(x.toUpperCase())}` : ''}`).join(', ')}`);
  // Numbers are never reused: past the highest ever given and the highest file there.
  const n = Math.max(Number(d.fm.last_ticket) || 0, ...all.map((t) => t.n)) + 1;
  const id = `T${n}`;
  const file = path.join(d.folder, 'tickets', `${id}-${slug}.md`);
  const t = fromTemplate('ticket.md', { id, ...(repo ? { repo } : {}), depends_on: `[${deps.join(', ')}]`, review_hash: '-' });
  try {
    writeFile(root, d, file, t.text(t.body.replace(/^# .*$/m, () => `# [${id}] ${oneLine(o.title)}`)));
    writePlan(root, d, { last_ticket: n, ...(d.fm.status === 'ready' ? { status: 'draft', ready_hash: '-' } : {}) });
  } catch (e) { return refuse('ticket', e.message); }
  return [`created: ${rel(root, file)}`, `ticket: ${id}`, ...[...other.notes].map(([k, why]) => neighbours().noteLine(id, k, why))];
}

const neighbours = () => require('./plans-neighbours.js');
const repos = () => require('./plans-repos.js');
// Another repository's keys among a draft's dependencies (lib/plans-neighbours.js).
const otherRepos = (root, deps) => neighbours().lookUp(root, deps);

// --- the feature branch ---

// A branch name git takes as it is (check-ref-format would turn @{-1} into another name) and never
// reads as an option.
const validBranch = (root, name) => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && git(root, ['check-ref-format', '--branch', name]) === name;

// The feature branch and where it merges, as the exported tickets get them: plan.md's values, else the
// feature name and the main branch.
function branchesOf(root, d) {
  return { branch: given(d.fm.branch) ? d.fm.branch : d.feature, merge_into: given(d.fm.merge_into) ? d.fm.merge_into : mainBranch(root) };
}

// plans.js set: the plan's branch and merge_into; its repositories (--repos, lib/plans-repos.js); and
// --after-commit: after_commit and the other repositories' after_commit_repos from their HEAD now. A
// plan is changed only while it is a draft; a ready one becomes a draft again.
function draftSet(root, feature, o) {
  const { d: found, why } = needDraft(root, feature, 'set');
  if (!found) return why;
  const updates = {};
  for (const [opt, key] of [['branch', 'branch'], ['merge-into', 'merge_into']]) {
    if (o[opt] === undefined) continue;
    if (!validBranch(root, o[opt])) return refuse('set', `--${opt}: "${clean(String(o[opt]))}" is not a valid branch name`);
    updates[key] = o[opt];
  }
  const s = settings(root);
  let list = repos().planRepos(found.fm);
  if (o.repos !== undefined) {
    const r = repos().reposValue(root, o.repos, s);
    if (r.why) return refuse('set', `--repos: ${r.why}`);
    updates.repos = r.value;
    list = r.list;
  }
  const commit = o['after-commit'] !== undefined;
  if (commit && o['after-commit'] !== true) return refuse('set', '--after-commit takes no value');
  if (commit) {
    const head = repos().headOf(root);
    if (!head) return refuse('set', '--after-commit: no commit here (not a git repository, or no commit yet)');
    updates.after_commit = head;
  }
  if (o.repos !== undefined || commit) updates.after_commit_repos = repos().commitsText(repos().recordCommits(found.fm, list, s, commit ? 'all' : null));
  if (!Object.keys(updates).length) return refuse('set', 'nothing to set: --branch, --merge-into, --repos, --after-commit');
  let d;
  try { d = settle(root, found); } catch (e) { return refuse('set', e.message); }
  if (!['draft', 'ready'].includes(d.fm.status)) return refuse('set', `the plan is ${d.fm.status}`);
  const changed = Object.entries(updates).filter(([k, v]) => d.fm[k] !== v);
  const back = changed.length && d.fm.status === 'ready';
  if (changed.length) {
    try { d = writePlan(root, d, { ...Object.fromEntries(changed), ...(back ? { status: 'draft', ready_hash: '-' } : {}) }); } catch (e) { return refuse('set', e.message); }
  }
  const b = branchesOf(root, d);
  return [
    `branch: ${b.branch}`, `merge_into: ${b.merge_into || '-'}`,
    ...(o.repos !== undefined ? [`repos: ${d.fm.repos}`] : []),
    ...(commit ? [`after_commit: ${d.fm.after_commit}`] : []),
    ...('after_commit_repos' in updates ? [`after_commit_repos: ${d.fm.after_commit_repos}`] : []),
    ...(back ? ['status: draft (the plan changed after ready)'] : []),
    ...(o.repos !== undefined || commit ? repos().noCommitNotes(list, s) : []),
  ];
}

// --- reviews ---

const reviewState = (t) => (!given(t.fm.review_hash) ? 'never reviewed' : t.fm.review_hash === ticketHash(t.text) ? 'unchanged' : 'changed since review');

function draftReview(root, feature) {
  const { d, why } = needDraft(root, feature, 'review');
  if (!d) return why;
  const s = settings(root);
  const list = tickets(d).map((t) => ({ t, state: reviewState(t), target: repos().targetOf(root, t, s) }));
  const due = list.filter((x) => x.state !== 'unchanged').length;
  // Another repository's ticket is reviewed in its folder; the plan reviewer gets every folder.
  const where = (target) => (target.folder ? clean(target.folder, 200) : target.bad ? 'not a ticket prefix' : 'not on this machine');
  const place = (target) => (target.own ? '' : ` (${clean(target.prefix, 20)}: ${where(target)})`);
  const planned = repos().planRepos(d.fm);
  const folders = planned.map((p) => { const r = repos().targetOf(root, { fm: { repo: p } }, s); return `${clean(p, 20)}=${r.own ? 'this project' : where(r)}`; });
  return [
    `review: ${due} of ${list.length} tickets to review`,
    ...(planned.length ? [`repos: ${folders.join(', ')}`] : []),
    ...list.map((x) => `- ${x.t.id}: ${x.state}${place(x.target)}`),
  ];
}

function draftReviewed(root, feature, ids) {
  const { d: found, why } = needDraft(root, feature, 'reviewed');
  if (!found) return why;
  if (!ids.length) return refuse('reviewed', 'needs the reviewed tickets: T1 T2 ...');
  const list = tickets(found);
  const unknown = ids.filter((x) => !list.some((t) => t.id === x));
  if (unknown.length) return refuse('reviewed', `no ticket ${unknown.map((x) => clean(x)).join(', ')}`);
  const out = [];
  try {
    const d = settle(root, found);
    for (const t of list.filter((x) => ids.includes(x.id))) {
      const text = setFront(t.text, { review_hash: ticketHash(t.text) });
      if (text === null) return refuse('reviewed', `${t.name} has no front matter`);
      writeFile(root, d, t.file, text);
      out.push(`- ${t.id}: reviewed`);
    }
  } catch (e) { return refuse('reviewed', e.message); }
  return [`reviewed: ${out.length}`, ...out];
}

// --- states ---

function draftState(root, feature, to) {
  const { d: found, why } = needDraft(root, feature, 'state');
  if (!found) return why;
  if (!STATES.includes(to)) return refuse('state', `unknown state "${clean(String(to))}": ${STATES.join(', ')}`);
  let d;
  try { d = settle(root, found); } catch (e) { return refuse('state', e.message); }
  const from = d.fm.status;
  if (from === to) return [`status: ${to} (already)`];
  if (!MOVES[from].includes(to)) return refuse('state', `${from} -> ${to} is not a move (${STATES.map((s) => `${s} -> ${MOVES[s].join(' | ') || 'none'}`).join('; ')})`);
  if (to === 'ready') {
    const blocks = [];
    const { out, count } = problems(root, d);
    if (out.length) blocks.push(`check finds ${out.length} problems`);
    if (!count) blocks.push('no tickets');
    const q = openQuestions(d.text);
    if (q) blocks.push(`${q} open questions`);
    const unreviewed = tickets(d).filter((t) => reviewState(t) !== 'unchanged').map((t) => t.id);
    if (unreviewed.length) blocks.push(`not reviewed as they are: ${unreviewed.join(', ')}`);
    if (blocks.length) return refuse('state', `not ready: ${blocks.join('; ')}`);
  }
  try {
    if (to === 'ready') writePlan(root, d, { status: 'ready', ready_hash: draftHash(d) });
    else writePlan(root, d, { status: to, ready_hash: '-' });
  } catch (e) { return refuse('state', e.message); }
  const out = [`status: ${to}`];
  if (to === 'abandoned') {
    try { clearMarks(root, (m) => m.feature === d.feature); } catch (e) { out.push(`chat marks not cleared: ${e.message}`); }
    if (d.local) {
      const r = moveToTrash(root, [rel(root, d.folder)], 'planning');
      out.push(r.batch ? `moved to keel's trash: batch ${r.batch} (/keel:cleanup restores it)` : `not moved to keel's trash: ${r.failed.map((f) => f.reason).join(', ')}`);
    } else out.push(`${where(root, d)} stays: the user removes it, or a commit removes it after the user's yes`);
  }
  return out;
}

// --- the planning chat marks ---

function marks(root) {
  let names = [];
  try { names = fs.readdirSync(marksDir(root)).filter((n) => n.endsWith('.json')); } catch { /* none */ }
  const out = [];
  for (const name of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(marksDir(root), name), 'utf8'));
      out.push({ session: name.slice(0, -5), feature: m.feature, folder: m.folder });
    } catch { /* unreadable mark: ignored */ }
  }
  return out;
}

// The feature this chat plans, or null.
function planningMark(root, sid) {
  if (!validSid(sid)) return null;
  const m = marks(root).find((x) => x.session === sid);
  return m && validFeature(m.feature) ? m.feature : null;
}

// The exported feature's folder mark set recorded for this chat (hooks/planning-guard.js lets the chat
// write there, wherever tickets_dir points): an absolute path inside the project whose way passes the
// feature's name, or null.
function markedFolder(root, sid) {
  if (!validSid(sid)) return null;
  const m = marks(root).find((x) => x.session === sid);
  if (!m || !validFeature(m.feature) || typeof m.folder !== 'string' || unsafeRel(root, m.folder)) return null;
  const parts = m.folder.split('/');
  return parts.includes(m.feature) ? path.join(root, ...parts) : null;
}

function clearMarks(root, match) {
  for (const m of marks(root)) if (match(m)) fs.rmSync(safeLocalPath(markHome(root), ...MARKS, `${m.session}.json`), { force: true });
}

function markCommand(root, sub, feature, sid) {
  if (!['set', 'get', 'clear'].includes(sub)) return refuse('mark', `unknown "${clean(String(sub))}": set, get, clear`);
  if (!validSid(sid)) return refuse(`mark ${sub}`, 'needs --session <id>');
  if (sub === 'get') { const f = planningMark(root, sid); return [`planning: ${f || 'none'}`]; }
  try {
    if (sub === 'clear') { clearMarks(root, (m) => m.session === sid); return ['planning: none']; }
    // A draft, or an exported feature whose tickets are in the working tree; one only another branch
    // has is named, so the chat can switch to it.
    const { d, why } = needDraft(root, feature, 'mark set');
    const reopen = reopens(root, feature, d);
    const ex = reopen ? require('./plans-export.js').featureFolder(root, feature) : null;
    if (reopen && !ex) {
      const b = require('./plans-export.js').branchWith(root, feature);
      if (b) return refuse('mark set', `the tickets of ${feature} are not in this working tree; branch ${b} has them: switch to it first`);
    }
    if (!ex && !d) return why;
    if (!ex && ['exported', 'abandoned'].includes(stateOf(d))) return refuse('mark set', `the plan is ${stateOf(d)}`);
    // An exported feature's folder is recorded for the write guard.
    safeLocalWrite(markHome(root), [...MARKS, `${sid}.json`], JSON.stringify(ex ? { feature, folder: rel(root, ex.folder) } : { feature }) + '\n');
    return [ex ? `planning: ${feature} (exported: ${rel(root, ex.folder)}/)` : `planning: ${feature}`];
  } catch (e) { return refuse(`mark ${sub}`, e.message); }
}

module.exports = {
  validFeature, listDrafts, draftList, draftFind, draftNew, ticketNew,
  draftCheck, draftReview, draftReviewed, draftState, planningMark, markedFolder, markCommand, ticketHash, draftDirs,
  draftSet, draftStale,
  // for lib/plans-export.js
  base, needDraft, settle, stateOf, problems, tickets, ticketIds, writePlan, writeFile,
  branchesOf, mainBranch, PLAN_FILE, TICKET_FILE, fromTemplate, ticketProblems, cycles,
  // for feature-page.js
  mentionedFiles, pageCode, PAGE_CODE, machineFolders, localPaths, localProblems, researchTexts,
};
