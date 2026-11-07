'use strict';
// Clearing this machine's data from the "keel usage" page (other machines' data stays): what is on it, the delete
// batches, and the local reset after the deletes. The model saves the page's documents with ArtifactData query ...
// out_dir (their content never enters the conversation); this script reads those files. A delete needs each
// document's version: this machine's documents have it in the sync state, or it comes from the query listing as
// --version <key>=<n>. The page holds its data in the database (documents), in page files, or in both; the plan
// covers what is given.
// Usage: node usage-clear.js start [--project <dir>]
//          empties and prints the folder for the query files (<project>/.keel/local/usage/clear)
//        node usage-clear.js plan [--in <dir>] [--page <saved data/index.json | none>] [--version <key>=<n>]... [--project <dir>]
//          --in: what the database holds of this machine (days, period, sessions, dollars) and the delete batches;
//          --page: this machine's page files to remove (months, dollars) and the publishes that remove them and
//          write the new index. All as JSON.
//        node usage-clear.js done
//          right after the user's yes, before the deletes and publishes: deletes this machine's local month files;
//          it sends only data from the clear on
// Exit code 0; errors print one line starting with `usage-clear: error:`.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./lib/usage-store.js');
const pf = require('./lib/usage-files.js');
const pageSync = require('./lib/usage-page-sync.js');
const { validate } = require('./lib/schema.js');
const { usageDir, loadMachineConfig } = require('./lib/usage-config.js');
const { safeLocalPath, safeLocalWrite } = require('./lib/safe-path.js');
const { parseArgs, batches, versionOverrides, underLocal, unwrap } = require('./usage.js');

// The page's data collections. `meta` (the page language) stays: it is a setting, not data.
const COLLECTIONS = ['days', 'machines', 'calib'];
const keyOf = (collection, id) => (collection === 'days' ? id : `${collection}/${id}`);
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'usage-day.schema.json'), 'utf8'));
const PUBLISH_LIMIT = 256; // files and removes together per publish_files call

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const r2 = (x) => Math.round(x * 100) / 100;

const projectRoot = (opts) => path.resolve(typeof opts.project === 'string' ? opts.project : process.env.CLAUDE_PROJECT_DIR || process.cwd());

// A fresh folder for the query files, so documents from an earlier run are never counted again, and no clear
// time left by an earlier run that was not finished.
function start(opts) {
  const root = projectRoot(opts);
  const dir = safeLocalPath(root, 'usage', 'clear');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const usage = usageDir();
  const state = store.readState(usage);
  if (state.clear_pending_at) { state.clear_pending_at = null; store.writeState(usage, state); }
  return `usage-clear: query folder ${dir}`;
}

// This machine's page files to remove and the publishes that do it: the first carries the new index (this machine's
// entry with no months and no recent data; the other machines' entries as they are), the others only removes.
// Each publish_files call takes at most PUBLISH_LIMIT files and removes together. An entry whose install id is not
// this machine's (`name: 'taken'`, or `'ask'` with none here yet) is another PC's, as in the sync: it stays.
function filesPlan(root, pageFile, pc, installId) {
  const saved = underLocal(root, pageFile);
  if (!saved) throw new Error(`${pageFile} must be a file under the project's .keel/local/`);
  const index = pageSync.readIndex(saved);
  const problems = validate(index, { ...SCHEMA.$defs.index, $defs: SCHEMA.$defs });
  if (problems.length) throw new Error(`${pageFile} does not match the index format: ${problems[0]}`);

  const owner = pf.nameOwner(index, pc, installId);
  if (owner === 'free') return { machine: null, publishes: [] };
  if (owner !== 'mine') return { machine: null, publishes: [], name: owner };
  const entry = index.pcs[pc];
  const months = Object.keys(entry.months).sort();
  const hours = (entry.recent && entry.recent.hours) || [];
  const machine = {
    name: entry.name,
    months: months.length,
    first_month: months[0] || null,
    last_month: months[months.length - 1] || null,
    last_35_days_usd: r2(hours.reduce((s, h) => s + (Number(h.usd) || 0), 0)),
  };
  const remove = months.map((m) => `data/${pf.fileName(pc, m)}`);
  const next = { ...index, pcs: { ...index.pcs, [pc]: { ...entry, months: {}, recent: { hours: [], snapshots: [] }, calib: null } } };
  const file = safeLocalWrite(root, ['usage', 'clear', 'out', 'data', 'index.json'], `${JSON.stringify(next)}\n`);

  const first = PUBLISH_LIMIT - 1;
  const publishes = [{ files: [{ path: pageSync.INDEX_PATH, file }], remove: remove.slice(0, first) }];
  for (let i = first; i < remove.length; i += PUBLISH_LIMIT) publishes.push({ remove: remove.slice(i, i + PUBLISH_LIMIT) });
  return { machine, publishes };
}

function plan(opts) {
  const hasPage = typeof opts.page === 'string' && opts.page !== 'none';
  if (typeof opts.in !== 'string' && opts.page === undefined) return 'usage-clear: error: give --in <the out_dir of the ArtifactData queries> and/or --page <the saved data/index.json | none>';
  const dir = usageDir();
  const state = store.readState(dir);
  const machine = loadMachineConfig();
  const pc = store.sanitizePc(machine.pc);
  const files = hasPage ? filesPlan(projectRoot(opts), opts.page, pc, machine.install_id) : opts.page === 'none' ? { machine: null, publishes: [] } : null;
  const result = typeof opts.in === 'string' ? databasePlan(opts, state, pc) : {};
  // The clear time `done` takes: set by the first plan of this run that succeeds (start forgot any older one), so
  // after a failed plan `done` changes nothing; a plan run again for missing versions keeps it.
  if (!state.clear_pending_at) { state.clear_pending_at = new Date().toISOString(); store.writeState(dir, state); }
  return JSON.stringify({ ...result, ...(files ? { files } : {}) });
}

// This machine's documents: its days (`pc` in the document, which the query may save wrapped), and machines/<pc>
// and calib/<pc>.
function databasePlan(opts, state, pc) {
  const given = versionOverrides(opts.version);
  const docs = [];
  for (const collection of COLLECTIONS) {
    let names = [];
    try { names = fs.readdirSync(path.join(opts.in, collection)); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      const id = name.slice(0, -5);
      const file = path.join(opts.in, collection, name);
      const doc = (collection === 'days' ? unwrap(readJson(file))[0] : readJson(file)) || {};
      if (collection === 'days' ? store.sanitizePc(doc.pc || '') !== pc : id !== pc) continue;
      const key = keyOf(collection, id);
      const known = state.docs[key] || state.pending[key];
      const version = key in given ? given[key] : known && known.version ? known.version : null;
      docs.push({ collection, id, key, version, bytes: fs.statSync(file).size, doc });
    }
  }
  const days = docs.filter((d) => d.collection === 'days');
  const dates = [...new Set(days.map((d) => d.doc.date).filter((x) => typeof x === 'string'))].sort();
  const sessions = days.flatMap((d) => (Array.isArray(d.doc.sessions) ? d.doc.sessions : []));
  const hourUsd = days.reduce((s, d) => s + (Array.isArray(d.doc.hours) ? d.doc.hours.reduce((a, h) => a + (Number(h.usd) || 0), 0) : 0), 0);
  const summary = {
    documents: docs.length,
    day_documents: days.length,
    first_day: dates[0] || null,
    last_day: dates[dates.length - 1] || null,
    days_with_data: dates.length,
    sessions: sessions.length,
    sessions_usd: r2(sessions.reduce((s, x) => s + (Number(x.usd) || 0), 0)),
    all_usd: r2(hourUsd),
    calibration_documents: docs.filter((d) => d.collection === 'calib').length,
    kilobytes: Math.round(docs.reduce((s, d) => s + d.bytes, 0) / 1024),
  };
  const missing = docs.filter((d) => !d.version).map((d) => d.key);
  const writes = docs.filter((d) => d.version).map((d) => ({ op: 'delete', collection: d.collection, doc_id: d.id, if_version: d.version, bytes: 100, key: d.key }));
  if (missing.length) return { summary, missing_versions: missing, note: 'run plan again with --version <key>=<n> for each, n from the query listing; no batch is ready before that' };
  const ready = batches(writes);
  // Each batch is one ArtifactData call in the chat, which the warning names.
  return { summary: { ...summary, delete_calls: ready.length }, batches: ready };
}

// Runs right after the user's yes, before the deletes: this machine forgets what it sent, deletes its local month
// files (the Claude Code logs stay) and sends only what happens from the clear on, so a clear cut short later does
// not send the old data again. Without a plan in this run it changes nothing, so running it twice does not move the
// clear time.
function done() {
  const dir = usageDir();
  const state = store.readState(dir);
  const at = state.clear_pending_at;
  if (!at) return 'usage-clear: nothing to finish: run start and plan first';
  Object.assign(state, {
    docs: {}, pending: {}, pending_until: null, synced_until: at, cleared_at: at, sessions_rule: store.SESSIONS_RULE, pending_rule: null,
    files: {}, clear_pending_at: null,
  });
  store.writeState(dir, state);
  const pc = store.sanitizePc(loadMachineConfig().pc);
  for (const file of Object.values(pageSync.readLocal(dir, pc))) pageSync.saveLocal(dir, { ...file, days: [] });
  return `usage-clear: this machine sends only data from ${at} on; its Claude Code logs, limit records and calibration are kept`;
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  if (pos[0] === 'start') return start(opts);
  if (pos[0] === 'plan') return plan(opts);
  if (pos[0] === 'done') return done();
  return 'usage: node usage-clear.js start [--project <dir>] | plan [--in <dir>] [--page <index.json | none>] [--version <key>=<n>]... | done';
}

if (require.main === module) {
  let out;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `usage-clear: error: ${e.message}`; }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { main };
