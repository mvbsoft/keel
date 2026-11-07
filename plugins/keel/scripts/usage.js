'use strict';
// keel usage calculator: syncs this machine's spending to the dashboard page and writes the end-of-task cost report.
// Usage: node usage.js <command> [options]   (prints plain text, or JSON for `prepare`; always exits 0)
//   prepare   [--tools db|files|none] [--out <dir>] [--session <id>] [--keel <json-file>] [--level L] [--findings m/s/n]
//             [--gates pass|fail|none] [--feature <name>] [--project <dir>] [--artifact <url>]
//             with a page, collects this machine's month files locally (also with the sync off), then prints JSON with
//             `action`: skip (with `reason`), or what the page tools of this session do next:
//             --tools db (the default; the built-in ArtifactData tool): [--version <docKey>=<n>]... writes the changed
//               day documents to <out> (under <project>/.keel/local/usage/, default usage/out) and prints `batches`;
//             --tools files (the claude-artifacts tools): without --page prints `index` (read data/index.json and the
//               page version, then prepare again); --page <saved data/index.json | none> --page-version <v>
//               [--take <saved month file> | --take none]... [--same-pc] [--shared] prints `read` (this machine's month
//               files to read back from the page first, then prepare again with --take; --take none when none could be
//               read) or `publish` (files, remove, base_version); [--lang <code>] the language a page without one
//               gets (default: the conversation_language setting)
//   ack       [--batch <n>] [--failed <docId>]...   marks the prepared writes (or those of batch n) as written (versions go up by one)
//   report    [--session <id>] [--in <dir>] [--page <saved data/index.json>] [--published <page version>] [--lang uk|en]
//             [--project <dir>] [--last-turn]   the end report for a session (--last-turn: one line, the latest user
//             turn only); --published records the files publish of the last prepare; keeps page_template in step
//             with the page's meta/settings read into <in>; says once what the last prepare skipped
//   snapshot  --src desktop --five-hour <n> --seven-day <n> [--five-hour-resets <iso>] [--seven-day-resets <iso>] [--session <id>]
//   calibrate [--in <dir>] [--page <saved data/index.json>]   the calibration table (points, rates, machines still to sync)
//   audit     --page <dir> [--project <dir>]   this machine's dollars and tokens per session on the page (month files and
//             day documents saved into <dir>, summed as the dashboard sums them) against the local transcripts
// Files: <usageDir> = ~/.claude/keel (KEEL_USAGE_DIR); transcripts: ~/.claude/projects (KEEL_PROJECTS_DIR).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./lib/usage-store.js');
const { activeTask, planText } = require('./lib/tasks.js');
const { usageDir, loadMachineConfig, writeMachineConfig, detectWallet } = require('./lib/usage-config.js');
const pageSync = require('./lib/usage-page-sync.js');
const { readSnapshots, snapshotFromPercents, dedupeSnapshots } = require('./lib/limits.js');
const { RECENT_DAYS } = require('./lib/usage-files.js');
const { calibrate, share } = require('./lib/calibrate.js');
const { pickLanguage, translator } = require('./lib/i18n.js');
const { safeLocalPath, safeLocalWrite } = require('./lib/safe-path.js');

const DAY_MS = store.DAY_MS;
const MAX_BATCH_WRITES = 50;
const MAX_BATCH_BYTES = 1000000;
// Other machines' hours reach the calibration through their index entry, which keeps exactly this window.
const CALIBRATION_DAYS = RECENT_DAYS;
const MAX_CALIB_POINTS = 200;  // the published calibration document keeps the newest points
const REPEATABLE = new Set(['version', 'failed', 'take']);
const TOOLS = ['db', 'files', 'none'];

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2);
    const value = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (REPEATABLE.has(key)) (opts[key] = opts[key] || []).push(value);
    else opts[key] = value;
  }
  return { opts, pos };
}

const readJson = store.readJson;
const keelVersion = () => (readJson(path.join(__dirname, '..', '.claude-plugin', 'plugin.json')) || {}).version || null;

function projectsRoot(env = process.env) {
  return env.KEEL_PROJECTS_DIR || path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}

const projectDir = (opts) => path.resolve(typeof opts.project === 'string' ? opts.project : process.cwd());

// --in: the documents read back from the page. A folder under the project's .keel/local is read only
// when no link is on the way to it.
function inFolder(opts) {
  if (typeof opts.in !== 'string') return null;
  const dir = path.resolve(opts.in);
  const root = projectDir(opts);
  const r = path.relative(path.join(root, '.keel', 'local'), dir);
  if (r.startsWith('..') || path.isAbsolute(r)) return dir;
  try { return safeLocalPath(root, ...r.split(path.sep).filter(Boolean)); } catch { return null; }
}

// A file the model saved for a script step: only under the project's .keel/local/, with no link out of it.
function underLocal(root, file) {
  try {
    const real = fs.realpathSync.native(path.resolve(file));
    const r = path.relative(fs.realpathSync.native(path.join(root, '.keel', 'local')), real);
    return !r || r.startsWith('..') || path.isAbsolute(r) ? null : real;
  } catch { return null; }
}

// The shared project page of older keel versions (usage.artifact_url in .keel/config.json): no longer used, as
// every machine syncs to its own page. Read only to say so once.
function projectArtifactUrl(root) {
  const cfg = readJson(path.join(root, '.keel', 'config.json'));
  const u = cfg && cfg.usage && cfg.usage.artifact_url;
  return typeof u === 'string' && u ? u : null;
}

// --- keel fields of the task this session works on ---

// The steps of a plan text, as { title, model }.
function planSteps(text) {
  try {
    const { parseSteps } = require('./plan-steps.js');
    return parseSteps(text).map((s) => ({ title: s.title, model: s.model || null }));
  } catch { return []; }
}

const int = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

// A --keel file: only under the project's .keel/local/ (the day documents leave the machine), and only
// the fields keel itself records, in their shapes; anything else in the file is dropped.
function keelFile(root, file) {
  if (!fs.existsSync(path.resolve(file))) return { refused: 'not found' };
  const real = underLocal(root, file);
  if (!real) return { refused: 'not under the project\'s .keel/local/' };
  const raw = readJson(real);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { fields: {} };
  const text = (s, max) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max);
  const nums = (o, keys) => (o && typeof o === 'object' ? Object.fromEntries(keys.map((k) => [k, int(o[k])])) : undefined);
  const out = {};
  if (typeof raw.task === 'string') out.task = text(raw.task, 200);
  if (Array.isArray(raw.steps)) out.steps = raw.steps.slice(0, 100).filter((s) => s && typeof s === 'object').map((s) => ({ title: text(s.title ?? '', 200), model: typeof s.model === 'string' ? text(s.model, 20) : null }));
  if (typeof raw.level === 'string') out.level = text(raw.level, 20);
  if (raw.lines !== undefined) out.lines = nums(raw.lines, ['add', 'del']);
  if (raw.files !== undefined) out.files = int(raw.files);
  if (['pass', 'fail', 'none'].includes(raw.gates)) out.gates = raw.gates;
  if (raw.findings !== undefined) out.findings = nums(raw.findings, ['must', 'should', 'nice']);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return { fields: out };
}

function keelFields(root, opts, sessionId) {
  // A planning chat (end-planning) records only its feature name. The nulls and [] overwrite what an earlier
  // end-task in the same chat recorded (recordKeel merges fields per session); changes.json is not read,
  // as it belongs to an earlier task and planning changes no code.
  if (opts.feature !== undefined) {
    const { validFeature } = require('./lib/plans.js');
    if (validFeature(opts.feature)) return { task: `planning: ${opts.feature}`, steps: [], level: null, findings: null, gates: null, lines: null, files: null };
    process.stderr.write('usage: --feature ignored (not a feature name)\n');
    return {};
  }
  const out = {};
  if (typeof opts.keel === 'string') {
    const f = keelFile(root, opts.keel);
    if (f.refused) process.stderr.write(`usage: --keel ${opts.keel} ignored (${f.refused})\n`);
    else Object.assign(out, f.fields);
  }
  // The task this session works on: its title is "<id>: <title>"; its steps come from its plan file
  // (plan.md in the task folder, or the path in `plan:`) or from the task file itself.
  const task = typeof sessionId === 'string' ? activeTask(root, sessionId) : null;
  if (task) {
    const title = task.fm.title && task.fm.title !== '-' ? `${task.id}: ${task.fm.title}` : task.id;
    if (out.task === undefined) out.task = title;
    const plan = planText(root, task);
    const steps = planSteps(plan !== null ? plan : task.text);
    if (steps.length && out.steps === undefined) out.steps = steps;
  }
  const changes = readJson(path.join(root, '.keel', 'local', 'tmp', 'changes.json'));
  if (changes && changes.totals && typeof changes.totals === 'object') {
    if (out.lines === undefined) out.lines = { add: int(changes.totals.added), del: int(changes.totals.removed) };
    if (out.files === undefined) out.files = int(changes.totals.files);
  }
  if (typeof opts.level === 'string') out.level = opts.level;
  if (typeof opts.findings === 'string') {
    const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(opts.findings.trim());
    if (m) out.findings = { must: Number(m[1]), should: Number(m[2]), nice: Number(m[3]) };
  }
  if (['pass', 'fail', 'none'].includes(opts.gates)) out.gates = opts.gates;
  return out;
}

// --- prepare / ack ---

function versionOverrides(list) {
  const out = {};
  for (const v of list || []) {
    const m = /^(.+)=(\d+)$/.exec(String(v));
    // Day documents are keyed by their bare id; accept "days/<id>" too.
    if (m) out[m[1].replace(/^days\//, '')] = Number(m[2]);
  }
  return out;
}

// Writes split into ArtifactData batches (writes keep their `key` and `bytes` here).
function splitBatches(writes) {
  const out = [];
  let cur = { writes: [], bytes: 0 };
  for (const w of writes) {
    if (cur.writes.length && (cur.writes.length >= MAX_BATCH_WRITES || cur.bytes + w.bytes > MAX_BATCH_BYTES)) { out.push(cur); cur = { writes: [], bytes: 0 }; }
    cur.writes.push(w);
    cur.bytes += w.bytes;
  }
  if (cur.writes.length) out.push(cur);
  return out;
}

const batches = (writes) => splitBatches(writes).map((b) => ({ writes: b.writes.map(({ bytes, key, ...w }) => w) }));

// The out folder: under the project's .keel/local/usage/ (default usage/out), with no link on the way.
function outFolder(root, opts) {
  const usage = path.join(root, '.keel', 'local', 'usage');
  const dir = typeof opts.out === 'string' ? path.resolve(opts.out) : path.join(usage, 'out');
  const r = path.relative(usage, dir);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`--out must be a folder inside ${usage}`);
  return { dir: safeLocalPath(root, 'usage', ...r.split(path.sep)), parts: ['usage', ...r.split(path.sep)] };
}

// The files the last prepare wrote are listed in written.json; only those are removed, so nothing else
// in the folder (a file the user keeps there) is touched.
const WRITTEN = 'written.json';
const OUT_NAME = /^(?:(?:(?:machines|calib|data)\/)?[\w.-]+\.json|page\/[\w.-]+\.(?:html|css|js))$/;
function clearOut(root, out) {
  const list = readJson(path.join(out.dir, WRITTEN));
  for (const rel of Array.isArray(list) ? list : []) {
    if (typeof rel !== 'string' || !OUT_NAME.test(rel) || rel === WRITTEN) continue;
    try { fs.rmSync(safeLocalPath(root, ...out.parts, ...rel.split('/'))); } catch { /* gone, or behind a link */ }
  }
}

// A line the next report says once (the latest of each kind).
function addNote(state, key, params = {}) {
  state.notes = state.notes.filter((n) => n.key !== key).concat([{ key, ...params }]);
}

function prepare(opts) {
  const root = projectDir(opts);
  const dir = usageDir();
  const machine = loadMachineConfig();
  const raw = readJson(path.join(dir, 'usage.json')) || {};
  const historyDays = Number.isFinite(raw.history_days) && raw.history_days > 0 ? raw.history_days : 30;
  const nowMs = Date.now();
  const state = store.readState(dir);
  const tools = TOOLS.includes(opts.tools) ? opts.tools : 'db';
  const url = (typeof opts.artifact === 'string' && opts.artifact) || machine.artifact_url;
  if (url && state.artifact_url && state.artifact_url !== url) {
    state.docs = {}; state.pending = {}; state.synced_until = null; state.pending_until = null; state.files = {};
  }
  // Without a page the last one is kept: the state still describes it, so the next page resets it above.
  if (url) state.artifact_url = url;
  if (projectArtifactUrl(root) && !state.team_page_noted) { addNote(state, 'team_page'); state.team_page_noted = true; }

  const root_ = projectsRoot();
  const sessionRef = typeof opts.session === 'string' ? store.listSessions(root_).find((r) => r.id === opts.session) : store.newestSessionIn(root_, root);
  const fields = keelFields(root, opts, sessionRef ? sessionRef.id : undefined);
  const keelInfo = sessionRef && Object.keys(fields).length ? { session_id: sessionRef.id, ...fields } : null;
  const ctx = { root, dir, machine, state, nowMs, historyDays, projectsRoot: root_, keelInfo };

  const done = (result) => { store.writeState(dir, state); return JSON.stringify({ tools, artifact_url: url, ...result }); };
  const skip = (reason, note) => {
    pageSync.collect({ ...ctx, clearedAt: state.cleared_at }, pageSync.filesState(state));
    if (note) addNote(state, note.key, note.params);
    return done({ action: 'skip', reason });
  };
  // No page: nothing is collected either (the month files hold prompt previews); a page set up later is built
  // from the Claude Code logs.
  if (!url) return done({ action: 'skip', reason: 'no_page' });
  if (!machine.sync) return skip('sync_off', { key: 'sync_off', params: { since: machine.sync_off_since } });
  if (tools === 'none') {
    const reason = detectWallet({ projectDir: root, machine }) === 'api' ? 'api' : 'no_tools';
    return skip(reason, { key: reason });
  }
  const out = outFolder(root, opts);
  clearOut(root, out);
  if (tools === 'files') return done(prepareFiles(opts, ctx, out));
  pageSync.collect({ ...ctx, clearedAt: state.cleared_at }, pageSync.filesState(state));
  return done(prepareDb(opts, ctx, out));
}

function prepareFiles(opts, ctx, out) {
  // First call of a sync: the model reads the page's index and version, then calls prepare again with them.
  if (opts.page === undefined) return { action: 'index', paths: [pageSync.INDEX_PATH] };
  if (typeof opts.page !== 'string') throw new Error('--tools files needs --page <saved data/index.json> (or --page none) and --page-version');
  if (opts['page-version'] === undefined || opts['page-version'] === true) throw new Error('--tools files needs --page-version <the page version>');
  const local = (f) => { const real = underLocal(ctx.root, f); if (!real) throw new Error(`${f} must be a file under the project's .keel/local/`); return real; };
  const setup = require('./usage-setup.js');
  const pc = store.sanitizePc(ctx.machine.pc);
  const calib = calibDoc(ctx.dir, pc);
  const r = pageSync.prepareFiles({
    ...ctx,
    out,
    page: opts.page === 'none' ? 'none' : local(opts.page),
    pageVersion: opts['page-version'],
    takeFiles: (opts.take || []).filter((f) => typeof f === 'string' && f !== 'none').map(local),
    readRound: (opts.take || []).length > 0,
    samePc: opts['same-pc'] === true,
    shared: opts.shared === true,
    calib: calib ? calib.doc : null,
    template: { now: setup.pageTemplate(), files: setup.PAGE_FILES, dir: setup.TEMPLATE, version: keelVersion() },
    language: pickLanguage(typeof opts.lang === 'string' ? opts.lang : undefined),
  });
  if (r.action === 'skip') addNote(ctx.state, r.reason, { pc });
  // The name question was answered (--same-pc) or the name is free again: an earlier note about it is stale.
  else ctx.state.notes = ctx.state.notes.filter((n) => n.key !== 'name_ask' && n.key !== 'name_taken');
  const rel = (f) => path.relative(safeLocalPath(ctx.root, ...out.parts), f).split(path.sep).join('/');
  safeLocalWrite(ctx.root, [...out.parts, WRITTEN], `${JSON.stringify((r.files || []).map((f) => rel(f.file)))}\n`);
  return r;
}

function prepareDb(opts, ctx, out) {
  const { root, dir, machine, state, nowMs, historyDays, keelInfo } = ctx;
  const nowIso = new Date(nowMs).toISOString();
  let sinceMs = state.synced_until ? Date.parse(state.synced_until) - store.SAFETY_MS : nowMs - historyDays * DAY_MS;
  // Documents sent under another rule for which sessions are listed are rebuilt once, back to the first day sent.
  if (state.sessions_rule !== store.SESSIONS_RULE) {
    const first = store.earliestDay(state);
    sinceMs = Math.min(sinceMs, nowMs - historyDays * DAY_MS, first ? Date.parse(`${first}T00:00:00Z`) : Infinity);
    state.pending_rule = store.SESSIONS_RULE;
  }

  // After /keel:usage-clear nothing from before the clear goes to the page again.
  const fromMs = state.cleared_at ? Date.parse(state.cleared_at) : undefined;
  if (fromMs) sinceMs = Math.max(sinceMs, fromMs - store.SAFETY_MS);
  const built = store.buildDays({ projectsRoot: ctx.projectsRoot, machine, usageDir: dir, sinceMs, keelInfo, nowMs, fromMs });
  const machineDoc = store.buildMachineDoc(machine, nowIso);
  const pc = store.sanitizePc(machine.pc);
  const calib = calibDoc(dir, pc);
  const items = built.docs.map((d) => ({ ...d, collection: 'days' })).concat([{ ...machineDoc, collection: 'machines' }], calib ? [calib] : []);
  const staged = store.stage(state, items, {
    versions: versionOverrides(opts.version), nowIso, rebuiltIds: built.days.map((d) => `${d}_${pc}`),
  });

  const written = [];
  const writes = staged.map((d) => {
    const rel = d.collection === 'days' ? `${d.id}.json` : `${d.collection}/${d.id}.json`;
    if (!OUT_NAME.test(rel)) throw new Error(`unexpected document id ${d.id}`);
    const text = JSON.stringify(d.doc);
    const file = safeLocalWrite(root, [...out.parts, ...rel.split('/')], text);
    written.push(rel);
    return { op: 'set', collection: d.collection, doc_id: d.id, file_path: file, ...(d.if_version ? { if_version: d.if_version } : {}), bytes: Buffer.byteLength(text), key: d.key };
  });
  safeLocalWrite(root, [...out.parts, WRITTEN], `${JSON.stringify(written)}\n`);
  // Each pending write remembers its batch, so `ack --batch <n>` records one batch as soon as it is written.
  splitBatches(writes).forEach((b, i) => { for (const w of b.writes) if (state.pending[w.key]) state.pending[w.key].batch = i + 1; });
  return { action: 'write', batches: batches(writes) };
}

function ack(opts) {
  const dir = usageDir();
  const state = store.readState(dir);
  if (!Object.keys(state.pending).length) return 'ack: nothing was pending';
  const failed = (opts.failed || []).map(String);
  const batch = opts.batch === undefined ? null : Number(opts.batch);
  if (batch !== null && !Object.values(state.pending).some((p) => p.batch === batch)) return `ack: no pending batch ${opts.batch}`;
  const r = store.ack(state, { failed, batch });
  store.writeState(dir, state);
  const lines = [`ack: ${r.committed} documents recorded${state.synced_until ? `; synced until ${state.synced_until}` : ''}`];
  const mine = batch === null ? r.left : r.left.filter((k) => state.pending[k].batch === batch);
  if (batch !== null && r.left.length > mine.length) lines.push(`${r.left.length - mine.length} documents of other batches are still pending: write and ack them too.`);
  if (mine.length) {
    lines.push(`still pending: ${mine.join(', ')}. For each: ArtifactData get the document to read its current "version" n, then run prepare again with --version <docKey>=<n> (docKey as listed; machines are machines/<pc>) and write again. Batches already acked are not sent again.`);
  }
  if (r.unknown.length) lines.push(`not pending (ignored): ${r.unknown.join(', ')}`);
  return lines.join('\n');
}

// --- remote documents saved by the model (ArtifactData query ... out_dir) ---

const WRAPPERS = ['data', 'doc', 'document', 'value', 'docs', 'documents', 'results', 'items', 'rows'];

function unwrap(x, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 5) return [];
  if (Array.isArray(x)) return x.flatMap((v) => unwrap(v, depth + 1));
  if (typeof x.pc === 'string' && Array.isArray(x.hours)) return [x];
  if (typeof x.synced_until === 'string' && typeof x.name === 'string' && !Array.isArray(x.hours)) return [{ ...x, kind_: 'machine' }];
  for (const k of WRAPPERS) {
    if (x[k] && typeof x[k] === 'object') { const found = unwrap(x[k], depth + 1); if (found.length) return found; }
  }
  return [];
}

// The page's meta/settings document as the query saved it (possibly wrapped), or null when it was not read.
function pageSettings(inDir) {
  let x = readJson(path.join(inDir, 'meta', 'settings.json'));
  for (let depth = 0; x && typeof x === 'object' && !Array.isArray(x) && depth < 5; depth++) {
    if ('template' in x || 'language' in x || 'schema' in x) return x;
    const k = WRAPPERS.find((w) => x[w] && typeof x[w] === 'object');
    x = k ? x[k] : null;
  }
  return null;
}

// The page says which keel page it runs (meta/settings `template`, written by configure). This machine keeps
// a copy as page_template, so show and /keel:usage are right after the page was updated from another machine.
// A page without the field runs an older keel's page. An unconfigured machine gets no usage.json from this.
function notePageTemplate(inDir, machine) {
  const s = inDir && pageSettings(inDir);
  if (!s || !machine.configured) return;
  const t = typeof s.template === 'string' && /^[0-9a-f]{12}$/.test(s.template) ? s.template : null;
  if (t === machine.page_template) return;
  try { writeMachineConfig({ page_template: t }); } catch {}
}

function jsonFiles(dir, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 2) out.push(...jsonFiles(p, depth + 1));
    else if (e.isFile() && e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const { later } = store;

// Other machines of the same user only (store.sameUser).
function loadRemote(inDir, localPc, localUser = null) {
  const res = { machines: [], hours: [], snapshots: [] };
  if (!inDir) return res;
  const mine = store.sameUser(localUser);
  const byPc = new Map();
  const seen = (pc, d) => {
    const e = byPc.get(pc) || { synced_until: null, last_seen: null };
    e.synced_until = later(e.synced_until, d.synced_until);
    if (typeof d.last_seen === 'string') e.last_seen = later(e.last_seen, d.last_seen);
    byPc.set(pc, e);
  };
  for (const f of jsonFiles(inDir)) {
    for (const d of unwrap(readJson(f))) {
      if (!mine(d.user)) continue;
      if (d.kind_ === 'machine') {
        const pc = store.sanitizePc(d.name);
        if (pc !== localPc) seen(pc, d);
        continue;
      }
      if (d.pc === localPc) continue;
      seen(d.pc, d);
      for (const h of d.hours) res.hours.push({ pc: d.pc, h: h.h, wallet: h.wallet, usd: h.usd, by_model: h.by_model });
      for (const s of d.snapshots || []) res.snapshots.push(s);
    }
  }
  res.machines = [...byPc].map(([pc, e]) => ({ pc, ...e }));
  return res;
}

// The dashboard reads the calibration from the artifact: prepare publishes this file as collection `calib`.
function saveCalibration(dir, pc, result, computedAt) {
  const part = (r) => ({ rate: r.rate, n: r.n, points: r.points.slice(-MAX_CALIB_POINTS) });
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'calib-latest.json'), JSON.stringify({ pc, computed_at: computedAt, weekly: part(result.weekly), five_hour: part(result.five_hour), waiting: result.waiting }));
  } catch { /* the calibration copy is optional */ }
}

function calibDoc(dir, pc) {
  const doc = readJson(path.join(dir, 'calib-latest.json'));
  if (!doc || typeof doc !== 'object' || doc.pc !== pc) return null;
  const { computed_at, ...rest } = doc;
  return { collection: 'calib', id: pc, key: `calib/${pc}`, doc, hash: store.sha1(JSON.stringify(rest)) };
}

// The other machines as the page's database (day documents) and its data/index.json show them. A machine that
// synced through both keeps, for each hour, the copy from the source it synced to last.
function combineRemote(...sources) {
  const machines = new Map();
  const hours = new Map();
  for (const s of sources) {
    const at = new Map();
    for (const m of s.machines) {
      const e = machines.get(m.pc) || { pc: m.pc, synced_until: null, last_seen: null };
      e.synced_until = later(e.synced_until, m.synced_until || null);
      e.last_seen = later(e.last_seen, m.last_seen || null);
      machines.set(m.pc, e);
      at.set(m.pc, Date.parse(m.synced_until) || 0);
    }
    for (const h of s.hours) {
      const key = `${h.pc}|${h.h}|${h.wallet}`;
      const t = at.get(h.pc) || 0;
      if (!hours.has(key) || t > hours.get(key).t) hours.set(key, { h, t });
    }
  }
  return { machines: [...machines.values()], hours: [...hours.values()].map((x) => x.h), snapshots: sources.flatMap((s) => s.snapshots) };
}

// --page: data/index.json as the model saved it, or null when not given or not readable.
function pageIndex(opts) {
  if (typeof opts.page !== 'string' || opts.page === 'none') return null;
  const file = underLocal(projectDir(opts), opts.page);
  try { return file ? pageSync.readIndex(file) : null; } catch { return null; }
}

function calibration(inDir, machine, nowMs, index = null) {
  const dir = usageDir();
  const sinceMs = nowMs - CALIBRATION_DAYS * DAY_MS;
  const pc = store.sanitizePc(machine.pc);
  const remote = combineRemote(loadRemote(inDir, pc, machine.user), pageSync.remoteFromIndex(index, pc, machine.user));
  const snapshots = dedupeSnapshots(readSnapshots(dir, { sinceMs }).concat(remote.snapshots.filter((s) => Date.parse(s.t) >= sinceMs)));
  const localRequests = store.localRequests({ projectsRoot: projectsRoot(), machine, usageDir: dir, sinceMs });
  const result = calibrate({ snapshots, machines: remote.machines, localPc: pc, localRequests, remoteHours: remote.hours });
  saveCalibration(dir, pc, result, new Date(nowMs).toISOString());
  return { result, snapshots, remote };
}

// --- text ---

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (n) => `$${n.toFixed(2)}`;
const pct1 = (n) => (n < 0.05 ? '<0.1' : n.toFixed(1));

function dur(min, t) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} ${t('report.hours')} ${String(m % 60).padStart(2, '0')} ${t('report.minutes')}` : `${m} ${t('report.minutes')}`;
}

const textsFor = (opts) => translator(pickLanguage(typeof opts.lang === 'string' ? opts.lang : undefined));

function renderReport({ t, summary, wallet, cal, snapshots, cc }) {
  const out = [t('report.head', { id: summary.id.slice(0, 8), project: summary.project || t('report.no_project'), entry: summary.entrypoint ? `, ${summary.entrypoint}` : '', wallet })];
  const requests = (n) => `${n} ${t('report.requests', { n })}`;
  const total = summary.usd;
  // Only who actually ran: an agent without a single request has no row.
  const ran = summary.participants.filter((p) => p.kind === 'main' || p.requests > 0);
  const row = (cells) => `| ${cells.join(' | ')} |`;
  // Agent types and model names come from transcripts; a | would split the cell.
  const cell = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const estimated = ran.some((p) => p.output_estimated);
  out.push('', row([t('report.who'), t('report.col_requests'), t('report.tokens_in'), t('report.cache_write'), t('report.cache_read'), t('report.tokens_out'), '$']), row(Array(7).fill('---')));
  for (const p of ran) {
    const label = p.kind === 'main' ? t('report.main') : `${t('report.agent')} ${cell(p.type)}`;
    const sharePct = total > 0 ? Math.round((p.usd / total) * 100) : 0;
    out.push(row([`${label} (${cell(p.model || '?')})`, p.requests, k(p.tok.in), k(p.tok.cw5 + p.tok.cw1h), k(p.tok.cr), `${p.output_estimated ? '~' : ''}${k(p.tok.out)}`, `${usd(p.usd)}${ran.length > 1 ? ` (${sharePct} %)` : ''}`]));
  }
  const sum = (f) => ran.reduce((s, p) => s + f(p), 0);
  out.push(row([`**${t('report.total')}**`, sum((p) => p.requests), k(sum((p) => p.tok.in)), k(sum((p) => p.tok.cw5 + p.tok.cw1h)), k(sum((p) => p.tok.cr)), k(sum((p) => p.tok.out)), `**${usd(total)}**`]), '');
  out.push(t('report.duration', { total: dur(summary.duration_min, t), active: dur(summary.active_min, t) }));
  const real = summary.turns.filter((x) => x.t != null);
  out.push(t('report.turns', { n: real.length }));
  const top = [...summary.turns].filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd).slice(0, 3);
  if (top.length) {
    out.push(`${t('report.top')}:`);
    top.forEach((x, i) => {
      const parts = `${requests(x.requests)}${x.agents ? `, ${x.agents} ${t('report.agents', { n: x.agents })}` : ''}`;
      out.push(`${i + 1}. ${usd(x.usd)} (${parts}) ${x.t == null ? t('report.lead') : typeof x.text === 'string' && x.text ? `"${x.text}"` : t('report.no_preview')}`);
    });
  }
  if (estimated) out.push(t('report.estimated'));

  if (wallet === 'subscription') {
    out.push(t('report.subscription'));
    const c = cal.result;
    const kinds = [['weekly', 'week', 'seven_day'], ['five_hour', 'five_hour', 'five_hour']];
    if (c.weekly.rate === null && c.five_hour.rate === null) out.push(t('report.no_calibration'));
    else {
      for (const [key, name] of kinds) {
        const r = c[key];
        const s = share(total, r.rate);
        if (s === null) out.push(t('report.no_calibration_kind', { kind: t(`report.${name}`) }));
        else out.push(t(`report.share_${name}`, { pct: pct1(s), rate: r.rate.toFixed(2), n: r.n }));
      }
    }
    const inSession = snapshots.filter((s) => summary.start && Date.parse(s.t) >= Date.parse(summary.start) && Date.parse(s.t) <= Date.parse(summary.end));
    for (const [, name, field] of kinds) {
      const vals = inSession.filter((s) => typeof s[field] === 'number');
      if (vals.length >= 2) out.push(t('report.change', { kind: t(`report.${name}`), from: vals[0][field], to: vals[vals.length - 1][field] }));
    }
    if (c.waiting.length) out.push(t('report.waiting', { machines: c.waiting.join(', ') }));
  } else if (wallet === 'api') out.push(t('report.wallet_api'));
  else if (wallet === 'credit') out.push(t('report.wallet_credit'));
  else out.push(t('report.wallet_unknown'));

  if (summary.unpriced.length) out.push(t('report.unpriced', { models: summary.unpriced.join(', ') }));
  if (typeof cc === 'number' && cc > 0 && Math.abs(total - cc) / cc > 0.1) out.push(t('report.cross_check', { ours: total.toFixed(2), cc: cc.toFixed(2) }));
  return out.join('\n');
}

// --published: the files publish of the last prepare went through; the page now runs the template it carried.
function recordPublished(opts, state, machine) {
  if (opts.published === undefined || opts.published === true) return false;
  const template = pageSync.commit(state);
  if (template === undefined) { process.stderr.write('usage: --published, but no files publish was pending\n'); return false; }
  if (template && machine.configured && template !== machine.page_template) {
    try { writeMachineConfig({ page_template: template }); } catch {}
  }
  return true;
}

// What the last prepare skipped or noticed, said once.
function noteLines(t, state) {
  return state.notes.map((n) => t(`report.note.${n.key}`, { since: n.since ? String(n.since).slice(0, 10) : '?', pc: n.pc || '' }));
}

function report(opts) {
  const machine = loadMachineConfig();
  notePageTemplate(inFolder(opts), machine);
  const dir = usageDir();
  const state = store.readState(dir);
  const recorded = recordPublished(opts, state, machine);
  const t = textsFor(opts);
  const notes = opts['last-turn'] ? [] : noteLines(t, state);
  if (notes.length) state.notes = [];
  if (recorded || notes.length) store.writeState(dir, state);
  const root = projectDir(opts);
  const base = projectsRoot();
  const ref = typeof opts.session === 'string' ? store.listSessions(base).find((r) => r.id === opts.session) : store.newestSessionIn(base, root);
  if (!ref) return [t('report.none'), ...notes].join('\n');
  const nowMs = Date.now();
  const { summary, wallet } = store.sessionSummary(ref, { projectsRoot: base, machine, usageDir: dir });
  const cal = wallet === 'subscription' ? calibration(inFolder(opts), machine, nowMs, pageIndex(opts)) : { result: calibrate({}), snapshots: [] };
  if (opts['last-turn']) return lastTurnText(t, summary, wallet, cal.result);
  const cc = [...readSnapshots(dir)].reverse().find((s) => s.session_id === summary.id && typeof s.cost_usd === 'number');
  return [renderReport({ t, summary, wallet, cal, snapshots: cal.snapshots, cc: cc ? cc.cost_usd : null }), ...notes].join('\n');
}

// The latest user turn: a command's own cost when it ran as one turn (the session's total is the
// whole conversation).
function lastTurnText(t, summary, wallet, cal) {
  const turn = [...summary.turns].reverse().find((x) => x.t != null);
  if (!turn) return t('report.none');
  const s = wallet === 'subscription' ? share(turn.usd, cal.weekly.rate) : null;
  return t('report.last_turn', { usd: usd(turn.usd), requests: `${turn.requests} ${t('report.requests', { n: turn.requests })}` })
    + (s === null ? '' : t('report.last_turn_week', { pct: pct1(s) }));
}

function calibrateText(opts) {
  const machine = loadMachineConfig();
  const t = textsFor(opts);
  const { result } = calibration(inFolder(opts), machine, Date.now(), pageIndex(opts));
  const out = [t('calibration.head')];
  for (const key of ['weekly', 'five_hour']) {
    const r = result[key];
    out.push(`${t(`calibration.${key}`)}: ${r.rate === null ? t('calibration.no_rate') : t('calibration.rate', { rate: r.rate.toFixed(2), n: r.n })}`);
    if (!r.points.length) out.push(`  ${t('calibration.no_points')}`);
    for (const p of r.points) {
      const status = p.kept === false ? t(`calibration.reason.${p.reason}`) : 'ok';
      out.push(`  ${p.from.slice(0, 16)} → ${p.to.slice(0, 16)}  +${p.gain} %  ${usd(p.usd)}  ${usd(p.rate)}/1 %  ${status}`);
    }
  }
  out.push(result.waiting.length ? `${t('calibration.waiting')}: ${result.waiting.join(', ')}` : t('calibration.all_synced'));
  return out.join('\n');
}

function snapshot(opts) {
  const num = (v) => (v === undefined || v === true || !Number.isFinite(Number(v)) ? null : Number(v));
  const five = num(opts['five-hour']);
  const seven = num(opts['seven-day']);
  if (five === null && seven === null) return 'snapshot: give --five-hour and/or --seven-day (percent)';
  const snap = snapshotFromPercents({
    five_hour: five, seven_day: seven,
    five_hour_resets_at: typeof opts['five-hour-resets'] === 'string' ? opts['five-hour-resets'] : null,
    seven_day_resets_at: typeof opts['seven-day-resets'] === 'string' ? opts['seven-day-resets'] : null,
    session_id: typeof opts.session === 'string' ? opts.session : null,
  });
  return snap ? `snapshot recorded: 5-hour ${snap.five_hour} %, week ${snap.seven_day} %` : 'snapshot: unchanged, nothing written';
}

function main(argv) {
  const { opts, pos } = parseArgs(argv);
  switch (pos[0]) {
    case 'prepare': return prepare(opts);
    case 'ack': return ack(opts);
    case 'report': return report(opts);
    case 'snapshot': return snapshot(opts);
    case 'calibrate': return calibrateText(opts);
    case 'audit': return audit(opts);
    default: return 'usage: node usage.js prepare | ack | report | snapshot | calibrate | audit (see the header of scripts/usage.js)';
  }
}

function audit(opts) {
  if (typeof opts.page !== 'string') return 'audit: give --page <folder with the page files and documents saved from the page>';
  const root = projectDir(opts);
  const dir = underLocal(root, opts.page);
  if (!dir) return `audit: ${opts.page} must be a folder under the project's .keel/local/`;
  const machine = loadMachineConfig();
  const state = store.readState(usageDir());
  return require('./lib/usage-audit.js').auditText({
    pageFiles: jsonFiles(dir), machine, usageDir: usageDir(), projectsRoot: projectsRoot(), clearedAt: state.cleared_at, unwrap,
  });
}

if (require.main === module) {
  let out;
  try { out = main(process.argv.slice(2)); } catch (e) { out = `usage: error: ${e.message}`; }
  process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { main, parseArgs, renderReport, loadRemote, combineRemote, unwrap, batches, keelFields, versionOverrides, underLocal };
