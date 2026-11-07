'use strict';
// Clearing this machine's data from the "keel usage" page (other machines' data stays): what is on it, the delete
// batches, and the local reset after the deletes. The model saves the page's documents with ArtifactData query ...
// out_dir (their content never enters the conversation); this script reads those files. A delete needs each
// document's version: this machine's documents have it in the sync state, or it comes from the query listing as
// --version <key>=<n>.
// Usage: node usage-clear.js start [--project <dir>]
//          empties and prints the folder for the query files (<project>/.keel/local/usage/clear)
//        node usage-clear.js plan --in <dir> [--version <key>=<n>]...
//          what the database holds of this machine (days, period, sessions, dollars) and the delete batches, as JSON
//        node usage-clear.js done
//          right after the user's yes, before the deletes: this machine sends only data from the clear on
// Exit code 0; errors print one line starting with `usage-clear: error:`.
const fs = require('node:fs');
const path = require('node:path');
const store = require('./lib/usage-store.js');
const { usageDir, loadMachineConfig } = require('./lib/usage-config.js');
const { safeLocalPath } = require('./lib/safe-path.js');
const { parseArgs, batches, versionOverrides, unwrap } = require('./usage.js');

// The page's data collections. `meta` (the page language) stays: it is a setting, not data.
const COLLECTIONS = ['days', 'machines', 'calib'];
const keyOf = (collection, id) => (collection === 'days' ? id : `${collection}/${id}`);

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

function plan(opts) {
  if (typeof opts.in !== 'string') return 'usage-clear: error: give --in <the out_dir of the ArtifactData queries>';
  const dir = usageDir();
  const state = store.readState(dir);
  const pc = store.sanitizePc(loadMachineConfig().pc);
  const result = databasePlan(opts, state, pc);
  // The clear time `done` takes: set by the first plan of this run that succeeds (start forgot any older one), so
  // after a failed plan `done` changes nothing; a plan run again for missing versions keeps it.
  if (!state.clear_pending_at) { state.clear_pending_at = new Date().toISOString(); store.writeState(dir, state); }
  return JSON.stringify(result);
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

// Runs right after the user's yes, before the deletes: this machine forgets what it sent and sends only what
// happens from the clear on (the Claude Code logs stay), so a clear cut short later does
// not send the old data again. Without a plan in this run it changes nothing, so running it twice does not move the
// clear time.
function done() {
  const dir = usageDir();
  const state = store.readState(dir);
  const at = state.clear_pending_at;
  if (!at) return 'usage-clear: nothing to finish: run start and plan first';
  Object.assign(state, {
    docs: {}, pending: {}, pending_until: null, synced_until: at, cleared_at: at, sessions_rule: store.SESSIONS_RULE, pending_rule: null,
    clear_pending_at: null,
  });
  store.writeState(dir, state);
  return `usage-clear: this machine sends only data from ${at} on; its Claude Code logs, limit records and calibration are kept`;
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  if (pos[0] === 'start') return start(opts);
  if (pos[0] === 'plan') return plan(opts);
  if (pos[0] === 'done') return done();
  return 'usage: node usage-clear.js start [--project <dir>] | plan --in <dir> [--version <key>=<n>]... | done';
}

if (require.main === module) {
  let out;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `usage-clear: error: ${e.message}`; }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { main };
