'use strict';
// Page files of the usage dashboard: data/<pc>-<YYYY-MM>.json and data/index.json (format: schemas/usage-day.schema.json,
// $defs month and index). A machine never reads another machine's month files: calibration takes their recent hours
// and snapshots from the index.
const crypto = require('node:crypto');
const { dedupeSnapshots } = require('./limits.js');

const FILE_SCHEMA = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
// Days of hours and snapshots a machine keeps in its index entry; usage.js calibrates over the same window.
const RECENT_DAYS = 35;
const MONTH = /^\d{4}-\d{2}$/;
const PC = /^[A-Za-z0-9_-]+$/;

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
// The text that is published and hashed; the page's sha256 of the file is the sha256 of exactly these bytes.
const serialize = (file) => JSON.stringify(file);
const fileName = (pc, month) => `${pc}-${month}.json`;
const dayStart = (date) => Date.parse(`${date}T00:00:00Z`);
const byStart = (a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const mergeSnapshots = (a = [], b = []) => dedupeSnapshots([...a, ...b]);

// One day as it is in a month file (`old`, may be null) and as this sync rebuilt it from the local sessions.
// The rebuilt hours replace the old ones whole, so a session whose wallet changed is not counted twice. When a
// session the old hours counted is missing from the rebuild (its transcript and cache are gone), the old hours stay:
// they are the only record of it.
// shortcut: in that case the hours of sessions new to the day are not added; redo with per-session hours if it shows up.
function mergeDay(old, rebuilt) {
  if (!old) return rebuilt;
  const have = new Set(rebuilt.contrib);
  const lost = (old.contrib || []).some((id) => !have.has(id));
  const sessions = new Map((old.sessions || []).map((s) => [s.id, s]));
  for (const s of rebuilt.sessions) sessions.set(s.id, s);
  return {
    date: rebuilt.date,
    synced_until: rebuilt.synced_until,
    contrib: lost ? old.contrib : rebuilt.contrib,
    hours: lost ? old.hours : rebuilt.hours,
    snapshots: mergeSnapshots(old.snapshots, rebuilt.snapshots),
    sessions: [...sessions.values()].sort(byStart),
  };
}

const monthFile = (pc, month, days) => ({ schema: FILE_SCHEMA, kind: 'month', pc, month, days });

// Rebuilt days (buildDays with `files: true`) merged into this machine's month files.
// existing: {"YYYY-MM": month file} as the caller has them, after applyCleared. Returns only the months the
// rebuilt days touch: {"YYYY-MM": month file}, days sorted by date.
function monthFiles(pc, rebuilt, existing = {}) {
  const out = {};
  for (const day of rebuilt) {
    const month = day.date.slice(0, 7);
    if (!out[month]) {
      const base = existing[month];
      out[month] = monthFile(pc, month, base ? [...base.days] : []);
    }
    const days = out[month].days;
    const i = days.findIndex((d) => d.date === day.date);
    if (i < 0) days.push(day);
    else days[i] = mergeDay(days[i], day);
  }
  for (const f of Object.values(out)) f.days.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// Leaves out of a month file everything from before `clearedAt` (/keel:usage-clear): whole days before it, and on
// the day of the clear the hours that started before it (the hour of the clear too, so nothing from before it
// stays), snapshots taken and sessions started before it. That day's `contrib` is emptied: the sessions it named may
// have had only requests before the clear, and the next rebuild (which counts from the clear) must replace its hours.
function applyCleared(file, clearedAt) {
  const from = Date.parse(clearedAt);
  if (!file || !Number.isFinite(from)) return file;
  const days = [];
  for (const d of file.days) {
    if (dayStart(d.date) + DAY_MS <= from) continue;
    if (dayStart(d.date) >= from) { days.push(d); continue; }
    const kept = {
      ...d,
      contrib: [],
      hours: d.hours.filter((h) => Date.parse(h.h) >= from),
      snapshots: d.snapshots.filter((s) => Date.parse(s.t) >= from),
      sessions: d.sessions.filter((s) => s.start && Date.parse(s.start) >= from),
    };
    if (kept.hours.length || kept.snapshots.length || kept.sessions.length) days.push(kept);
  }
  return { ...file, days };
}

function recentOf(files, sinceMs) {
  const hours = [];
  let snapshots = [];
  for (const f of files) {
    for (const d of f.days) {
      if (dayStart(d.date) + DAY_MS <= sinceMs) continue;
      for (const h of d.hours) if (Date.parse(h.h) >= sinceMs) hours.push({ h: h.h, wallet: h.wallet, usd: h.usd, by_model: h.by_model });
      snapshots = mergeSnapshots(snapshots, d.snapshots.filter((s) => Date.parse(s.t) >= sinceMs));
    }
  }
  hours.sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.wallet < b.wallet ? -1 : 1));
  return { hours, snapshots };
}

// This machine's entry in data/index.json. months: {"YYYY-MM": sha256} of the month files this sync publishes;
// the months of `prev` (the entry on the page) that it does not publish keep their sha.
function indexEntry(prev, { machine, installId, nowIso, syncedUntil, calib = null, recent, months = {} }) {
  return {
    name: String(machine.pc),
    user: machine.user || null,
    wallet_default: machine.wallet_default,
    install_id: installId,
    synced_until: syncedUntil,
    last_seen: nowIso,
    calib,
    recent,
    months: { ...((prev && prev.months) || {}), ...months },
  };
}

// Whose is the machine name `pc` on the page: 'free' (no entry), 'mine' (same install id), 'taken' (another
// install id: a second machine with the same name), 'ask' (an entry, but this machine has no install id yet, so
// it may be this machine before a reinstall or another one; only the user knows).
function nameOwner(index, pc, installId) {
  // Own keys only: a machine named "constructor" must not find Object's inherited member.
  const entry = index && index.pcs && Object.hasOwn(index.pcs, pc) ? index.pcs[pc] : null;
  if (!entry) return 'free';
  if (!installId) return 'ask';
  return entry.install_id === installId ? 'mine' : 'taken';
}

// Months to read from the page first and merge into as the base. localShas: {"YYYY-MM": sha256 of the local file}.
function toRecover(entry, localShas = {}) {
  const months = (entry && entry.months) || {};
  return Object.keys(months).filter((m) => months[m] !== localShas[m]).sort();
}

// By content, because the client picks the names of saved page files.
function identify(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== FILE_SCHEMA) return null;
  if (value.kind === 'month' && typeof value.pc === 'string' && PC.test(value.pc) && typeof value.month === 'string' && MONTH.test(value.month) && Array.isArray(value.days)) {
    return { kind: 'month', pc: value.pc, month: value.month };
  }
  if (value.kind === 'index' && value.pcs && typeof value.pcs === 'object' && !Array.isArray(value.pcs)) return { kind: 'index' };
  return null;
}

module.exports = {
  FILE_SCHEMA, RECENT_DAYS, sha256, serialize, fileName, mergeDay, monthFiles, applyCleared, recentOf, indexEntry,
  nameOwner, toRecover, identify,
};
