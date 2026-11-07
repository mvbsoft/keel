'use strict';
// The usage sync through page files: this machine's month files live in <usageDir>/usage-files/ (built on every
// prepare, also with the sync off) and go to the page as data/<pc>-<YYYY-MM>.json beside the shared data/index.json.
// The page's version is the lock: a publish against an older version is refused and the sync starts again.
// sync-state.json keeps this under `files`: {built_until, published: {"YYYY-MM": sha256}, pending}.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./usage-store.js');
const pf = require('./usage-files.js');
const { safeLocalWrite } = require('./safe-path.js');

const LOCAL = 'usage-files';
const INDEX_PATH = 'data/index.json';
const pagePath = (pc, month) => `data/${pf.fileName(pc, month)}`;

function filesState(state) {
  const f = state.files || {};
  state.files = {
    built_until: typeof f.built_until === 'string' ? f.built_until : null,
    published: f.published && typeof f.published === 'object' && !Array.isArray(f.published) ? f.published : {},
    pending: f.pending && typeof f.pending === 'object' && !Array.isArray(f.pending) ? f.pending : null,
  };
  return state.files;
}

// --- this machine's month files on disk ---

const localFile = (dir, pc, month) => path.join(dir, LOCAL, pf.fileName(pc, month));

function readLocal(dir, pc) {
  const out = {};
  let names = [];
  try { names = fs.readdirSync(path.join(dir, LOCAL)); } catch { return out; }
  for (const name of names) {
    const value = store.readJson(path.join(dir, LOCAL, name));
    const id = pf.identify(value);
    if (id && id.kind === 'month' && id.pc === pc && name === pf.fileName(pc, id.month)) out[id.month] = value;
  }
  return out;
}

// Writes the month file when its text changed; an empty month is removed.
function saveLocal(dir, file, before) {
  const target = localFile(dir, file.pc, file.month);
  if (!file.days.length) { try { fs.rmSync(target, { force: true }); } catch { /* gone */ } return; }
  const text = pf.serialize(file);
  if (before && pf.serialize(before) === text) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
}

// The page's copy of a month (`base`) merged with the local one: a day in both is merged as a rebuild over the
// page's day, so sessions only the page still knows keep their hours.
function mergeMonth(base, local) {
  if (!local) return base;
  const days = new Map(base.days.map((d) => [d.date, d]));
  for (const d of local.days) days.set(d.date, days.has(d.date) ? pf.mergeDay(days.get(d.date), d) : d);
  return { ...base, days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

// The local collection: the days touched since the last build are rebuilt and merged into the month files; after
// this machine's /keel:usage-clear (`clearedAt`) only from the clear on. Returns the month files: {"YYYY-MM": file}.
function collect({ dir, machine, projectsRoot, keelInfo, nowMs, historyDays, clearedAt }, st) {
  const pc = store.sanitizePc(machine.pc);
  const fromMs = clearedAt ? Date.parse(clearedAt) : undefined;
  let sinceMs = st.built_until ? Date.parse(st.built_until) - store.SAFETY_MS : nowMs - historyDays * store.DAY_MS;
  if (fromMs) sinceMs = Math.max(sinceMs, fromMs - store.SAFETY_MS);
  const existing = readLocal(dir, pc);
  // A published month with no readable local file is no longer known here: forgetting it makes the sync read the
  // page's copy back before it publishes that month again (the rebuild below may hold only some of its days).
  for (const m of Object.keys(st.published)) if (!existing[m]) delete st.published[m];
  const built = store.buildDays({ projectsRoot, machine, usageDir: dir, sinceMs, keelInfo, nowMs, fromMs, files: true });
  const months = { ...existing, ...pf.monthFiles(pc, built.built, existing) };
  for (const [m, f] of Object.entries(months)) {
    saveLocal(dir, f, existing[m]);
    if (!f.days.length) delete months[m];
  }
  st.built_until = new Date(nowMs).toISOString();
  return months;
}

// --- the page ---

// data/index.json as read from the page, or null when the page has none yet ("none").
function readIndex(file) {
  if (file === 'none') return null;
  const value = store.readJson(file);
  if (!pf.identify(value) || pf.identify(value).kind !== 'index') throw new Error(`${file} is not the page's data/index.json`);
  return value;
}

const ownEntry = (index, pc) => (index && index.pcs && Object.hasOwn(index.pcs, pc) ? index.pcs[pc] : null);

// Month files read back from the page (any names: the client picks them), merged into the local ones as the base.
// Only this machine's months count; the page's sha of each is recorded as already taken in. A copy of this
// machine's month with a day of the wrong shape cannot be merged: it counts as read, so the local month (when
// there is one) is published over it.
function takeIn(dir, pc, takeFiles, entry, st) {
  const got = [];
  const local = readLocal(dir, pc);
  for (const file of takeFiles) {
    const value = store.readJson(file);
    const id = pf.identify(value);
    if (!id && value && value.kind === 'month' && value.pc === pc && typeof value.month === 'string' && /^\d{4}-\d{2}$/.test(value.month)) {
      got.push(value.month);
      continue;
    }
    if (!id || id.kind !== 'month' || id.pc !== pc) continue;
    const merged = mergeMonth(value, local[id.month] || null);
    saveLocal(dir, merged, local[id.month]);
    const pageSha = entry && entry.months && entry.months[id.month];
    if (pageSha) st.published[id.month] = pageSha;
    got.push(id.month);
  }
  return got;
}

// read_file takes 1-32 paths and 4 MiB of files together per call.
const READ_FILES = 32;
const READ_BYTES = 4 * 1024 * 1024;
// shortcut: a month with no local copy counts as 1 MiB (its page size is unknown before the read); redo when the
// index or get_artifact gives file sizes.
const UNKNOWN_BYTES = 1024 * 1024;

// The months one read asks for: the newest first, within read_file's limits, at least one. A month with a local
// copy is about as big as that copy; the months left are asked for by the next syncs.
function readBatch(missing, local) {
  const out = [];
  let bytes = 0;
  for (const m of [...missing].reverse()) {
    const size = local[m] ? Buffer.byteLength(pf.serialize(local[m])) : UNKNOWN_BYTES;
    if (out.length && (out.length === READ_FILES || bytes + size > READ_BYTES)) break;
    out.push(m);
    bytes += size;
  }
  return out;
}

// Major, minor and patch of two keel versions compared: > 0 when `a` is newer. A missing version is the oldest.
function compareVersions(a, b) {
  const parts = (v) => (typeof v === 'string' ? v.split('.').map((x) => parseInt(x, 10) || 0) : [-1]);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// What one files-mode prepare decides. ctx: {root, dir, machine, state, nowMs, historyDays, projectsRoot, keelInfo,
// out: {parts}, page, pageVersion, takeFiles, readRound, samePc, shared, calib, template: {now, files, dir, version},
// language: the page language when the page has none yet}.
// -> {action: 'skip', reason} | {action: 'read', paths} | {action: 'publish', base_version, files, remove}
function prepareFiles(ctx) {
  const { dir, machine, state, nowMs } = ctx;
  const st = filesState(state);
  const pc = store.sanitizePc(machine.pc);
  const nowIso = new Date(nowMs).toISOString();
  const index = readIndex(ctx.page);
  const collectCtx = { ...ctx, clearedAt: state.cleared_at };

  let installId = machine.install_id;
  const entry = ownEntry(index, pc);
  let owner = pf.nameOwner(index, pc, installId);
  if (owner === 'ask' && ctx.samePc) {
    // The user said this is the same machine before a reinstall: it takes over the id its page entry has.
    installId = entry.install_id;
    owner = 'mine';
  }
  if (owner === 'taken' || owner === 'ask') {
    collect(collectCtx, st);
    return { action: 'skip', reason: owner === 'taken' ? 'name_taken' : 'name_ask' };
  }
  const config = require('./usage-config.js');
  // Read again: another session of a new install may have written its id since this one loaded the config.
  if (!installId) installId = config.loadMachineConfig().install_id || crypto.randomUUID();
  if (installId !== machine.install_id) config.writeMachineConfig({ install_id: installId });

  const onPage = (entry && entry.months) || {};
  // Page files of this machine from before its own /keel:usage-clear hold only what the clear deleted (a clear in
  // a session without the page-file tools leaves them): they are never read back and are removed.
  const stale = !!(entry && state.cleared_at && !(Date.parse(entry.synced_until) >= Date.parse(state.cleared_at)));
  const took = stale ? [] : takeIn(dir, pc, ctx.takeFiles || [], entry, st);
  const local = collect(collectCtx, st);
  const missing = stale ? [] : pf.toRecover(entry, st.published, local).filter((m) => !took.includes(m));
  if (missing.length && !ctx.readRound) return { action: 'read', paths: readBatch(missing, local).map((m) => pagePath(pc, m)) };

  // Asked once per sync: a month the page could not give stays on the page as it is and is not published over,
  // so nothing only the page still holds is lost; the next sync asks for it again.
  const shas = Object.fromEntries(Object.entries(local).filter(([m]) => !missing.includes(m)).map(([m, f]) => [m, pf.sha256(pf.serialize(f))]));
  const kept = stale ? {} : Object.fromEntries(Object.entries(onPage).filter(([m]) => !(m in shas)));
  const changed = Object.keys(shas).filter((m) => shas[m] !== onPage[m]).sort();
  const removed = Object.keys(onPage).filter((m) => !(m in shas) && !(m in kept)).sort();
  const recent = pf.recentOf(Object.values(local), nowMs - pf.RECENT_DAYS * store.DAY_MS);
  const mine = pf.indexEntry({ machine, installId, nowIso, syncedUntil: nowIso, calib: ctx.calib || null, recent, months: { ...kept, ...shas } });

  // The page's own files follow the newest keel among the machines: an older keel leaves a newer page alone.
  const pageKeel = index && typeof index.keel_version === 'string' ? index.keel_version : null;
  const update = !index || (compareVersions(pageKeel, ctx.template.version) <= 0 && index.template !== ctx.template.now);
  const runsMine = update || index.template === ctx.template.now;
  const template = runsMine ? ctx.template.now : index.template;
  const keelVersion = runsMine ? ctx.template.version : pageKeel;
  const next = {
    schema: pf.FILE_SCHEMA,
    kind: 'index',
    language: index && typeof index.language === 'string' ? index.language : ctx.language || null,
    template,
    ...(keelVersion ? { keel_version: keelVersion } : {}),
    pcs: { ...((index && index.pcs) || {}), [pc]: mine },
  };

  const files = [];
  const put = (rel, text) => files.push({ path: rel, file: safeLocalWrite(ctx.root, [...ctx.out.parts, ...rel.split('/')], text) });
  put(INDEX_PATH, `${JSON.stringify(next)}\n`);
  for (const m of changed) put(pagePath(pc, m), pf.serialize(local[m]));
  if (update) {
    for (const name of ctx.template.files) {
      files.push({ path: name, file: safeLocalWrite(ctx.root, [...ctx.out.parts, 'page', name], fs.readFileSync(path.join(ctx.template.dir, name), 'utf8')) });
    }
  }
  st.pending = { months: Object.fromEntries(changed.map((m) => [m, shas[m]])), removed, template };
  return {
    action: 'publish', base_version: ctx.pageVersion, files, remove: removed.map((m) => pagePath(pc, m)),
    ...(ctx.shared ? { shared_live: true } : {}),
  };
}

// The publish of the last prepare went through. -> the template the page runs after it, or undefined when nothing
// was pending.
function commit(state) {
  const st = filesState(state);
  const p = st.pending;
  if (!p) return undefined;
  for (const [m, sha] of Object.entries(p.months || {})) st.published[m] = sha;
  for (const m of p.removed || []) delete st.published[m];
  st.pending = null;
  return p.template || null;
}

// Other machines of the same user (store.sameUser) in data/index.json, in loadRemote's shape (usage.js).
function remoteFromIndex(index, localPc, localUser) {
  const res = { machines: [], hours: [], snapshots: [] };
  if (!index || !index.pcs || typeof index.pcs !== 'object') return res;
  const mine = store.sameUser(localUser);
  for (const [pc, e] of Object.entries(index.pcs)) {
    if (pc === localPc || !e || typeof e !== 'object' || !mine(e.user)) continue;
    res.machines.push({ pc, synced_until: typeof e.synced_until === 'string' ? e.synced_until : null, last_seen: typeof e.last_seen === 'string' ? e.last_seen : null });
    const recent = e.recent && typeof e.recent === 'object' ? e.recent : {};
    for (const h of Array.isArray(recent.hours) ? recent.hours : []) {
      if (h && typeof h.h === 'string' && typeof h.usd === 'number') res.hours.push({ pc, h: h.h, wallet: h.wallet, usd: h.usd, by_model: h.by_model });
    }
    for (const s of Array.isArray(recent.snapshots) ? recent.snapshots : []) if (s && typeof s.t === 'string') res.snapshots.push(s);
  }
  return res;
}

module.exports = { INDEX_PATH, readLocal, saveLocal, collect, prepareFiles, commit, remoteFromIndex, readIndex, filesState, compareVersions };
