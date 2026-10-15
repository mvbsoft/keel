'use strict';
// keel's trash: .keel/local/trash/<batch>/ holds what cleanup or migration moved away, under its
// original relative path, plus manifest.json. Nothing is deleted except by emptyTrash.
const fs = require('node:fs');
const path = require('node:path');
const { sizeOf } = require('./files.js');
const { checkConfig } = require('./config.js');
const { unsafeRel, localLink, linkOnWay, safeLocalPath } = require('./safe-path.js');

const trashDir = (root) => path.join(root, '.keel', 'local', 'trash');
const DAY = 24 * 60 * 60 * 1000;

// Days a batch stays before empty-trash removes it by default (config `cleanup.trash_max_age_days`).
function maxAgeDays(root) {
  const { state, config } = checkConfig(root);
  return (state === 'ok' || state === 'outdated') && config.cleanup ? config.cleanup.trash_max_age_days : 30;
}

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; }
}

// Every path keel writes, moves or removes in the trash: a link anywhere from the project down to it,
// the path itself included, is refused (a planted batch could hold `files/home` -> another folder).
function noLink(root, file) {
  const why = linkOnWay(root, file);
  if (why) throw new Error(`refused: ${why}`);
  return file;
}

function writeManifest(root, dir, manifest) {
  fs.writeFileSync(noLink(root, path.join(dir, 'manifest.json')), JSON.stringify(manifest, null, 2) + '\n');
}

// rename, or copy and remove when the trash is on another device.
function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// Batch names use local time, so the date matches the user's calendar: 20261011-143005. Making the
// folder is the claim, so two runs in the same second never share a batch.
function newBatch(root, now) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  fs.mkdirSync(safeLocalPath(root, 'trash'), { recursive: true });
  for (let n = 1; ; n++) {
    const name = n === 1 ? stamp : `${stamp}-${n}`;
    try { fs.mkdirSync(path.join(trashDir(root), name)); return name; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// Moves project-relative paths into a new batch, or into `into` when that batch exists (one migration
// run keeps one batch). `by`: cleanup | migration | task; `meta`: per-path extra fields kept in the
// manifest. Returns { batch, moved, failed }.
function moveToTrash(root, rels, by, meta = {}, now = new Date(), into = null) {
  const linked = localLink(root);
  if (linked) return { batch: null, moved: [], failed: rels.map((rel) => ({ path: rel, reason: `${linked}: keel does not write through it` })) };
  const failed = [];
  const safe = rels.filter((rel) => {
    const why = unsafeRel(root, rel);
    if (why) failed.push({ path: rel, reason: why });
    return !why;
  });
  if (!safe.length) return { batch: null, moved: [], failed };
  let earlier = null;
  let batch;
  try {
    earlier = into && !linkOnWay(root, path.join(trashDir(root), into, 'manifest.json')) ? readManifest(path.join(trashDir(root), into)) : null;
    batch = earlier && Array.isArray(earlier.items) ? into : newBatch(root, now);
  } catch (e) {
    return { batch: null, moved: [], failed: [...failed, ...safe.map((rel) => ({ path: rel, reason: e.message }))] };
  }
  const dir = path.join(trashDir(root), batch);
  const moved = [];
  for (const rel of safe) {
    const from = path.join(root, rel);
    try {
      const st = fs.lstatSync(from);
      const { bytes } = st.isDirectory() ? sizeOf(from) : { bytes: st.size };
      // The item itself may be a link (renaming moves the link); unsafeRel checked above it.
      move(from, noLink(root, path.join(dir, 'files', rel)));
      moved.push({ path: rel, kind: st.isDirectory() ? 'folder' : 'file', bytes, ...(meta[rel] || {}) });
    } catch (e) {
      failed.push({ path: rel, reason: e.code || e.message });
    }
  }
  if (moved.length) writeManifest(root, dir, batch === into ? { ...earlier, items: [...earlier.items, ...moved] } : { batch, at: now.toISOString(), by, items: moved });
  else if (batch !== into) fs.rmSync(dir, { recursive: true, force: true });
  return { batch: moved.length ? batch : null, moved, failed };
}

// The batches, oldest first. A manifest that is unreadable or has no list of items is skipped.
function listBatches(root, now = new Date()) {
  let names = [];
  try { names = fs.readdirSync(trashDir(root)); } catch { return []; }
  return names.sort().map((name) => {
    const m = readManifest(path.join(trashDir(root), name));
    if (!m || !Array.isArray(m.items)) return null;
    const items = m.items.filter((i) => i && typeof i === 'object');
    const at = new Date(m.at);
    return { batch: name, at: m.at, by: m.by, age_days: Math.floor((now - at) / DAY), items, bytes: items.reduce((n, i) => n + (Number(i.bytes) || 0), 0) };
  }).filter(Boolean);
}

// Puts a batch back (the newest when none is named); `only` picks the items to put back, the rest stay.
// A path that exists again, or one that would leave the project (absolute, "..", .git, a link on the
// way), is left in the trash and reported, never written. The item in the batch is taken only when no
// link leads to it (the batch folder, `files/` and every folder below it are real folders, the item
// itself is not a link): a planted batch must not pull a file from elsewhere into the project.
function restore(root, batch, only = () => true) {
  const batches = listBatches(root);
  const b = batch ? batches.find((x) => x.batch === batch) : batches[batches.length - 1];
  if (!b) return { batch: batch || null, restored: [], kept: [], missing: true };
  const linked = localLink(root);
  if (linked) return { batch: b.batch, restored: [], kept: [], missing: false, refused: `${linked}: keel does not write through it` };
  const dir = path.join(trashDir(root), b.batch);
  const batchLink = linkOnWay(root, path.join(dir, 'manifest.json'));
  if (batchLink) return { batch: b.batch, restored: [], kept: [], missing: false, refused: `${batchLink}: keel does not write through it` };
  const restored = [];
  const kept = [];
  const left = [];
  for (const item of b.items) {
    if (!only(item)) { left.push(item); continue; }
    const unsafe = unsafeRel(root, item.path);
    if (unsafe) { kept.push({ ...item, reason: `refused: ${unsafe}` }); continue; }
    const to = path.join(root, item.path);
    if (fs.existsSync(to)) { kept.push({ ...item, reason: 'something exists at that path again' }); continue; }
    try { move(noLink(root, path.join(dir, 'files', item.path)), noLink(root, to)); restored.push(item); } catch (e) { kept.push({ ...item, reason: e.code || e.message }); }
  }
  const rest = [...left, ...kept.map(({ reason, ...item }) => item)];
  if (rest.length) writeManifest(root, dir, { ...readManifest(dir), items: rest });
  else fs.rmSync(dir, { recursive: true, force: true });
  return { batch: b.batch, restored, kept, missing: false };
}

// What `cleanup.js empty-trash` deletes for its options: { all } | { batch } | { olderThanDays }, or
// { error }. The hook's confirmation (hooks/own-files.js) names exactly this.
function emptyChoice(opts, defaultDays) {
  const named = ['all', 'batch', 'older-than'].filter((k) => opts[k] !== undefined);
  if (named.length > 1) return { error: 'give only one of --all, --batch, --older-than' };
  if (opts.all !== undefined) return opts.all === true ? { all: true } : { error: '--all takes no value' };
  if (opts.batch !== undefined) return typeof opts.batch === 'string' ? { batch: opts.batch } : { error: '--batch needs a batch name' };
  const days = opts['older-than'];
  if (days === undefined) return { olderThanDays: defaultDays };
  return typeof days === 'string' && /^\d{1,5}$/.test(days) ? { olderThanDays: Number(days) } : { error: '--older-than needs a whole number of days, 0 or more' };
}

// Deletes batches for good: the named one, all, or those older than `olderThanDays` (emptyChoice).
function emptyTrash(root, { batch, all, olderThanDays }, now = new Date()) {
  const linked = localLink(root);
  if (linked) throw new Error(`${linked}: keel does not delete through it`);
  const hits = listBatches(root, now).filter((b) => (all === true) || (batch !== undefined && b.batch === batch) || (batch === undefined && Number.isInteger(olderThanDays) && olderThanDays >= 0 && b.age_days >= olderThanDays));
  for (const b of hits) noLink(root, path.join(trashDir(root), b.batch));
  for (const b of hits) fs.rmSync(path.join(trashDir(root), b.batch), { recursive: true, force: true });
  return hits;
}

module.exports = { maxAgeDays, trashDir, moveToTrash, listBatches, restore, emptyChoice, emptyTrash };
