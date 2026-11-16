'use strict';
// keel's planned features (/keel:start-planning). One feature = one folder, from its first plan to its
// last ticket; nothing in it is renamed or copied:
// - Where: .keel/local/plans/keel/<feature>/ (this machine only, place pc), or <tickets_dir>/<feature>/
//   in the repository (place repo); planning.place says where a new one goes. Both places are always
//   read, so changing the setting does not hide a feature.
// - plan.md (front matter `type: plan`, `status`, `branch`, `merge_into`, `last_ticket`, `ready_hash`...),
//   tickets/T<n>-<slug>.md (front matter `id`, `type`, `status`, `repo`, `depends_on`, `branch`,
//   `reason`, `review_hash`; `type: stub` for a stub, lib/plans-stubs.js), reviews/ and research/
//   (written by the conversation). `page` is the feature's random code that names its page
//   (feature-page.js) the same from every machine and repository.
// - States, of the plan and of each ticket alike: draft -> ready -> in-progress -> done, and abandoned
//   (with a reason) from any; only `status` holds them. An edit never changes a status: a change of an
//   essential section marks a ticket or the plan as needing review (lib/plans-drafts.js).
// - Settings: lib/plans-settings.js. The planning chat marks (in the main checkout, lib/chat-marks.js):
//   .keel/local/plans/keel/sessions/<session id>.json = { "feature": "<name>" }.
// - A feature on several repositories: plan.md `repos`, a ticket's `repo`, plan.md
//   `after_commit_repos` (lib/plans-repos.js); check, stale and review read another repository's
//   tickets in its folder.
// - Reading and writing a feature: lib/plans-drafts.js; check and stale: lib/plans-check.js; commit
//   and push: lib/plans-git.js; tickets, next and drop: lib/plans-state.js.
// Nothing here prints a feature's text beyond its name, state, counts and the problems check finds.
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig } = require('./config.js');
const { git, clean, validBranchName } = require('./repo-read.js');
const { localLink, safeLocalPath, safeLocalWrite } = require('./safe-path.js');
const { validSid } = require('./ids.js');
const { dateOf } = require('./tasks.js');
const { base, badFolder, settings } = require('./plans-settings.js');
const { MARKS, markHome, marksDir } = require('./chat-marks.js');
const {
  PLAN_FILE, STATES, CLOSED, TICKET_FILE, FEATURE_RULE, validFeature, draftDirs, listDrafts, needDraft,
  tickets, ticketIds, openQuestions, ticketHash, planHash, needsReview, pageCode, PAGE_CODE,
  writePlan, writeTicket, writeFile, where, draftList, draftFind,
} = require('./plans-drafts.js');
const {
  draftCheck, draftStale, problems, ticketProblems, cycles,
  mentionedFiles, machineFolders, localPaths, localProblems, homeNotes, researchTexts,
} = require('./plans-check.js');

const TEMPLATES = path.join(__dirname, '..', '..', 'templates', 'keel', 'planning');
const PLACES = ['repo', 'pc'];
const SLUG_MAX = 60;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const reasonOf = (o) => (typeof o.reason === 'string' ? oneLine(o.reason) : '');

// The project's main branch (config git.main_branch), or null without a valid config.
function mainBranch(root) {
  const { state, config } = checkConfig(root);
  return state === 'ok' ? config.git.main_branch : null;
}

// --- making features and tickets ---

// A template without its comments, its front matter replaced by `front` (an empty value as `key:`).
function fromTemplate(name, front) {
  let body = lf(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'));
  // Until none is left: removing one comment must not join the halves of another.
  for (let before; before !== body;) { before = body; body = body.replace(/<!--[\s\S]*?-->\s*/g, ''); }
  body = body.replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
  const field = ([k, v]) => (String(v) === '' ? `${k}:` : `${k}: ${v}`);
  return { body, text: (b) => `---\n${Object.entries(front).map(field).join('\n')}\n---\n\n${b}` };
}

// Whether a local branch <feature> or the remote's <remote>/<feature> exists while HEAD is on another one.
function featureBranchElsewhere(root, feature) {
  if (git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) === feature) return false;
  const remote = require('../git-flow.js').pickRemote((git(root, ['remote']) || '').split('\n').filter(Boolean));
  const refs = [`refs/heads/${feature}`, ...(remote ? [`refs/remotes/${remote}/${feature}`] : [])];
  return refs.some((ref) => git(root, ['rev-parse', '-q', '--verify', ref]) !== null);
}

// `place`: repo or pc for this feature, else planning.place, else pc.
function draftNew(root, feature, { place } = {}, now = new Date()) {
  if (!validFeature(feature)) return refuse('new', `invalid feature name "${clean(String(feature))}": ${FEATURE_RULE}`);
  if (place !== undefined && !PLACES.includes(place)) return refuse('new', '--place is repo or pc');
  const s = settings(root);
  const local = (place || s.place || 'pc') === 'pc';
  if (!local && badFolder(root, s.tickets_dir)) return refuse('new', `tickets_dir "${clean(s.tickets_dir)}": ${badFolder(root, s.tickets_dir)}`);
  if (local && localLink(root)) return refuse('new', `${localLink(root)}: keel does not write through it`);
  // Taken: a feature in either place, or any folder of that name in either place.
  const found = listDrafts(root).find((d) => d.feature === feature);
  if (found) return refuse('new', `a feature "${feature}" exists (${found.fm.status}, ${where(root, found)}): continue it or pick another name`);
  const folder = path.join(local ? base(root) : path.join(root, s.tickets_dir), feature);
  const taken = draftDirs(root).map((x) => path.join(x.dir, feature)).find((f) => fs.existsSync(f));
  if (taken) return refuse('new', `${rel(root, taken)}/ exists: pick another name`);
  // A feature committed on its feature branch is not seen from another branch: that branch takes the name.
  if (!local && featureBranchElsewhere(root, feature)) return refuse('new', `branch ${feature} exists and may hold this feature: switch to it, or pick another name`);
  const head = git(root, ['rev-parse', '--short', 'HEAD']);
  const front = { type: 'plan', status: 'draft', feature, page: pageCode(), language: s.language, branch: feature, merge_into: mainBranch(root) || '-', repos: '-', created: dateOf(now), after_commit: head || '-', after_commit_repos: '-', last_ticket: 0, ready_hash: '-' };
  const t = fromTemplate(PLAN_FILE, front);
  const d = { feature, folder, local, text: '', fm: {} };
  try { writeFile(root, d, path.join(folder, PLAN_FILE), t.text(t.body.replace(/^# .*$/m, () => `# ${feature}`))); } catch (e) { return refuse('new', e.message); }
  return [`created: ${rel(root, path.join(folder, PLAN_FILE))}`, `folder: ${where(root, d)}`, 'status: draft', `language: ${s.language}`];
}

const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');

// A new ticket is T<n>, status draft and not reviewed: on a ready feature the plan keeps its state and
// the ticket waits for its review.
function ticketNew(root, feature, o) {
  const { d, why } = needDraft(root, feature, 'ticket');
  if (!d) return why;
  if (CLOSED.includes(d.fm.status)) return refuse('ticket', `the plan is ${d.fm.status}`);
  if (o['from-stub'] !== undefined) return stubs().fromStub(root, feature, d, null, o['from-stub']);
  if (o.stub !== undefined && o.repo !== undefined) return refuse('ticket', '--stub names the repository itself: --stub WEB, without --repo');
  if (typeof o.title !== 'string' || !oneLine(o.title)) return refuse('ticket', 'needs --title');
  const slug = slugOf(typeof o.slug === 'string' ? o.slug : o.title);
  if (!slug) return refuse('ticket', 'the title has no English words for the file name: add --slug <english-words>');
  const deps = typeof o.depends === 'string' ? ticketIds(o.depends).map((x) => x.toUpperCase()) : [];
  if (o.repo !== undefined && (typeof o.repo !== 'string' || !o.repo.trim())) return refuse('ticket', '--repo needs a ticket prefix: --repo WEB');
  let repo = null;
  if (o.stub !== undefined) {
    const r = stubs().stubRepo(root, o.stub, feature);
    if (r.why) return refuse('ticket', r.why);
    repo = r.prefix;
  } else if (o.repo !== undefined) {
    const asked = o.repo.trim().toUpperCase();
    if (!repos().planRepos(d.fm).includes(asked)) return refuse('ticket', `--repo: ${clean(asked, 20)} is not in the plan's repos (plans.js set ${feature} --repos ...)`);
    repo = asked;
  }
  const all = tickets(d);
  const unknown = deps.filter((x) => !all.some((t) => t.id === x));
  if (unknown.length) return refuse('ticket', `--depends: no ticket ${unknown.map((x) => clean(x, 40)).join(', ')} in ${feature}`);
  // Numbers are never reused: past the highest ever given and the highest file there.
  const n = Math.max(Number(d.fm.last_ticket) || 0, ...all.map((t) => t.n)) + 1;
  const id = `T${n}`;
  const file = path.join(d.folder, 'tickets', `${id}-${slug}.md`);
  const front = { id, type: o.stub !== undefined ? 'stub' : 'ticket', status: 'draft', ...(repo ? { repo } : {}), depends_on: deps.join(', '), review_hash: '-' };
  const t = fromTemplate(o.stub !== undefined ? 'stub.md' : 'ticket.md', front);
  try {
    writeFile(root, d, file, t.text(t.body.replace(/^# .*$/m, () => `# [${id}] ${oneLine(o.title)}`)));
    writePlan(root, d, { last_ticket: n });
  } catch (e) { return refuse('ticket', e.message); }
  const waits = d.fm.status !== 'draft' ? [`note: ${id} is a draft until its review: plans.js reviewed ${feature} ${id}, then plans.js status ${feature} ${id} ready`] : [];
  return [`created: ${rel(root, file)}`, `ticket: ${id}`, ...waits];
}

const repos = () => require('./plans-repos.js');
const stubs = () => require('./plans-stubs.js');

// --- the feature branch ---

// A branch name git takes as it is (check-ref-format would turn @{-1} into another name) and never
// reads as an option.
const validBranch = (root, name) => validBranchName(root, name) && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name);

// The feature branch and where it merges: plan.md's values, else the feature name and the main branch.
function branchesOf(root, d) {
  return { branch: given(d.fm.branch) ? d.fm.branch : d.feature, merge_into: given(d.fm.merge_into) ? d.fm.merge_into : mainBranch(root) };
}

// plans.js set: the plan's branch and merge_into; its repositories (--repos, lib/plans-repos.js); and
// --after-commit: after_commit and the other repositories' after_commit_repos from their HEAD now. A
// closed plan (done, abandoned) is not changed; the status never changes here.
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
  if (CLOSED.includes(found.fm.status)) return refuse('set', `the plan is ${found.fm.status}`);
  let d = found;
  const changed = Object.entries(updates).filter(([k, v]) => d.fm[k] !== v);
  if (changed.length) {
    try { d = writePlan(root, d, Object.fromEntries(changed)); } catch (e) { return refuse('set', e.message); }
  }
  const b = branchesOf(root, d);
  return [
    `branch: ${b.branch}`, `merge_into: ${b.merge_into || '-'}`,
    ...(o.repos !== undefined ? [`repos: ${d.fm.repos}`] : []),
    ...(commit ? [`after_commit: ${d.fm.after_commit}`] : []),
    ...('after_commit_repos' in updates ? [`after_commit_repos: ${d.fm.after_commit_repos}`] : []),
    ...(o.repos !== undefined || commit ? repos().noCommitNotes(list, s) : []),
  ];
}

// --- reviews ---

const reviewState = (t) => (!given(t.fm.review_hash) ? 'never reviewed' : needsReview(t) ? 'changed since review' : 'unchanged');
const planReviewState = (d) => (d.fm.status === 'draft' ? 'draft' : !given(d.fm.ready_hash) ? 'never reviewed' : d.fm.ready_hash === planHash(d.text) ? 'unchanged' : 'changed since ready');

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
    `- plan: ${planReviewState(d)}`,
    ...(planned.length ? [`repos: ${folders.join(', ')}`] : []),
    ...list.map((x) => `- ${x.t.id}: ${x.state}${place(x.target)}`),
  ];
}

// Records the review hashes of the named tickets; `plan` records the plan's ready hash, which takes
// its mark away after the plan's review.
function draftReviewed(root, feature, ids) {
  const { d, why } = needDraft(root, feature, 'reviewed');
  if (!d) return why;
  if (!ids.length) return refuse('reviewed', 'needs the reviewed tickets: T1 T2 ... (or plan)');
  const list = tickets(d);
  const unknown = ids.filter((x) => x !== 'PLAN' && !list.some((t) => t.id === x));
  if (unknown.length) return refuse('reviewed', `no ticket ${unknown.map((x) => clean(x)).join(', ')}`);
  const out = [];
  try {
    if (ids.includes('PLAN')) { writePlan(root, d, { ready_hash: planHash(d.text) }); out.push('- plan: reviewed'); }
    for (const t of list.filter((x) => ids.includes(x.id))) {
      writeTicket(root, d, t, { review_hash: ticketHash(t.text) });
      out.push(`- ${t.id}: reviewed`);
    }
  } catch (e) { return refuse('reviewed', e.message); }
  return [`reviewed: ${out.length}`, ...out];
}

// --- states ---

const unknownState = (what, to) => refuse(what, `unknown state "${clean(String(to))}": ${STATES.join(', ')}`);
// When every ticket is done or abandoned and the plan is not closed: the line that says so.
const doneHint = (d, list) => (list.length && !CLOSED.includes(d.fm.status) && list.every((t) => CLOSED.includes(t.fm.status))
  ? [`plan: every ticket is done or abandoned: plans.js state ${d.feature} done`] : []);

// plans.js state: the plan's status. ready needs a clean check, a ticket and no open question, and
// readies every draft ticket that needs no review; abandoned (with a reason) abandons every open ticket
// too; done waits for every ticket to be done or abandoned.
function draftState(root, feature, to, o = {}) {
  const { d, why } = needDraft(root, feature, 'state');
  if (!d) return why;
  if (!STATES.includes(to)) return unknownState('state', to);
  const reason = reasonOf(o);
  if (to === 'abandoned' && !reason) return refuse('state', 'abandoned needs --reason "<why>"');
  const from = d.fm.status;
  if (from === to) return [`status: ${to} (already)`];
  const list = tickets(d);
  const out = [`status: ${to}`];
  try {
    if (to === 'ready') {
      const blocks = [];
      const found = problems(root, d);
      if (found.out.length) blocks.push(`check finds ${found.out.length} problems`);
      if (!found.count) blocks.push('no tickets');
      const q = openQuestions(d.text);
      if (q) blocks.push(`${q} open questions`);
      if (blocks.length) return refuse('state', `not ready: ${blocks.join('; ')}`);
      writePlan(root, d, { status: 'ready', ready_hash: planHash(d.text), reason: null });
      const drafts = list.filter((t) => t.fm.status === 'draft');
      const readied = drafts.filter((t) => !needsReview(t));
      for (const t of readied) writeTicket(root, d, t, { status: 'ready' });
      if (readied.length) out.push(`ready: ${readied.map((t) => t.id).join(', ')}`);
      const waiting = drafts.filter((t) => needsReview(t)).map((t) => t.id);
      if (waiting.length) out.push(`draft: ${waiting.join(', ')} (needs review: plans.js reviewed ${feature} <ids>, then plans.js status ${feature} <id> ready)`);
    } else if (to === 'abandoned') {
      writePlan(root, d, { status: 'abandoned', reason });
      const open = list.filter((t) => !CLOSED.includes(t.fm.status));
      for (const t of open) writeTicket(root, d, t, { status: 'abandoned', reason });
      if (open.length) out.push(`abandoned: ${open.map((t) => t.id).join(', ')}`);
    } else {
      const open = list.filter((t) => !CLOSED.includes(t.fm.status));
      if (to === 'done' && open.length) return refuse('state', `not every ticket is done or abandoned: ${open.map((t) => `${t.id} ${t.fm.status || 'no status'}`).join(', ')}`);
      writePlan(root, d, { status: to, reason: null, ...(to === 'draft' ? { ready_hash: '-' } : {}) });
    }
  } catch (e) { return refuse('state', e.message); }
  if (CLOSED.includes(to)) {
    try { clearMarks(root, (m) => m.feature === d.feature); } catch (e) { out.push(`chat marks not cleared: ${e.message}`); }
  }
  return out;
}

// plans.js status: one ticket's status. ready waits for its review; abandoned needs a reason and names
// the tickets that depend on it; in-progress moves a ready plan to in-progress.
function ticketStatus(root, feature, id, to, o = {}) {
  const { d, why } = needDraft(root, feature, 'status');
  if (!d) return why;
  const list = tickets(d);
  const t = list.find((x) => x.id === String(id || '').toUpperCase());
  if (!t) return refuse('status', id === undefined ? 'needs a ticket: T<n>' : `no ticket ${clean(String(id), 40)} in ${feature}`);
  if (!STATES.includes(to)) return unknownState('status', to);
  const reason = reasonOf(o);
  if (to === 'abandoned' && !reason) return refuse('status', 'abandoned needs --reason "<why>"');
  if (to === 'ready' && needsReview(t)) return refuse('status', `${t.id} needs review: plans.js reviewed ${feature} ${t.id} after its review`);
  if (t.fm.status === to && to !== 'abandoned') return [`status: ${t.id} ${to} (already)`];
  const out = [`status: ${t.id} ${to}`];
  let now;
  try {
    now = writeTicket(root, d, t, { status: to, reason: to === 'abandoned' ? reason : null });
    if (to === 'in-progress' && d.fm.status === 'ready') { writePlan(root, d, { status: 'in-progress' }); out.push('plan: in-progress'); }
  } catch (e) { return refuse('status', e.message); }
  if (to === 'abandoned') {
    for (const x of list.filter((x) => !CLOSED.includes(x.fm.status) && ticketIds(x.fm.depends_on).map((k) => k.toUpperCase()).includes(t.id))) {
      out.push(`note: ${x.id} depends on ${t.id}, which is abandoned: remove the dependency or abandon ${x.id} too`);
    }
  }
  out.push(...doneHint(d, list.map((x) => (x === t ? now : x))));
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
      out.push({ session: name.slice(0, -5), feature: m.feature });
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

function clearMarks(root, match) {
  for (const m of marks(root)) if (match(m)) fs.rmSync(safeLocalPath(markHome(root), ...MARKS, `${m.session}.json`), { force: true });
}

function markCommand(root, sub, feature, sid) {
  if (!['set', 'get', 'clear'].includes(sub)) return refuse('mark', `unknown "${clean(String(sub))}": set, get, clear`);
  if (!validSid(sid)) return refuse(`mark ${sub}`, 'needs --session <id>');
  if (sub === 'get') { const f = planningMark(root, sid); return [`planning: ${f || 'none'}`]; }
  try {
    if (sub === 'clear') { clearMarks(root, (m) => m.session === sid); return ['planning: none']; }
    const { d, why } = needDraft(root, feature, 'mark set');
    if (!d) return why;
    if (CLOSED.includes(d.fm.status)) return refuse('mark set', `the plan is ${d.fm.status}`);
    safeLocalWrite(markHome(root), [...MARKS, `${sid}.json`], JSON.stringify({ feature }) + '\n');
    return [`planning: ${feature}`];
  } catch (e) { return refuse(`mark ${sub}`, e.message); }
}

module.exports = {
  validFeature, listDrafts, draftList, draftFind, draftNew, ticketNew,
  draftCheck, draftReview, draftReviewed, draftState, ticketStatus, planningMark, markCommand, ticketHash, draftDirs,
  draftSet, draftStale,
  // for lib/plans-state.js, lib/plans-git.js, lib/plans-stubs.js and lib/plans-brief.js
  base, needDraft, tickets, ticketIds, writePlan, writeFile, clearMarks,
  branchesOf, mainBranch, PLAN_FILE, TICKET_FILE, STATES, CLOSED, fromTemplate, ticketProblems, cycles, homeNotes, needsReview,
  // for feature-page.js
  mentionedFiles, pageCode, PAGE_CODE, machineFolders, localPaths, localProblems, researchTexts,
};
