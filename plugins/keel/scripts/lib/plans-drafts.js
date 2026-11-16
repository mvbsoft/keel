'use strict';
// The feature folders lib/plans.js works on (called drafts in the code: a feature is planned in them
// and stays in them): the folders that hold them, one read (plan.md and its tickets), the review and
// ready hashes, every write into one, and plans.js list and find.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { read, frontmatter, clean } = require('./repo-read.js');
const { linkOnWay, safeLocalPath } = require('./safe-path.js');
const { dateOf } = require('./tasks.js');
const { base, badFolder, settings } = require('./plans-settings.js');
const { sectionsOutsideFences } = require('./plans-format.js');
const { mainOf } = require('./project-dir.js');

const PLAN_FILE = 'plan.md';
// The states of a plan and of a ticket alike: the `status` field is their only source.
const STATES = ['draft', 'ready', 'in-progress', 'done', 'abandoned'];
const CLOSED = ['done', 'abandoned'];
// The sections whose change needs a new review; the others (a ticket's In plain words, Example, Why,
// Where to look; a plan's In plain words, Terms, What was gathered, Open questions, Tickets, Next
// action) only describe.
const TICKET_ESSENTIAL = ['Goal', 'Acceptance criteria', 'How to check', 'Boundaries', 'Correct the priors', 'Out of scope', 'Dependencies'];
const PLAN_ESSENTIAL = ['Level', 'Decisions', 'Contract', 'Out of scope', 'Design sketch'];
// 2-4 English words joined by hyphens, starting with a letter; a word never starts with a digit, else
// part of the name reads as a tracker key (add-2fa -> ADD-2).
const FEATURE = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*){1,3}$/;
const FEATURE_MAX = 40;
const TICKET_FILE = /^T(\d+)-[a-z0-9-]+\.md$/;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
const given = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '-';
const oneLine = (v) => String(v).replace(/\s+/g, ' ').trim();

// --- the features ---

const validFeature = (name) => typeof name === 'string' && name.length <= FEATURE_MAX && FEATURE.test(name);
const FEATURE_RULE = '2-4 English words joined by hyphens, [a-z0-9-], at most 40 characters, starting with a letter, no digit right after a hyphen (add-2fa reads as the key ADD-2)';

// The folders that may hold features: this machine's first, then the repository's tickets_dir.
function draftDirs(root) {
  const dir = settings(root).tickets_dir;
  return [{ dir: base(root), local: true }, ...(badFolder(root, dir) ? [] : [{ dir: path.join(root, dir), local: false }])];
}

// One feature: its folder, plan.md text and front matter. Links are skipped: a feature folder is
// always a real folder.
function draftAt(folder, local) {
  const text = read(path.join(folder, PLAN_FILE));
  if (text === null) return null;
  const fm = frontmatter(text);
  // A hand-made plan.md may quote its values ("draft").
  for (const k of ['type', 'status']) if (typeof fm[k] === 'string') fm[k] = fm[k].replace(/^(["'])(.*)\1$/, '$2');
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

// The feature named `feature`, or { why } for the refusal.
function needDraft(root, feature, what) {
  if (!validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}": ${FEATURE_RULE}`) };
  const found = listDrafts(root).filter((d) => d.feature === feature);
  if (!found.length) return { why: refuse(what, `no feature "${feature}" (plans.js list shows them)`) };
  if (found.length > 1) return { why: refuse(what, `two features "${feature}": ${found.map((d) => `${rel(root, d.folder)}/`).join(' and ')}; keep one`) };
  return { d: found[0] };
}

// The feature's tickets, by T-number. A file whose name is not T<n>-<slug>.md is not a ticket.
function tickets(d) {
  let names = [];
  try { names = fs.readdirSync(path.join(d.folder, 'tickets'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { /* none */ }
  return names.map((name) => TICKET_FILE.exec(name)).filter(Boolean)
    .map((m) => { const file = path.join(d.folder, 'tickets', m[0]); const text = read(file) || ''; return { id: `T${Number(m[1])}`, n: Number(m[1]), name: m[0], file, text, fm: frontmatter(text) }; })
    .sort((a, b) => a.n - b.n);
}

// depends_on as written (`T1, T4`, empty for none); brackets are read too.
const ticketIds = (value) => String(value || '').replace(/[[\]]/g, '').split(/[\s,;]+/).filter((x) => x && x !== '-');

// Open questions: the Q<n> items of "Open questions" (an answered one moves to Decisions).
function openQuestions(text) {
  const sec = sectionsOutsideFences(text)['Open questions'] || '';
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

// The essential sections of a text, in the given order, as one string: no front matter field (status,
// branch, reason, tracker, tracker_url, the hashes, page) and no descriptive section counts.
const essentials = (text, names) => {
  const secs = sectionsOutsideFences(lf(text));
  return names.filter((n) => n in secs).map((n) => `## ${n}\n${secs[n]}`).join('\n');
};
// A ticket's review hash: its essential sections and depends_on.
const ticketHash = (text) => sha(`${essentials(text, TICKET_ESSENTIAL)}\ndepends_on: ${ticketIds(frontmatter(text).depends_on).join(', ')}`);
// A plan's ready hash: its essential sections.
const planHash = (text) => sha(essentials(text, PLAN_ESSENTIAL));
// "Needs review": never reviewed, or an essential part changed since. It never changes the status.
const needsReview = (t) => !given(t.fm.review_hash) || t.fm.review_hash !== ticketHash(t.text);
// A plan past draft whose essential sections changed since it became ready.
const planNeedsReview = (d) => d.fm.status !== 'draft' && (!given(d.fm.ready_hash) || d.fm.ready_hash !== planHash(d.text));
// The code of a feature's page: 8 random hex digits, written once and kept with the feature.
const pageCode = () => crypto.randomBytes(4).toString('hex');
const PAGE_CODE = /^[0-9a-f]{8}$/;

// The text with its front matter fields set (an empty value as `key:`), a field set to null removed;
// null when the text has no front matter.
function setFields(text, updates) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) return null;
  const lines = m[2].split(/\r?\n/);
  for (const [key, value] of Object.entries(updates)) {
    const at = lines.findIndex((l) => l.includes(':') && l.slice(0, l.indexOf(':')).trim() === key);
    if (value === null) { if (at >= 0) lines.splice(at, 1); continue; }
    const line = oneLine(value) ? `${key}: ${oneLine(value)}` : `${key}:`;
    if (at >= 0) lines[at] = line; else lines.push(line);
  }
  return m[1] + lines.join('\n') + m[3] + text.slice(m[0].length);
}

// Writes plan.md's front matter fields; returns the updated feature.
function writePlan(root, d, updates) {
  const text = setFields(d.text, updates);
  if (text === null) throw new Error(`${rel(root, path.join(d.folder, PLAN_FILE))} has no front matter`);
  writeFile(root, d, path.join(d.folder, PLAN_FILE), text);
  return { ...d, text, fm: frontmatter(text) };
}

// Writes a ticket's front matter fields (setFields); returns the updated ticket.
function writeTicket(root, d, t, updates) {
  const text = setFields(t.text, updates);
  if (text === null) throw new Error(`${t.name} has no front matter`);
  writeFile(root, d, t.file, text);
  return { ...t, text, fm: frontmatter(text) };
}

// Every write into a feature folder: under .keel/local through safeLocalPath, in the repository with
// no link on the way.
function writeFile(root, d, file, text) {
  if (d.local) {
    const home = mainOf(root);
    const target = safeLocalPath(home, ...path.relative(path.join(home, '.keel', 'local'), file).split(path.sep));
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
  const note = planNeedsReview(d) ? ' (needs review)' : '';
  return `- ${d.feature}: ${d.fm.status}${note} · open Q ${openQuestions(d.text)} · tickets ${tickets(d).length} · changed ${lastChange(d.folder)} · ${where(root, d)}`;
}

function draftList(root) {
  const drafts = listDrafts(root);
  return [`features: ${drafts.length}`, ...drafts.map((d) => draftLine(root, d))];
}

// Words of a request ("continue planning the S3 connection") against folder names and In plain words.
// Words shorter than 3 letters are left out unless they hold a digit (s3); a word of 5 letters or more
// matches by its first 5 (connect ~ connection, підключення ~ підключенням).
const words = (text) => (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3 || (w.length === 2 && /\d/.test(w)));
const stem = (w) => (w.length >= 5 ? w.slice(0, 5) : w);

function draftFind(root, query) {
  const asked = [...new Set(words(query).map(stem))];
  if (!asked.length) return refuse('find', 'needs words');
  const drafts = listDrafts(root);
  const scored = drafts.map((d) => {
    const have = new Set([...words(d.feature.replace(/-/g, ' ')), ...words(sectionsOutsideFences(d.text)['In plain words'] || '')].map(stem));
    return { d, score: asked.filter((w) => have.has(w)).length };
  });
  const top = Math.max(0, ...scored.map((s) => s.score));
  const best = top ? scored.filter((s) => s.score === top).map((s) => s.d) : [];
  if (best.length === 1) return ['find: 1 match', draftLine(root, best[0])];
  if (best.length > 1) return [`find: ${best.length} matches`, ...best.map((d) => draftLine(root, d))];
  return [`find: no match (all features: ${drafts.length})`, ...drafts.map((d) => draftLine(root, d))];
}

module.exports = {
  PLAN_FILE, STATES, CLOSED, TICKET_FILE, FEATURE_RULE, validFeature, draftDirs, listDrafts, needDraft,
  tickets, ticketIds, openQuestions, ticketHash, planHash, needsReview, planNeedsReview, pageCode, PAGE_CODE,
  setFields, writePlan, writeTicket, writeFile, where, draftList, draftFind,
};
