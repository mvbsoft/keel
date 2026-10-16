'use strict';
// Storage and sync layer of the usage calculator. Turns local Claude Code transcripts into "day documents" for the
// dashboard artifact (collection `days`), keeps a per-session summary cache so a day can be rebuilt without parsing
// every transcript again, and tracks which documents were written to the artifact (sync-state.json).
// Files live in <usageDir> (~/.claude/keel, KEEL_USAGE_DIR in tests):
//   usage-cache/<session>.json   {v, mtimeMs, size, birthMs, pricesHash, withText, summary, dedup?}   parsed transcript of one session
//   usage-index.json             {<session>: {days, mtimeMs, size, first}}        which UTC days a session touches
// A resumed or forked session's transcript starts with a copy of its parent's assistant messages (same message id, same
// time). A message id is counted once across all sessions: the session with the earliest time (then the oldest file)
// owns it. `summary` is the session as its transcript says; `dedup` is the same without the messages others own.
// A session whose transcript Claude Code deleted stays in the cache, so rebuilding a day keeps its history.
//   keel-tasks.jsonl             keel fields (task, level, findings...) per session, appended by `usage.js prepare`
//   sync-state.json              {artifact_url, synced_until, docs, pending, pending_until}
// Days are UTC dates, hours are UTC hour starts. Never writes outside <usageDir>; read-only on the transcripts.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeSession } = require('./transcripts.js');
const { loadPrices, costOf } = require('./prices.js');
const { readSnapshots } = require('./limits.js');
const { usageDir: defaultUsageDir, loadMachineConfig, WALLETS } = require('./usage-config.js');
const { projectOptions } = require('./options.js');

const SCHEMA = 1;
const CACHE_VERSION = 2;           // 2: request rows carry the message id (index 8), summaries carry `first`
const MAX_DOC_BYTES = 240000;      // a bit under ArtifactData's 262 144 byte limit
const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const SAFETY_MS = 5 * 60000;       // files touched this long before the last sync are looked at again
// Which sessions a day document lists in detail: 'keel' = only sessions that ran a keel workflow command (or
// that keel recorded at an end step). The hours still count every session, for the plan-limit calibration.
const SESSIONS_RULE = 'keel';
const GHOST_KEEP_DAYS = 180;       // cached sessions without a transcript are dropped after this, unless a live session shares a day
const CACHE = 'usage-cache';
const INDEX = 'usage-index.json';
const KEEL_TASKS = 'keel-tasks.jsonl';
const STATE = 'sync-state.json';
const SESSIONS = 'sessions.jsonl';

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const bytes = (o) => Buffer.byteLength(JSON.stringify(o));
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (date) => Date.parse(`${date}T00:00:00Z`);
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line); if (v && typeof v === 'object') out.push(v); } catch { /* skip */ }
  }
  return out;
}

// Document ids and the machine key must be safe in a file name and in ArtifactData.
function sanitizePc(pc) {
  return String(pc == null ? '' : pc).replace(/[^A-Za-z0-9_-]/g, '_') || 'pc';
}

// --- sessions on disk ---

// Every main transcript under projectsRoot with a fingerprint over the main file and its subagent files:
// newest modification time and total size. A session id found twice keeps the newer copy.
function listSessions(projectsRoot) {
  const byId = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(projectsRoot, { withFileTypes: true }); } catch { return []; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path.join(projectsRoot, d.name);
    let names;
    try { names = fs.readdirSync(pdir); } catch { continue; }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(pdir, name);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      const id = name.slice(0, -6);
      let mtimeMs = st.mtimeMs;
      let size = st.size;
      const sub = path.join(pdir, id, 'subagents');
      let agents = [];
      try { agents = fs.readdirSync(sub); } catch { /* no agents */ }
      for (const a of agents) {
        if (!a.endsWith('.jsonl')) continue;
        try { const s = fs.statSync(path.join(sub, a)); mtimeMs = Math.max(mtimeMs, s.mtimeMs); size += s.size; } catch { /* vanished */ }
      }
      // creation time of the main file (the copy of a resumed session is created later); mtime where the filesystem has none
      const birthMs = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
      const prev = byId.get(id);
      if (!prev || prev.mtimeMs < mtimeMs) byId.set(id, { id, file, projDir: d.name, mtimeMs, size, birthMs });
    }
  }
  return [...byId.values()];
}

// Claude Code names a project folder after its path: every character outside [A-Za-z0-9] becomes '-'.
function projectFolderName(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

function newestSessionIn(projectsRoot, cwd) {
  const dir = path.join(projectsRoot, projectFolderName(cwd));
  const found = listSessions(projectsRoot).filter((r) => path.dirname(r.file) === dir);
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found[0] || null;
}

// --- wallet, keel fields, Claude Code's own cost ---

function readWallets(dir) {
  const map = new Map();
  for (const l of readLines(path.join(dir, SESSIONS))) {
    if (typeof l.session_id === 'string' && WALLETS.includes(l.wallet)) map.set(l.session_id, l.wallet);
  }
  return map;
}

function walletOf(id, wallets, machine) {
  if (wallets.has(id)) return wallets.get(id);
  return machine.also_api ? 'unknown' : machine.wallet_default;
}

function readKeel(dir) {
  const map = new Map();
  for (const l of readLines(path.join(dir, KEEL_TASKS))) {
    if (typeof l.session_id !== 'string') continue;
    const { session_id, ts, ...fields } = l;
    map.set(session_id, { ...(map.get(session_id) || {}), ...fields });
  }
  return map;
}

// Remembers keel fields for a session so later rebuilds keep them. Writes nothing when nothing changed.
function recordKeel(dir, info, existing, nowIso) {
  const { session_id, ...fields } = info;
  const merged = { ...(existing.get(session_id) || {}), ...fields };
  if (JSON.stringify(merged) === JSON.stringify(existing.get(session_id) || null)) return;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, KEEL_TASKS), JSON.stringify({ session_id, ts: nowIso, ...fields }) + '\n');
  existing.set(session_id, merged);
}

function costFromSnapshots(snaps) {
  const map = new Map();
  for (const s of snaps) if (typeof s.session_id === 'string' && typeof s.cost_usd === 'number') map.set(s.session_id, s.cost_usd);
  return map;
}

// --- summary cache and index ---

const pricesHashOf = (table) => sha1(JSON.stringify((table && table.models) || []));

function makeContext(opts) {
  const dir = opts.usageDir || defaultUsageDir();
  const machine = opts.machine || loadMachineConfig();
  const table = opts.prices || loadPrices();
  return {
    dir,
    machine,
    table,
    cacheDir: path.join(dir, CACHE),
    pricesHash: pricesHashOf(table),
    withText: machine.prompt_preview !== false,
    previewChars: opts.previewChars,
    index: readJson(path.join(dir, INDEX)) || {},
    cache: new Map(),       // session id -> cache file content, read once per run
    counted: new Set(),     // sessions already counted in stats
    stats: { parsed: 0, reused: 0 },
  };
}

// reqs rows: [t, model, in, cw5, cw1h, cr, out, usd, message id]
function compact(s) {
  const { requests, ...rest } = s;
  rest.reqs = (requests || []).filter((q) => q.t != null)
    .map((q) => [q.t, q.model, q.tok.in, q.tok.cw5, q.tok.cw1h, q.tok.cr, q.tok.out, q.usd, q.id || null]);
  return rest;
}

function stripText(s) {
  return { ...s, turns: s.turns.map(({ text, ...t }) => t) };
}

function daysOf(s) {
  const days = new Set();
  if (s.start) days.add(s.start.slice(0, 10));
  for (const q of s.reqs) days.add(dayOf(q[0]));
  return [...days].sort();
}

const cacheFile = (ctx, id) => path.join(ctx.cacheDir, `${safeId(id)}.json`);

function persist(ctx, id, c) {
  try { writeJson(cacheFile(ctx, id), c); } catch { /* cache is optional */ }
}

function parse(ref, ctx, skip) {
  ctx.stats.parsed++;
  return compact(summarizeSession(ref.file, {
    cost: (model, tok) => costOf(model, tok, ctx.table),
    prompts: ctx.withText,
    ...(ctx.previewChars ? { previewChars: ctx.previewChars } : {}),
    ...(skip ? { skip } : {}),
  }));
}

const viewOf = (summary, hasText, ctx) => (ctx.withText || !hasText ? summary : stripText(summary));

// Parsed summary of a session, from the cache when the transcript files are unchanged. With `skip` (message ids
// other sessions own) the session without those messages; that second version is cached beside the first.
function getSummary(ref, ctx, skip) {
  let c = ctx.cache.has(ref.id) ? ctx.cache.get(ref.id) : readJson(cacheFile(ctx, ref.id));
  const valid = c && c.v === CACHE_VERSION && c.mtimeMs === ref.mtimeMs && c.size === ref.size && c.pricesHash === ctx.pricesHash && c.summary && Array.isArray(c.summary.keel_commands) && (c.withText || !ctx.withText);
  if (!valid) {
    c = { v: CACHE_VERSION, mtimeMs: ref.mtimeMs, size: ref.size, birthMs: ref.birthMs, pricesHash: ctx.pricesHash, withText: ctx.withText, summary: parse(ref, ctx) };
    persist(ctx, ref.id, c);
  } else if (!ctx.counted.has(ref.id)) ctx.stats.reused++;
  ctx.counted.add(ref.id);
  ctx.cache.set(ref.id, c);
  if (!skip || !skip.size) return viewOf(c.summary, c.withText, ctx);
  const key = sha1([...skip].sort().join('\n'));
  if (!(c.dedup && c.dedup.key === key && (c.dedup.withText || !ctx.withText))) {
    c.dedup = { key, withText: ctx.withText, summary: parse(ref, ctx, skip) };
    persist(ctx, ref.id, c);
  }
  return viewOf(c.dedup.summary, c.dedup.withText, ctx);
}

// A session in play: its transcript's own summary (the ids it holds), where it lives and when its file was born.
function entryOf(ref, ctx) {
  const raw = getSummary(ref, ctx);
  return { id: ref.id, ref, raw, birth: ref.birthMs, c: ctx.cache.get(ref.id) };
}

// A session whose transcript is gone, from its cache file alone (null when there is none or it predates message ids).
function ghostOf(id, ctx) {
  const c = readJson(cacheFile(ctx, id));
  if (!c || c.v !== CACHE_VERSION || !c.summary || !Array.isArray(c.summary.reqs)) return null;
  ctx.cache.set(id, c);
  return { id, ref: null, raw: viewOf(c.summary, c.withText, ctx), birth: c.birthMs || 0, c };
}

// Sessions that share their first assistant message with a loaded one are its parents and copies: load them too, so
// the ids they hold can be claimed. A session the index has no first message for (not indexed yet, or an older
// index) is looked at when its file was touched after the loaded sessions began.
function addFamily(ctx, refs, entries) {
  const firsts = new Set();
  let floor = Infinity;
  for (const e of entries.values()) {
    if (e.raw.first) firsts.add(e.raw.first);
    const t = Date.parse(e.raw.start);
    if (Number.isFinite(t)) floor = Math.min(floor, t);
  }
  if (!firsts.size) return;
  for (const ref of refs.values()) {
    if (entries.has(ref.id)) continue;
    const ix = ctx.index[ref.id];
    if (ix && ix.first !== undefined && ix.mtimeMs === ref.mtimeMs && ix.size === ref.size) {
      if (ix.first && firsts.has(ix.first)) entries.set(ref.id, entryOf(ref, ctx));
    } else if (ref.mtimeMs >= floor) {
      const e = entryOf(ref, ctx);
      ctx.index[ref.id] = { days: daysOf(e.raw), mtimeMs: ref.mtimeMs, size: ref.size, first: e.raw.first || '' };
      if (e.raw.first && firsts.has(e.raw.first)) entries.set(ref.id, e);
    }
  }
  for (const [id, ix] of Object.entries(ctx.index)) {
    if (refs.has(id) || entries.has(id) || !ix.first || !firsts.has(ix.first)) continue;
    const g = ghostOf(id, ctx);
    if (g) entries.set(id, g);
  }
}

// Each message id belongs to one session: earliest time, then the oldest file, then the smaller session id.
// Returns Map id -> the session's summary without the messages others own, and records its days in the index.
function settle(ctx, entries) {
  const owner = new Map();
  for (const e of entries.values()) {
    for (const q of e.raw.reqs) {
      const mid = q[8];
      if (!mid) continue;
      const o = owner.get(mid);
      if (!o || q[0] < o.t || (q[0] === o.t && (e.birth < o.birth || (e.birth === o.birth && e.id < o.id)))) owner.set(mid, { t: q[0], birth: e.birth, id: e.id });
    }
  }
  const out = new Map();
  for (const e of entries.values()) {
    const skip = new Set();
    for (const q of e.raw.reqs) if (q[8] && owner.get(q[8]).id !== e.id) skip.add(q[8]);
    let s = e.raw;
    if (skip.size) s = e.ref ? getSummary(e.ref, ctx, skip) : viewOf(e.c.dedup ? e.c.dedup.summary : e.c.summary, e.c.withText, ctx);
    out.set(e.id, s);
    const base = e.ref ? { mtimeMs: e.ref.mtimeMs, size: e.ref.size } : ctx.index[e.id] || {};
    ctx.index[e.id] = { ...base, days: daysOf(s), first: e.raw.first || '' };
  }
  return out;
}

function saveIndex(ctx) {
  try { writeJson(path.join(ctx.dir, INDEX), ctx.index); } catch { /* optional */ }
}

// Cached sessions whose transcript is gone are kept while a live session shares a day with them (a rebuilt day needs
// them) or for GHOST_KEEP_DAYS after the file was last seen; then they and their cache files go.
function prune(ctx, refs, nowMs) {
  if (!refs.size) return;     // an unreadable projects folder must not wipe the cache
  const liveDays = new Set();
  for (const id of refs.keys()) for (const d of (ctx.index[id] || {}).days || []) liveDays.add(d);
  const keepAfter = nowMs - GHOST_KEEP_DAYS * DAY_MS;
  const drop = (id) => { delete ctx.index[id]; ctx.cache.delete(id); try { fs.rmSync(cacheFile(ctx, id), { force: true }); } catch { /* keep going */ } };
  for (const [id, ix] of Object.entries(ctx.index)) {
    if (refs.has(id) || ix.mtimeMs >= keepAfter || (ix.days || []).some((d) => liveDays.has(d))) continue;
    drop(id);
  }
  let names = [];
  try { names = fs.readdirSync(ctx.cacheDir); } catch { /* none */ }
  for (const n of names) {
    const id = n.replace(/\.json$/, '');
    if (n.endsWith('.json') && !refs.has(id) && !ctx.index[id]) drop(id);
  }
}

// --- day documents ---

function shrinkSession(sess, budget) {
  if (bytes(sess) <= budget) return sess;
  const s = { ...sess, truncated: true };
  if (s.turns.some((t) => 'text' in t)) {
    s.turns = s.turns.map(({ text, ...t }) => t);
    if (bytes(s) <= budget) return s;
  }
  if (s.turns.length) {
    s.turns = [];
    if (bytes(s) <= budget) return s;
  }
  s.participants = s.participants.map((p) => ({ ...p, tools: {} }));
  if (bytes(s) <= budget) return s;
  const ranked = [...s.participants].sort((a, b) => b.usd - a.usd);
  const keep = ranked.slice(0, 1);
  s.participants = s.participants.filter((p) => keep.includes(p));
  for (const p of ranked.slice(1)) {
    const next = [...s.participants, p];
    const trial = { ...s, participants: next };
    if (bytes(trial) > budget) break;
    s.participants = next;
  }
  return s;
}

// What leaves the machine about the task: with previews off, no task or step titles either.
function keelFor(keel, withText) {
  if (!keel || withText) return keel || null;
  const { task, steps, ...rest } = keel;
  return { ...rest, ...(task !== undefined ? { task: null } : {}), ...(Array.isArray(steps) ? { steps: steps.map((st, i) => ({ title: `step ${i + 1}`, model: st.model === undefined ? null : st.model })) } : {}) };
}

// A project can turn previews off for itself (.keel/local/options.json) while the machine sends them.
function previewIn(ctx, cwd) {
  if (!cwd) return true;
  ctx.previewByCwd = ctx.previewByCwd || new Map();
  if (!ctx.previewByCwd.has(cwd)) ctx.previewByCwd.set(cwd, projectOptions(cwd).prompt_preview !== false);
  return ctx.previewByCwd.get(cwd);
}

// Only the folder's own name goes out, never the full path (it can hold user names and client names).
const baseName = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';

function sessionDoc(sum, wallet, keel, ccCost, withText = true) {
  const parts = sum.participants.map((p) => {
    const out = { ...p, usd: r6(p.usd) };
    out.by_model = Object.fromEntries(Object.entries(p.by_model).map(([m, v]) => [m, { ...v, usd: r6(v.usd) }]));
    return out;
  });
  return {
    id: sum.id,
    project: sum.project,
    cwd: baseName(sum.cwd),
    branch: sum.gitBranch || '',
    wallet,
    entrypoint: sum.entrypoint || '',
    start: sum.start,
    end: sum.end,
    active_min: sum.active_min,
    usd: r6(sum.usd),
    cost_cc: ccCost === undefined ? null : ccCost,
    unpriced: sum.unpriced,
    keel: keelFor(keel, withText),
    participants: parts,
    turns: sum.turns.map((t) => {
      const out = { t: t.t == null ? null : new Date(t.t).toISOString() };
      if (withText && typeof t.text === 'string') out.text = t.text;
      return Object.assign(out, { usd: r6(t.usd), requests: t.requests, agents: t.agents });
    }),
  };
}

function hoursFor(date, summaries, walletFor) {
  const map = new Map();
  for (const sum of summaries) {
    const wallet = walletFor(sum.id);
    for (const q of sum.reqs) {
      if (dayOf(q[0]) !== date) continue;
      const h = Math.floor(q[0] / HOUR_MS) * HOUR_MS;
      const key = `${h}|${wallet}`;
      let e = map.get(key);
      if (!e) { e = { h: new Date(h).toISOString(), wallet, usd: 0, req: 0, tok: { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: {} }; map.set(key, e); }
      e.req++;
      e.tok.in += q[2]; e.tok.cw5 += q[3]; e.tok.cw1h += q[4]; e.tok.cr += q[5]; e.tok.out += q[6];
      if (typeof q[7] === 'number') { e.usd += q[7]; e.by_model[q[1]] = (e.by_model[q[1]] || 0) + q[7]; }
    }
  }
  const out = [...map.values()].sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.wallet < b.wallet ? -1 : 1));
  for (const e of out) {
    e.usd = r6(e.usd);
    for (const m of Object.keys(e.by_model)) e.by_model[m] = r6(e.by_model[m]);
  }
  return out;
}

// One logical day -> one or more documents: part 1 keeps hours, snapshots and as many sessions as fit.
function packDay(header, hours, snapshots, sessions, limit = MAX_DOC_BYTES) {
  const emptyHeader = { ...header, part: 1, parts: 99 };
  const headSize = bytes({ ...emptyHeader, hours: [], snapshots: [], sessions: [] });
  let snaps = snapshots;
  while (snaps.length > 1 && headSize + bytes(hours) + bytes(snaps) > limit - 2) snaps = snaps.filter((_, i) => i % 2 === 0);
  const firstBase = headSize + bytes(hours) + bytes(snaps);
  const laterBase = headSize;
  const shrunk = sessions.map((s) => shrinkSession(s, limit - laterBase - 2));
  const parts = [];
  let cur = { hours, snapshots: snaps, sessions: [] };
  let used = firstBase;
  for (const s of shrunk) {
    const size = bytes(s) + 1;
    if (used + size > limit && (cur.sessions.length || (parts.length === 0 && (hours.length || snaps.length)))) {
      parts.push(cur);
      cur = { hours: [], snapshots: [], sessions: [] };
      used = laterBase;
    }
    cur.sessions.push(s);
    used += size;
  }
  parts.push(cur);
  return parts.map((p, i) => ({
    ...header, part: i + 1, parts: parts.length, hours: p.hours, snapshots: p.snapshots, sessions: p.sessions,
  }));
}

const partId = (id, k) => (k === 1 ? id : `${id}_p${k}`);

function hashOf(doc) {
  const { synced_until, ...rest } = doc;
  return sha1(JSON.stringify(rest));
}

// Rebuilds the whole UTC days touched by sessions that changed since `sinceMs`.
// -> {docs: [{id, key, doc, hash}], days, stats, summaries}
function buildDays(opts = {}) {
  const ctx = makeContext(opts);
  const nowMs = opts.nowMs !== undefined ? opts.nowMs : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const pc = sanitizePc(ctx.machine.pc);
  const sinceMs = opts.sinceMs !== undefined ? opts.sinceMs : nowMs - 30 * DAY_MS;
  const refs = listSessions(opts.projectsRoot);
  const refsById = new Map(refs.map((r) => [r.id, r]));
  const wallets = readWallets(ctx.dir);
  const keel = readKeel(ctx.dir);
  const info = opts.keelInfo && typeof opts.keelInfo.session_id === 'string' ? opts.keelInfo : null;
  if (info) recordKeel(ctx.dir, info, keel, nowIso);
  const snapshots = readSnapshots(ctx.dir);
  const cc = costFromSnapshots(snapshots);

  const changed = refs.filter((r) => r.mtimeMs >= sinceMs || (info && r.id === info.session_id));
  const entries = new Map(changed.map((r) => [r.id, entryOf(r, ctx)]));
  addFamily(ctx, refsById, entries);
  let summaries = settle(ctx, entries);
  const days = new Set();
  for (const r of changed) for (const d of daysOf(summaries.get(r.id))) days.add(d);
  if (!days.size) {
    saveIndex(ctx);
    return { docs: [], days: [], stats: ctx.stats, summaries: new Map() };
  }
  const sorted = [...days].sort();
  const earliest = dayStart(sorted[0]);
  // Every other session that touches those days, and the cached ones whose transcript is gone.
  for (const r of refs) {
    if (entries.has(r.id) || r.mtimeMs < earliest) continue;
    const ix = ctx.index[r.id];
    if (ix && ix.mtimeMs === r.mtimeMs && ix.size === r.size && !ix.days.some((d) => days.has(d))) continue;
    entries.set(r.id, entryOf(r, ctx));
  }
  for (const [id, ix] of Object.entries(ctx.index)) {
    if (refsById.has(id) || entries.has(id) || !(ix.days || []).some((d) => days.has(d))) continue;
    const g = ghostOf(id, ctx);
    if (g) entries.set(id, g);
  }
  addFamily(ctx, refsById, entries);
  summaries = settle(ctx, entries);
  prune(ctx, refsById, nowMs);
  saveIndex(ctx);

  const walletFor = (id) => walletOf(id, wallets, ctx.machine);
  const docs = [];
  for (const date of sorted) {
    const touching = [...summaries.values()].filter((s) => ctx.index[s.id].days.includes(date));
    const own = touching.filter((s) => s.start && s.start.slice(0, 10) === date && isKeelSession(s, keel))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
      .map((s) => sessionDoc(s, walletFor(s.id), keel.get(s.id) || null, cc.get(s.id), ctx.withText && previewIn(ctx, s.cwd)));
    const header = { schema: SCHEMA, date, pc, user: ctx.machine.user || null, part: 1, parts: 1, synced_until: nowIso };
    const daySnaps = snapshots.filter((s) => typeof s.t === 'string' && s.t.slice(0, 10) === date);
    const built = packDay(header, hoursFor(date, touching, walletFor), daySnaps, own);
    const id = `${date}_${pc}`;
    built.forEach((doc, i) => docs.push({ id: partId(id, i + 1), key: partId(id, i + 1), doc, hash: hashOf(doc) }));
  }
  return { docs, days: sorted, stats: ctx.stats, summaries };
}

// A session keel worked in: one of its workflow commands was typed there, or an end step recorded it. A summary
// cached before commands were recorded (a session whose transcript is gone) counts only by that record.
const isKeelSession = (s, keel) => (Array.isArray(s.keel_commands) && s.keel_commands.length > 0) || keel.has(s.id);

// The machine document: always rewritten, because synced_until moves on.
function buildMachineDoc(machine, nowIso) {
  const pc = sanitizePc(machine.pc);
  const doc = { name: String(machine.pc), user: machine.user || null, wallet_default: machine.wallet_default, synced_until: nowIso, last_seen: nowIso };
  return { id: pc, key: `machines/${pc}`, doc, hash: sha1(JSON.stringify(doc)) };
}

// --- local requests for calibration ---

// Every local request since sinceMs as {t, wallet, model, usd, session_id}; only parses sessions not cached yet.
// A message copied into a resumed session counts once.
function localRequests(opts) {
  const ctx = makeContext(opts);
  const wallets = readWallets(ctx.dir);
  const refs = listSessions(opts.projectsRoot);
  const refsById = new Map(refs.map((r) => [r.id, r]));
  const entries = new Map();
  for (const r of refs) if (r.mtimeMs >= opts.sinceMs) entries.set(r.id, entryOf(r, ctx));
  addFamily(ctx, refsById, entries);
  const summaries = settle(ctx, entries);
  saveIndex(ctx);
  const out = [];
  for (const s of summaries.values()) {
    const wallet = walletOf(s.id, wallets, ctx.machine);
    for (const q of s.reqs) {
      if (q[0] >= opts.sinceMs && typeof q[7] === 'number') out.push({ t: new Date(q[0]).toISOString(), wallet, model: q[1], usd: q[7], session_id: s.id });
    }
  }
  return out;
}

// One session as the end-of-task report shows it, without the messages another session owns.
function sessionSummary(ref, opts = {}) {
  const ctx = makeContext(opts);
  const refsById = new Map(listSessions(opts.projectsRoot).map((r) => [r.id, r]));
  refsById.set(ref.id, ref);
  const entries = new Map([[ref.id, entryOf(ref, ctx)]]);
  addFamily(ctx, refsById, entries);
  const summary = settle(ctx, entries).get(ref.id);
  saveIndex(ctx);
  const wallets = readWallets(ctx.dir);
  const keel = readKeel(ctx.dir);
  return { summary, ctx, wallet: walletOf(ref.id, wallets, ctx.machine), keel: keel.get(ref.id) || null };
}

// --- sync state ---

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
// does not move past them.
function ack(state, { failed = [], batch = null } = {}) {
  const keys = Object.keys(state.pending).filter((k) => batch === null || state.pending[k].batch === batch);
  const matches = (key) => failed.some((f) => f === key || key.endsWith(`/${f}`));
  const unknown = failed.filter((f) => !keys.some((k) => k === f || k.endsWith(`/${f}`)));
  let committed = 0;
  for (const key of keys) {
    if (matches(key)) continue;
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

module.exports = {
  MAX_DOC_BYTES, sanitizePc, listSessions, projectFolderName, newestSessionIn, readWallets, walletOf, readKeel, readLines,
  buildDays, buildMachineDoc, localRequests, sessionSummary, readState, writeState, stage, ack, packDay, hashOf, sha1, SAFETY_MS,
  DAY_MS, readJson, dayOf, SESSIONS_RULE, earliestDay,
};
