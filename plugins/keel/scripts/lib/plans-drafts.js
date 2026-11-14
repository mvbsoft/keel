'use strict';
// The planning drafts lib/plans.js works on: the folders that hold them, one draft read (plan.md and
// its tickets), its state in effect and its hashes, every write into it, and plans.js list and find.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { read, frontmatter, clean } = require('./repo-read.js');
const { linkOnWay, safeLocalPath } = require('./safe-path.js');
const { setFront, dateOf } = require('./tasks.js');
const { base, badFolder, settings } = require('./plans-settings.js');
const { sectionsOutsideFences } = require('./plans-format.js');
const { mainOf } = require('./project-dir.js');

const PLAN_FILE = 'plan.md';
const STATES = ['draft', 'ready', 'exported', 'abandoned'];
// 2-4 English words joined by hyphens, starting with a letter; a word never starts with a digit, else
// part of the name reads as a tracker key (add-2fa -> ADD-2).
const FEATURE = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*){1,3}$/;
const FEATURE_MAX = 40;
const TICKET_FILE = /^T(\d+)-[a-z0-9-]+\.md$/;

const refuse = (what, why) => [`plans: ${what} refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');
const lf = (text) => String(text).replace(/\r\n/g, '\n');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);

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

// The draft named `feature`, or { why } for the refusal.
function needDraft(root, feature, what) {
  if (!validFeature(feature)) return { why: refuse(what, `invalid feature name "${clean(String(feature))}": ${FEATURE_RULE}`) };
  const found = listDrafts(root).filter((d) => d.feature === feature);
  if (!found.length) return { why: refuse(what, `no draft "${feature}" (plans.js list shows the drafts)`) };
  if (found.length > 1) return { why: refuse(what, `two drafts "${feature}": ${found.map((d) => `${rel(root, d.folder)}/`).join(' and ')}; keep one`) };
  return { d: found[0] };
}

// Whether a command edits the exported feature instead of a draft: no draft of that name here, or an
// exported one.
const reopens = (root, feature, d) => (d ? stateOf(d) === 'exported' : validFeature(feature) && !listDrafts(root).some((x) => x.feature === feature));

// The exported feature's tickets in the working tree (lib/plans-export.js) when the command edits it,
// or null.
const exportedHere = (root, feature, d) => (reopens(root, feature, d) ? require('./plans-export.js').featureFolder(root, feature) : null);

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

// A ticket's review hash: its text without the review_hash line.
const frontOnly = (text, re) => lf(text).replace(/^---\n[\s\S]*?\n---/, (fm) => fm.replace(re, ''));
const ticketHash = (text) => sha(frontOnly(text, /^review_hash:.*\n?/gm).trimEnd());
// The code of a feature's page: 8 random hex digits, written once and kept with the feature.
const pageCode = () => crypto.randomBytes(4).toString('hex');
const PAGE_CODE = /^[0-9a-f]{8}$/;

// The whole draft but its state: plan.md without status, ready_hash and the page's code, and every
// ticket. reviews/ records decisions and does not count.
function draftHash(d) {
  const plan = frontOnly(d.text, /^(status|ready_hash|page):.*\n?/gm);
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
  const state = stateOf(d);
  const note = editedAfterReady(d) ? ' (changed after ready)' : '';
  return `- ${d.feature}: ${state}${note} · open Q ${openQuestions(d.text)} · tickets ${tickets(d).length} · changed ${lastChange(d.folder)} · ${where(root, d)}`;
}

function draftList(root) {
  const drafts = listDrafts(root);
  return [`drafts: ${drafts.length}`, ...drafts.map((d) => draftLine(root, d))];
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
  return [`find: no match (all drafts: ${drafts.length})`, ...drafts.map((d) => draftLine(root, d))];
}

module.exports = {
  PLAN_FILE, STATES, TICKET_FILE, FEATURE_RULE, validFeature, draftDirs, listDrafts, needDraft,
  reopens, exportedHere, tickets, ticketIds, openQuestions, ticketHash, pageCode, PAGE_CODE, draftHash,
  stateOf, writePlan, settle, writeFile, where, draftList, draftFind,
};
