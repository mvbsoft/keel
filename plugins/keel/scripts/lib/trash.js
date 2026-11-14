'use strict';
// keel's trash: .keel/local/trash/<batch>/ holds what cleanup or migration moved away, under its
// original relative path, plus manifest.json. Nothing is deleted except by emptyTrash. For a linked
// worktree it is the main checkout's trash (lib/project-dir.js): a worktree is deleted with its
// conversation and its trash would go with it, so an item from a worktree records that folder (root).
const fs = require('node:fs');
const path = require('node:path');
const { sizeOf } = require('./files.js');
const { checkConfig } = require('./config.js');
const { unsafeRel, localLink, linkOnWay, safeLocalPath, samePath, realPath } = require('./safe-path.js');
const { mainOf } = require('./project-dir.js');

const trashDir = (root) => path.join(mainOf(root), '.keel', 'local', 'trash');
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
function newBatch(home, now) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  fs.mkdirSync(safeLocalPath(home, 'trash'), { recursive: true });
  for (let n = 1; ; n++) {
    const name = n === 1 ? stamp : `${stamp}-${n}`;
    try { fs.mkdirSync(path.join(trashDir(home), name)); return name; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
}

// Where an item named relative to `root` comes from: { rel, from }. From a worktree, a file of this
// machine's stores in the main checkout is named ../.keel/local/...: it belongs to the main checkout.
function source(root, home, rel) {
  if (typeof rel === 'string' && !samePath(path.resolve(root), path.resolve(home))) {
    const full = path.resolve(root, rel);
    const r = path.relative(path.join(home, '.keel', 'local'), full);
    if (r && !r.startsWith('..') && !path.isAbsolute(r)) return { rel: path.relative(home, full).split(path.sep).join('/'), from: home };
  }
  return { rel, from: root };
}

// The folder an item goes back to: the main checkout, or the linked worktree of it the item came from;
// { why } for a folder that is gone or is not this project's.
function ownerOf(home, root) {
  if (root === undefined) return { at: home };
  const foreign = { why: 'refused: not a folder of this project' };
  if (typeof root !== 'string' || !path.isAbsolute(root)) return foreign;
  if (!fs.existsSync(root)) return { why: `the worktree it came from is gone (${root})` };
  try { return samePath(realPath(mainOf(root)), realPath(home)) ? { at: root } : foreign; } catch { return foreign; }
}

// Whether an item came from the folder `root` keel runs in: the worktree it records, or, with none, the
// main checkout. An item of this machine's stores in the main checkout (.keel/local/..., but not its own
// temporary files in .keel/local/tmp/) belongs to every folder of the project.
function fromHere(root, item) {
  const real = (p) => { try { return realPath(p); } catch { return path.resolve(p); } };
  if (item.root !== undefined) return typeof item.root === 'string' && path.isAbsolute(item.root) && samePath(real(item.root), real(root));
  const p = String(item.path);
  return samePath(real(root), real(mainOf(root))) || (p.startsWith('.keel/local/') && !p.startsWith('.keel/local/tmp/'));
}

// Moves project-relative paths into a new batch, or into `into` when that batch exists (one migration
// run keeps one batch). `by`: cleanup | migration | task; `meta`: per-path extra fields kept in the
// manifest. Returns { batch, moved, failed }.
function moveToTrash(root, rels, by, meta = {}, now = new Date(), into = null) {
  const home = mainOf(root);
  const linked = localLink(home) || localLink(root);
  if (linked) return { batch: null, moved: [], failed: rels.map((rel) => ({ path: rel, reason: `${linked}: keel does not write through it` })) };
  const failed = [];
  const safe = [];
  for (const named of rels) {
    const s = source(root, home, named);
    const why = unsafeRel(s.from, s.rel);
    if (why) failed.push({ path: named, reason: why });
    else safe.push({ ...s, named });
  }
  if (!safe.length) return { batch: null, moved: [], failed };
  let earlier = null;
  let batch;
  try {
    earlier = into && !linkOnWay(home, path.join(trashDir(home), into, 'manifest.json')) ? readManifest(path.join(trashDir(home), into)) : null;
    batch = earlier && Array.isArray(earlier.items) ? into : newBatch(home, now);
  } catch (e) {
    return { batch: null, moved: [], failed: [...failed, ...safe.map((s) => ({ path: s.named, reason: e.message }))] };
  }
  const dir = path.join(trashDir(home), batch);
  const moved = [];
  for (const { rel, from: at, named } of safe) {
    const from = path.join(at, rel);
    try {
      const st = fs.lstatSync(from);
      const { bytes } = st.isDirectory() ? sizeOf(from) : { bytes: st.size };
      const to = noLink(home, path.join(dir, 'files', rel));
      // Items of two folders under one path would overwrite each other in the batch.
      if (fs.existsSync(to)) throw new Error('the batch holds that path already');
      // The item itself may be a link (renaming moves the link); unsafeRel checked above it.
      move(from, to);
      moved.push({ path: rel, kind: st.isDirectory() ? 'folder' : 'file', bytes, ...(meta[named] || {}), ...(at === home ? {} : { root: at }) });
    } catch (e) {
      failed.push({ path: named, reason: e.code || e.message });
    }
  }
  if (moved.length) writeManifest(home, dir, batch === into ? { ...earlier, items: [...earlier.items, ...moved] } : { batch, at: now.toISOString(), by, items: moved });
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

// Puts a batch back (when none is named, the newest that holds an item of this folder, fromHere, and only
// those items); `only` picks the items to put back, the rest stay.
// A path that exists again, or one that would leave the project (absolute, "..", .git, a link on the
// way), is left in the trash and reported, never written. The item in the batch is taken only when no
// link leads to it (the batch folder, `files/` and every folder below it are real folders, the item
// itself is not a link): a planted batch must not pull a file from elsewhere into the project.
function restore(root, batch, only = () => true) {
  const home = mainOf(root);
  const batches = listBatches(root);
  const b = batch ? batches.find((x) => x.batch === batch) : batches.filter((x) => x.items.some((i) => fromHere(root, i))).pop();
  const pick = batch ? only : (i) => only(i) && fromHere(root, i);
  if (!b) return { batch: batch || null, restored: [], kept: [], missing: true };
  const linked = localLink(home);
  if (linked) return { batch: b.batch, restored: [], kept: [], missing: false, refused: `${linked}: keel does not write through it` };
  const dir = path.join(trashDir(home), b.batch);
  const batchLink = linkOnWay(home, path.join(dir, 'manifest.json'));
  if (batchLink) return { batch: b.batch, restored: [], kept: [], missing: false, refused: `${batchLink}: keel does not write through it` };
  const restored = [];
  const kept = [];
  const left = [];
  for (const item of b.items) {
    if (!pick(item)) { left.push(item); continue; }
    const owner = ownerOf(home, item.root);
    if (owner.why) { kept.push({ ...item, reason: owner.why }); continue; }
    const into = owner.at;
    const unsafe = unsafeRel(into, item.path) || (into !== home && localLink(into));
    if (unsafe) { kept.push({ ...item, reason: `refused: ${unsafe}` }); continue; }
    const to = path.join(into, item.path);
    if (fs.existsSync(to)) { kept.push({ ...item, reason: 'something exists at that path again' }); continue; }
    try { move(noLink(home, path.join(dir, 'files', item.path)), noLink(into, to)); restored.push(item); } catch (e) { kept.push({ ...item, reason: e.code || e.message }); }
  }
  const rest = [...left, ...kept.map(({ reason, ...item }) => item)];
  if (rest.length) writeManifest(home, dir, { ...readManifest(dir), items: rest });
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
  const home = mainOf(root);
  const linked = localLink(home);
  if (linked) throw new Error(`${linked}: keel does not delete through it`);
  const hits = listBatches(root, now).filter((b) => (all === true) || (batch !== undefined && b.batch === batch) || (batch === undefined && Number.isInteger(olderThanDays) && olderThanDays >= 0 && b.age_days >= olderThanDays));
  for (const b of hits) noLink(home, path.join(trashDir(home), b.batch));
  for (const b of hits) fs.rmSync(path.join(trashDir(home), b.batch), { recursive: true, force: true });
  return hits;
}

module.exports = { maxAgeDays, trashDir, fromHere, moveToTrash, listBatches, restore, emptyChoice, emptyTrash };
