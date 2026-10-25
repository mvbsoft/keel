'use strict';
// keel's planning drafts (/keel:start-planning). One feature = one draft folder until its tickets are
// exported:
// - Where: .keel/local/plans/keel/<feature>/ (this machine only), or <draft_dir>/<feature>/ in the
//   repository when settings say `draft: repo`. Both places are always read, so changing the setting
//   does not hide a draft.
// - plan.md (front matter `type: plan`, `status`, `last_ticket`...), tickets/T<n>-<slug>.md (front
//   matter `id`, `depends_on`, `review_hash`), reviews/ (written by the conversation).
// - States: draft -> ready -> exported, draft or ready -> abandoned, ready -> draft. A plan changed
//   after `ready` (its ready_hash no longer matches) is a draft again.
// - Settings: .keel/local/plans/keel/settings.json. The planning chat marks:
//   .keel/local/plans/keel/sessions/<session id>.json = { "feature": "<name>" }.
// Nothing here prints a draft's text beyond its name, state, counts and the problems check finds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkConfig } = require('./config.js');
const { moveToTrash } = require('./trash.js');
const { git, read, frontmatter, clean } = require('./repo-read.js');
const { linkOnWay, unsafeRel, localLink, safeLocalPath, safeLocalWrite } = require('./safe-path.js');
const { validSid } = require('./ids.js');
const { sections, setFront, dateOf } = require('./tasks.js');

const PLAN_FILE = 'plan.md';
const TEMPLATES = path.join(__dirname, '..', '..', 'templates', 'keel', 'planning');
const STATES = ['draft', 'ready', 'exported', 'abandoned'];
const MOVES = { draft: ['ready', 'abandoned'], ready: ['draft', 'exported', 'abandoned'], exported: [], abandoned: [] };
const PLAN_SECTIONS = ['Summary', 'Problem / Goal', 'Decisions', 'Out of scope', 'Design sketch', 'Terms', 'Open questions', 'Tickets', 'Next action'];
const TICKET_SECTIONS = ['Goal', 'Why', 'Acceptance criteria', 'Where to look', 'Out of scope', 'Dependencies', 'How to check'];
// 2-4 English words joined by hyphens, starting with a letter; a word never starts with a digit, else
// part of the name reads as a tracker key (add-2fa -> ADD-2).
const FEATURE = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*){1,3}$/;
const FEATURE_MAX = 40;
const SLUG_MAX = 60;
const TICKET_FILE = /^T(\d+)-[a-z0-9-]+\.md$/;
const DEFAULTS = { draft: 'pc', draft_dir: 'tickets' };
const SETTING_KEYS = ['language', 'draft', 'draft_dir', 'export', 'export_dir', 'prefix'];
// Files a ticket names in "Where to look" without a folder or a line count only with a known extension:
// `obj.id` or `fs.readFileSync` are code, not files.
const FILE_EXT = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'h', 'cpp', 'hpp', 'swift', 'dart', 'ex', 'exs', 'scala', 'md', 'json', 'yml', 'yaml', 'toml', 'xml', 'sql', 'sh', 'ps1', 'html', 'css', 'scss', 'vue', 'svelte', 'txt', 'ini', 'cfg', 'gradle', 'lock', 'proto', 'graphql']);

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const base = (root) => path.join(root, '.keel', 'local', 'plans', 'keel');
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';

// --- settings ---

const settingsFile = (root) => path.join(base(root), 'settings.json');

// Why a repository folder cannot hold planning files, or null. The places keel's scanner reads as
// another system (handoff/, handoffs/), hidden folders and docs/plans are never used.
function badFolder(root, dir) {
  if (typeof dir !== 'string' || !dir.trim()) return 'empty';
  const why = unsafeRel(root, dir);
  if (why) return why;
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  if (parts.some((p) => p.startsWith('.'))) return 'a hidden folder';
  if (parts.some((p) => /^handoffs?$/i.test(p))) return 'handoff/ and handoffs/ belong to another system';
  if (/^docs\/plans(\/|$)/i.test(parts.join('/'))) return 'docs/plans is not for tickets';
  return null;
}

const SETTING_CHECKS = {
  language: (v) => (/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v) ? null : 'a language code such as en or uk'),
  draft: (v) => (['pc', 'repo'].includes(v) ? null : 'pc or repo'),
  draft_dir: (v, root) => badFolder(root, v),
  export: (v) => (['pc', 'repo'].includes(v) ? null : 'pc or repo'),
  export_dir: (v, root) => badFolder(root, v),
  prefix: (v) => (/^[A-Z][A-Z0-9]{1,9}$/.test(v) ? null : '2-10 capital letters and digits, starting with a letter'),
};

// The saved settings (only valid values) and whether the file exists.
function readSettings(root) {
  const text = read(settingsFile(root));
  let raw = null;
  try { raw = text === null ? null : JSON.parse(text); } catch { /* unreadable: defaults */ }
  const saved = {};
  if (raw && typeof raw === 'object') {
    for (const k of SETTING_KEYS) if (typeof raw[k] === 'string' && !SETTING_CHECKS[k](raw[k], root)) saved[k] = raw[k];
  }
  return { exists: text !== null, readable: text === null || (raw !== null && typeof raw === 'object'), saved };
}

// The settings in effect: saved values over the defaults; the language defaults to repo_language.
function settings(root) {
  const { saved } = readSettings(root);
  const { state, config } = checkConfig(root);
  return { language: (state === 'ok' && config.repo_language) || 'en', ...DEFAULTS, ...saved };
}

function settingsShow(root) {
  const { exists, readable, saved } = readSettings(root);
  const s = settings(root);
  const out = [exists ? `settings: ${rel(root, settingsFile(root))}${readable ? '' : ' (unreadable: defaults in use)'}` : 'settings: none yet (the first planning here asks the language and where the draft lives)'];
  for (const k of SETTING_KEYS) out.push(`${k}: ${s[k] === undefined ? '-' : s[k]}${k in saved ? '' : s[k] === undefined ? '' : ' (default)'}`);
  return out;
}

function settingsSet(root, opts) {
  const updates = {};
  for (const k of SETTING_KEYS) {
    if (opts[k] === undefined) continue;
    const v = typeof opts[k] === 'string' ? opts[k].trim().replace(/\\/g, '/').replace(/\/+$/, '') : '';
    const why = SETTING_CHECKS[k](v, root);
    if (why) return refuse('settings set', `--${k}: ${why}`);
    updates[k] = v;
  }
  if (!Object.keys(updates).length) return refuse('settings set', `nothing to set: --${SETTING_KEYS.join(', --')}`);
  try {
    safeLocalWrite(root, ['plans', 'keel', 'settings.json'], JSON.stringify({ ...readSettings(root).saved, ...updates }, null, 2) + '\n');
  } catch (e) { return refuse('settings set', e.message); }
  return settingsShow(root);
}

// --- the drafts ---

const validFeature = (name) => typeof name === 'string' && name.length <= FEATURE_MAX && FEATURE.test(name);
const FEATURE_RULE = '2-4 English words joined by hyphens, [a-z0-9-], at most 40 characters, starting with a letter, no digit right after a hyphen (add-2fa reads as the key ADD-2)';

// The folders that may hold drafts: this machine's first, then the repository's draft_dir.
function draftDirs(root) {
  const dir = settings(root).draft_dir;
  return [{ dir: base(root), local: true }, ...(badFolder(root, dir) ? [] : [{ dir: path.join(root, dir), local: false }])];
}

// One draft: its folder, plan.md text and front matter. Links are skipped: a draft folder is always a
// real folder.
function draftAt(folder, local) {
  const text = read(path.join(folder, PLAN_FILE));
  if (text === null) return null;
  const fm = frontmatter(text);
  if (fm.type !== 'plan' || !STATES.includes(fm.status)) return null;
  return { feature: path.basename(folder), folder, local, text, fm };
}

function listDrafts(root) {
  const out = [];
  for (const { dir, local } of draftDirs(root)) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* none */ }
    for (const e of entries) {
      if (!e.isDirectory() || !validFeature(e.name)) continue;
      const d = draftAt(path.join(dir, e.name), local);
      if (d) out.push(d);
    }
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature));
}

// The draft named `feature`, or { why } for the refusal.
function needDraft(root, feature, what) {
  if (!validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}": ${FEATURE_RULE}`) };
  const found = listDrafts(root).filter((d) => d.feature === feature);
  if (!found.length) return { why: refuse(what, `no draft "${feature}" (plans.js list shows the drafts)`) };
  if (found.length > 1) return { why: refuse(what, `two drafts "${feature}": ${found.map((d) => `${rel(root, d.folder)}/`).join(' and ')}; keep one`) };
  return { d: found[0] };
}

// The draft's tickets, by T-number. A file whose name is not T<n>-<slug>.md is not a ticket.
function tickets(d) {
  let names = [];
  try { names = fs.readdirSync(path.join(d.folder, 'tickets'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { /* none */ }
  return names.map((name) => TICKET_FILE.exec(name)).filter(Boolean)
    .map((m) => { const file = path.join(d.folder, 'tickets', m[0]); const text = read(file) || ''; return { id: `T${Number(m[1])}`, n: Number(m[1]), name: m[0], file, text, fm: frontmatter(text) }; })
    .sort((a, b) => a.n - b.n);
}

const ticketIds = (value) => String(value || '').replace(/[[\]]/g, '').split(/[\s,;]+/).filter((x) => x && x !== '-');

// Open questions: the Q<n> items of "Open questions" (an answered one moves to Decisions).
function openQuestions(text) {
  const sec = sections(text)['Open questions'] || '';
  return sec.split('\n').filter((l) => /^\s*(?:[-*]\s+)?(?:\*\*)?Q\d+\b/.test(l)).length;
}

// The newest change of any file in the folder, as a local date.
function lastChange(folder) {
  let newest = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { newest = Math.max(newest, fs.statSync(p).mtimeMs); } catch { /* gone */ } }
    }
  };
  walk(folder);
  return newest ? dateOf(new Date(newest)) : '-';
}

// --- hashes ---

// A ticket's review hash: its text without the review_hash line.
const frontOnly = (text, re) => lf(text).replace(/^---\n[\s\S]*?\n---/, (fm) => fm.replace(re, ''));
const ticketHash = (text) => sha(frontOnly(text, /^review_hash:.*\n?/gm).trimEnd());

// The whole draft but its state: plan.md without status and ready_hash, and every ticket. reviews/
// records decisions and does not count.
function draftHash(d) {
  const plan = frontOnly(d.text, /^(status|ready_hash):.*\n?/gm);
  return sha([plan, ...tickets(d).map((t) => `\n--- ${t.name}\n${lf(t.text)}`)].join(''));
}

// The state in effect: a ready plan changed since (another hash) is a draft again.
const editedAfterReady = (d) => d.fm.status === 'ready' && d.fm.ready_hash !== draftHash(d);
const stateOf = (d) => (editedAfterReady(d) ? 'draft' : d.fm.status);

// Writes plan.md's front matter fields; returns the updated draft.
function writePlan(root, d, updates) {
  const text = setFront(d.text, updates);
  if (text === null) throw new Error(`${rel(root, path.join(d.folder, PLAN_FILE))} has no front matter`);
  writeFile(root, d, path.join(d.folder, PLAN_FILE), text);
  return { ...d, text, fm: frontmatter(text) };
}

// A ready plan changed since goes back to draft in the file too.
function settle(root, d) {
  return editedAfterReady(d) ? writePlan(root, d, { status: 'draft', ready_hash: '-' }) : d;
}

// Every write into a draft: under .keel/local through safeLocalPath, in the repository with no link on
// the way.
function writeFile(root, d, file, text) {
  if (d.local) {
    const target = safeLocalPath(root, ...path.relative(path.join(root, '.keel', 'local'), file).split(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    return;
  }
  const why = linkOnWay(root, file);
  if (why) throw new Error(`${why}: keel does not write through it`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// --- the list ---

function where(root, d) {
  return `${rel(root, d.folder)}/${d.local ? ' (this machine only)' : ''}`;
}

function draftLine(root, d) {
  const state = stateOf(d);
  const note = editedAfterReady(d) ? ' (changed after ready)' : '';
  return `- ${d.feature}: ${state}${note} · open Q ${openQuestions(d.text)} · tickets ${tickets(d).length} · changed ${lastChange(d.folder)} · ${where(root, d)}`;
}

function draftList(root) {
  const drafts = listDrafts(root);
  return [`drafts: ${drafts.length}`, ...drafts.map((d) => draftLine(root, d))];
}

// Words of a request ("continue planning the S3 connection") against folder names and Summary. Words
// shorter than 3 letters are left out unless they hold a digit (s3); a word of 5 letters or more
// matches by its first 5 (connect ~ connection, підключення ~ підключенням).
const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3 || (w.length === 2 && /\d/.test(w)));
const stem = (w) => (w.length >= 5 ? w.slice(0, 5) : w);

function draftFind(root, query) {
  const asked = [...new Set(words(query).map(stem))];
  if (!asked.length) return refuse('find', 'needs words');
  const drafts = listDrafts(root);
  const scored = drafts.map((d) => {
    const have = new Set([...words(d.feature.replace(/-/g, ' ')), ...words(sections(d.text).Summary || '')].map(stem));
    return { d, score: asked.filter((w) => have.has(w)).length };
  });
  const top = Math.max(0, ...scored.map((s) => s.score));
  const best = top ? scored.filter((s) => s.score === top).map((s) => s.d) : [];
  if (best.length === 1) return ['find: 1 match', draftLine(root, best[0])];
  if (best.length > 1) return [`find: ${best.length} matches`, ...best.map((d) => draftLine(root, d))];
  return [`find: no match (all drafts: ${drafts.length})`, ...drafts.map((d) => draftLine(root, d))];
}

// --- making drafts and tickets ---

// A template without its comments, its front matter replaced by `front`.
function fromTemplate(name, front) {
  const body = lf(fs.readFileSync(path.join(TEMPLATES, name), 'utf8')).replace(/<!--[\s\S]*?-->\s*/g, '').replace(/^---\n[\s\S]*?\n---\n/, '').trimStart();
  return { body, text: (b) => `---\n${Object.entries(front).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${b}` };
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
  const repoDirs = [s.draft_dir, s.export_dir].filter((x) => x && !badFolder(root, x));
  const taken = [folder, ...repoDirs.map((x) => path.join(root, x, feature))].find((f) => fs.existsSync(f));
  if (taken) return refuse('new', `${rel(root, taken)}/ exists: pick another name`);
  const head = git(root, ['rev-parse', '--short', 'HEAD']);
  const front = { type: 'plan', status: 'draft', feature, language: s.language, export: '-', created: dateOf(now), after_commit: head || '-', last_ticket: 0, ready_hash: '-' };
  const t = fromTemplate(PLAN_FILE, front);
  const d = { feature, folder, local, text: '', fm: {} };
  try { writeFile(root, d, path.join(folder, PLAN_FILE), t.text(t.body.replace(/^# .*$/m, () => `# ${feature}`))); } catch (e) { return refuse('new', e.message); }
  return [`created: ${rel(root, path.join(folder, PLAN_FILE))}`, `draft: ${where(root, d)}`, 'status: draft', `language: ${s.language}`];
}

const slugOf = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_MAX).replace(/-+$/, '');

function ticketNew(root, feature, o) {
  const { d: found, why } = needDraft(root, feature, 'ticket');
  if (!found) return why;
  const d = settle(root, found);
  if (!['draft', 'ready'].includes(d.fm.status)) return refuse('ticket', `the plan is ${d.fm.status}`);
  if (typeof o.title !== 'string' || !oneLine(o.title)) return refuse('ticket', 'needs --title');
  const slug = slugOf(typeof o.slug === 'string' ? o.slug : o.title);
  if (!slug) return refuse('ticket', 'the title has no English words for the file name: add --slug <english-words>');
  const deps = typeof o.depends === 'string' ? ticketIds(o.depends) : [];
  const all = tickets(d);
  const unknown = deps.filter((x) => !all.some((t) => t.id === x));
  if (unknown.length) return refuse('ticket', `--depends: no ticket ${unknown.join(', ')}`);
  // Numbers are never reused: past the highest ever given and the highest file there.
  const n = Math.max(Number(d.fm.last_ticket) || 0, ...all.map((t) => t.n)) + 1;
  const id = `T${n}`;
  const file = path.join(d.folder, 'tickets', `${id}-${slug}.md`);
  const t = fromTemplate('ticket.md', { id, depends_on: `[${deps.join(', ')}]`, review_hash: '-' });
  try {
    writeFile(root, d, file, t.text(t.body.replace(/^# .*$/m, () => `# [${id}] ${oneLine(o.title)}`)));
    writePlan(root, d, { last_ticket: n, ...(d.fm.status === 'ready' ? { status: 'draft', ready_hash: '-' } : {}) });
  } catch (e) { return refuse('ticket', e.message); }
  return [`created: ${rel(root, file)}`, `ticket: ${id}`];
}

// --- the structure check ---

// The text a placeholder search reads: no code blocks, no inline code, no links in angle brackets.
const prose = (text) => lf(text).replace(/^```[\s\S]*?^```/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)).replace(/<https?:[^>\s]*>/g, (m) => ' '.repeat(m.length));

// "TBD" or "<...>" left in the text after the front matter, with its line.
function placeholders(text) {
  const all = lf(text);
  const fmEnd = /^---\n[\s\S]*?\n---\n?/.exec(all);
  const skip = fmEnd ? fmEnd[0].split('\n').length - 1 : 0;
  const out = [];
  prose(all).split('\n').forEach((line, i) => {
    if (i < skip) return;
    const m = /\bTBD\b/.exec(line) || /<[^<>\n]*>/.exec(line);
    if (m) out.push(`${clean(m[0], 40)} (line ${i + 1})`);
  });
  return out;
}

// The files "Where to look" names: inline code or a bare path:line, without the line part.
function mentionedFiles(text) {
  const found = new Set();
  const add = (raw) => {
    const p = raw.trim().replace(/#L\d+.*$/, '').replace(/:\d+(?:[-:]\d+)?$/, '');
    if (!p || /[\s*?(){}<>]/.test(p) || /^[a-z]+:\/\//i.test(p)) return;
    const ext = /\.([A-Za-z0-9]+)$/.exec(p);
    if (p.includes('/') || /:\d+/.test(raw) || (ext && FILE_EXT.has(ext[1].toLowerCase()))) found.add(p.replace(/^\.\//, ''));
  };
  for (const m of text.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of text.replace(/`[^`\n]*`/g, ' ').matchAll(/(?:^|[\s(])([\w./-]+\.[A-Za-z0-9]+:\d+)/gm)) add(m[1]);
  return [...found];
}

// Dependency cycles, each as T1 -> T2 -> T1.
function cycles(list) {
  const deps = new Map(list.map((t) => [t.id, ticketIds(t.fm.depends_on).filter((x) => x !== t.id)]));
  const out = [];
  const seen = new Set();
  const visit = (id, stack) => {
    if (stack.includes(id)) { out.push([...stack.slice(stack.indexOf(id)), id].join(' -> ')); return; }
    if (seen.has(id) || !deps.has(id)) return;
    seen.add(id);
    for (const next of deps.get(id)) visit(next, [...stack, id]);
  };
  for (const t of list) visit(t.id, []);
  return out;
}

function problems(root, d) {
  const out = [];
  const plan = sections(d.text);
  for (const name of PLAN_SECTIONS) if (!(name in plan)) out.push(`plan.md: no section "## ${name}"`);
  for (const p of placeholders(d.text)) out.push(`plan.md: placeholder ${p}`);
  const list = tickets(d);
  const ids = new Set(list.map((t) => t.id));
  for (const t of list) {
    const secs = sections(t.text);
    if (t.fm.id !== t.id) out.push(`${t.id}: front matter id is "${clean(t.fm.id || '')}", the file name says ${t.id}`);
    for (const name of TICKET_SECTIONS) if (!(name in secs)) out.push(`${t.id}: no section "## ${name}"`);
    if ('Acceptance criteria' in secs && !secs['Acceptance criteria'].trim()) out.push(`${t.id}: acceptance criteria are empty`);
    for (const p of placeholders(t.text)) out.push(`${t.id}: placeholder ${p}`);
    for (const f of mentionedFiles(secs['Where to look'] || '')) {
      const outside = path.isAbsolute(f) || path.win32.isAbsolute(f) || f.split('/').includes('..');
      if (outside) out.push(`${t.id}: ${clean(f)} in Where to look is outside the project`);
      else if (!fs.existsSync(path.join(root, f))) out.push(`${t.id}: ${clean(f)} in Where to look does not exist`);
    }
    for (const dep of ticketIds(t.fm.depends_on)) {
      if (dep === t.id) out.push(`${t.id}: depends on itself`);
      else if (!ids.has(dep)) out.push(`${t.id}: depends on ${clean(dep)}, which does not exist`);
    }
  }
  for (const c of cycles(list)) out.push(`dependency cycle: ${c}`);
  return { out, count: list.length };
}

function draftCheck(root, feature) {
  const { d: found, why } = needDraft(root, feature, 'check');
  if (!found) return why;
  let d;
  try { d = settle(root, found); } catch (e) { return refuse('check', e.message); }
  const { out, count } = problems(root, d);
  const back = d !== found ? ['status: draft (the plan changed after ready)'] : [];
  if (!out.length) return [`check: clean (plan.md and ${count} tickets)`, ...back];
  return [`check: ${out.length} problems`, ...out.map((p) => `- ${p}`), ...back];
}

// --- reviews ---

const reviewState = (t) => (!given(t.fm.review_hash) ? 'never reviewed' : t.fm.review_hash === ticketHash(t.text) ? 'unchanged' : 'changed since review');

function draftReview(root, feature) {
  const { d, why } = needDraft(root, feature, 'review');
  if (!d) return why;
  const list = tickets(d).map((t) => ({ t, state: reviewState(t) }));
  const due = list.filter((x) => x.state !== 'unchanged').length;
  return [`review: ${due} of ${list.length} tickets to review`, ...list.map((x) => `- ${x.t.id}: ${x.state}`)];
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

const marksDir = (root) => path.join(base(root), 'sessions');

function marks(root) {
  let names = [];
  try { names = fs.readdirSync(marksDir(root)).filter((n) => n.endsWith('.json')); } catch { /* none */ }
  const out = [];
  for (const name of names) {
    try { out.push({ session: name.slice(0, -5), feature: JSON.parse(fs.readFileSync(path.join(marksDir(root), name), 'utf8')).feature }); } catch { /* unreadable mark: ignored */ }
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
  for (const m of marks(root)) if (match(m)) fs.rmSync(safeLocalPath(root, 'plans', 'keel', 'sessions', `${m.session}.json`), { force: true });
}

function markCommand(root, sub, feature, sid) {
  if (!['set', 'get', 'clear'].includes(sub)) return refuse('mark', `unknown "${clean(String(sub))}": set, get, clear`);
  if (!validSid(sid)) return refuse(`mark ${sub}`, 'needs --session <id>');
  if (sub === 'get') { const f = planningMark(root, sid); return [`planning: ${f || 'none'}`]; }
  try {
    if (sub === 'clear') { clearMarks(root, (m) => m.session === sid); return ['planning: none']; }
    const { d, why } = needDraft(root, feature, 'mark set');
    if (!d) return why;
    if (['exported', 'abandoned'].includes(stateOf(d))) return refuse('mark set', `the plan is ${stateOf(d)}`);
    safeLocalWrite(root, ['plans', 'keel', 'sessions', `${sid}.json`], JSON.stringify({ feature: d.feature }) + '\n');
    return [`planning: ${d.feature}`];
  } catch (e) { return refuse(`mark ${sub}`, e.message); }
}

module.exports = {
  validFeature, settings, settingsShow, settingsSet, listDrafts, draftList, draftFind, draftNew, ticketNew,
  draftCheck, draftReview, draftReviewed, draftState, planningMark, markCommand, ticketHash,
};
