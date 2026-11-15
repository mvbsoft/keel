'use strict';
// Which documents this machine wrote to the usage page and which writes are still pending (sync-state.json in
// <usageDir>): {artifact_url, synced_until, docs, pending, pending_until, notes}.
const path = require('node:path');
const { readJson, writeJson, hashOf } = require('./usage-store.js');

const STATE = 'sync-state.json';

function readState(dir) {
  const s = readJson(path.join(dir, STATE));
  const ok = s && typeof s === 'object' && !Array.isArray(s);
  return {
    artifact_url: ok && typeof s.artifact_url === 'string' ? s.artifact_url : null,
    synced_until: ok && typeof s.synced_until === 'string' ? s.synced_until : null,
    docs: ok && s.docs && typeof s.docs === 'object' ? s.docs : {},
    pending: ok && s.pending && typeof s.pending === 'object' ? s.pending : {},
    pending_until: ok && typeof s.pending_until === 'string' ? s.pending_until : null,
    sessions_rule: ok && typeof s.sessions_rule === 'string' ? s.sessions_rule : null,
    pending_rule: ok && typeof s.pending_rule === 'string' ? s.pending_rule : null,
    cleared_at: ok && typeof s.cleared_at === 'string' ? s.cleared_at : null,
    // the clear time of the /keel:usage clear run in progress; `usage-clear.js done` uses it as cleared_at
    clear_pending_at: ok && typeof s.clear_pending_at === 'string' ? s.clear_pending_at : null,
    // the lines the next report says once
    notes: ok && Array.isArray(s.notes) ? s.notes.filter((n) => n && typeof n.key === 'string') : [],
    team_page_noted: ok && s.team_page_noted === true,
  };
}

// The first day this machine has sent a day document for (state.docs keys are "<date>_<pc>" or "..._p<n>").
function earliestDay(state) {
  const days = Object.keys(state.docs).map((k) => (/^(\d{4}-\d{2}-\d{2})_/.exec(k) || [])[1]).filter(Boolean).sort();
  return days.length ? days[0] : null;
}

function writeState(dir, state) {
  writeJson(path.join(dir, STATE), state);
}

// Decides which documents to write. `versions` overrides known versions ({key: n}). Replaces the pending set.
// Documents of a day that used to have more parts get an empty replacement for each part now missing.
function stage(state, built, { versions = {}, nowIso, rebuiltIds = [] } = {}) {
  const items = [...built];
  const have = new Set(built.map((d) => d.key));
  for (const base of rebuiltIds) {
    const prefix = `${base}_p`;
    const parts = built.filter((d) => d.key === base || d.key.startsWith(prefix)).length;
    for (const key of Object.keys(state.docs)) {
      if (!key.startsWith(prefix) || have.has(key) || !/^\d+$/.test(key.slice(prefix.length))) continue;
      const first = built.find((d) => d.key === base);
      if (!first) continue;
      const { hours, snapshots, sessions, ...head } = first.doc;
      const doc = { ...head, part: Number(key.slice(prefix.length)), parts, hours: [], snapshots: [], sessions: [] };
      items.push({ id: key, key, doc, hash: hashOf(doc) });
    }
  }
  const writes = [];
  const pending = {};
  for (const d of items) {
    const known = state.docs[d.key];
    if (known && known.hash === d.hash && !(d.key in versions)) continue;
    const v = d.key in versions ? versions[d.key] : known ? known.version : null;
    pending[d.key] = { hash: d.hash, if_version: v };
    writes.push({ ...d, if_version: v });
  }
  state.pending = pending;
  state.pending_until = nowIso;
  return writes;
}

// Marks pending writes as written (only those of `batch` when given). `failed` keys stay pending and synced_until
// does not move past them. A batch with a failed document wrote nothing (a batch with a pinned version is refused
// whole), so none of its documents is recorded.
function ack(state, { failed = [], batch = null } = {}) {
  const keys = Object.keys(state.pending).filter((k) => batch === null || state.pending[k].batch === batch);
  const matches = (key) => failed.some((f) => f === key || key.endsWith(`/${f}`));
  const unknown = failed.filter((f) => !keys.some((k) => k === f || k.endsWith(`/${f}`)));
  const refused = batch !== null && failed.length > unknown.length;
  let committed = 0;
  for (const key of keys) {
    if (refused || matches(key)) continue;
    const p = state.pending[key];
    state.docs[key] = { version: (p.if_version || 0) + 1, hash: p.hash };
    delete state.pending[key];
    committed++;
  }
  const left = Object.keys(state.pending);   // every key still pending, in any batch
  if (!left.length && state.pending_until) {
    state.synced_until = state.pending_until; state.pending_until = null;
    if (state.pending_rule) { state.sessions_rule = state.pending_rule; state.pending_rule = null; }
  }
  return { committed, left, unknown };
}

module.exports = { readState, writeState, earliestDay, stage, ack };
