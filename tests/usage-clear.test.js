'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSession } = require('./fixtures/transcripts.js');
const { writeSession } = require('./fixtures/usage.js');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const CLEAR = path.join(PLUGIN, 'scripts', 'usage-clear.js');
const USAGE = path.join(PLUGIN, 'scripts', 'usage.js');
const tmp = tempDir;
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

// Changed on purpose: the machine has the install id of its page entry (`id-<pc>` in indexOf), because the clear,
// like the sync, takes only the entry with this machine's install id.
function world(pc = 'testpc', installId = `id-${pc}`) {
  const w = { dir: tmp('keel-clear-usage-'), root: tmp('keel-clear-proj-'), home: tmp('keel-clear-home-'), project: tmp('keel-clear-work-') };
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ pc, user: 't@x.y', wallet_default: 'subscription', history_days: 3650, artifact_url: 'https://claude.ai/artifact/test', ...(installId ? { install_id: installId } : {}) }));
  w.run = (script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KEEL_USAGE_DIR: w.dir, KEEL_PROJECTS_DIR: w.root, HOME: w.home, USERPROFILE: w.home, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  w.state = () => read(path.join(w.dir, 'sync-state.json'));
  return w;
}

// What ArtifactData query ... out_dir leaves: <out>/<collection>/<doc_id>.json with the document's fields.
function savedPage(out) {
  const day = (date, part, sessions) => ({ schema: 1, date, pc: 'testpc', user: 't@x.y', part, parts: 2, synced_until: '2026-01-03T00:00:00Z',
    hours: part === 1 ? [{ h: `${date}T10:00:00Z`, wallet: 'subscription', usd: 4, req: 3, tok: {}, by_model: {} }] : [], snapshots: [], sessions });
  write(path.join(out, 'days', '2026-01-01_testpc.json'), day('2026-01-01', 1, [{ id: 'a', usd: 1.25 }, { id: 'b', usd: 0.5 }]));
  write(path.join(out, 'days', '2026-01-01_testpc_p2.json'), day('2026-01-01', 2, [{ id: 'c', usd: 2 }]));
  write(path.join(out, 'days', '2026-01-05_office.json'), { ...day('2026-01-05', 1, []), pc: 'office' });
  write(path.join(out, 'machines', 'testpc.json'), { name: 'testpc', synced_until: '2026-01-03T00:00:00Z' });
  write(path.join(out, 'calib', 'testpc.json'), { pc: 'testpc', points: [] });
  write(path.join(out, 'meta', 'settings.json'), { language: 'uk', schema: 1, template: '0123456789ab' });
}

test('start: a fresh query folder under .keel/local/usage/clear, emptied each time', () => {
  const w = world();
  const line = w.run(CLEAR, ['start', '--project', w.project]);
  const dir = path.join(w.project, '.keel', 'local', 'usage', 'clear');
  assert.equal(line, `usage-clear: query folder ${dir}`);
  write(path.join(dir, 'days', 'old.json'), {});
  w.run(CLEAR, ['start', '--project', w.project]);
  assert.deepEqual(fs.readdirSync(dir), []);
});

// Changed on purpose: a clear takes only this machine's documents; other machines' documents stay.
test('plan: the summary names this machine\'s period, sessions and dollars; other machines and meta stay; versions come from the sync state or --version', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  savedPage(out);
  write(path.join(out, 'machines', 'office.json'), { name: 'office', synced_until: '2026-01-05T00:00:00Z' });
  write(path.join(w.dir, 'sync-state.json'), { docs: { '2026-01-01_testpc': { version: 3, hash: 'h' }, 'machines/testpc': { version: 7, hash: 'h' }, 'calib/testpc': { version: 2, hash: 'h' } }, pending: {} });
  const first = JSON.parse(w.run(CLEAR, ['plan', '--in', out]));
  assert.deepEqual(first.summary, {
    documents: 4, day_documents: 2, first_day: '2026-01-01', last_day: '2026-01-01', days_with_data: 1,
    sessions: 3, sessions_usd: 3.75, all_usd: 4, calibration_documents: 1, kilobytes: first.summary.kilobytes,
  });
  assert.deepEqual(first.missing_versions, ['2026-01-01_testpc_p2'], 'a part this machine has no version for');
  assert.equal(first.batches, undefined, 'nothing is deleted before every version is known');
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--in', out, '--version', 'days/2026-01-01_testpc_p2=1']));
  assert.equal(plan.missing_versions, undefined);
  assert.equal(plan.summary.delete_calls, 1, 'the warning names the calls');
  assert.deepEqual(plan.batches.flatMap((b) => b.writes), [
    { op: 'delete', collection: 'days', doc_id: '2026-01-01_testpc', if_version: 3 },
    { op: 'delete', collection: 'days', doc_id: '2026-01-01_testpc_p2', if_version: 1 },
    { op: 'delete', collection: 'machines', doc_id: 'testpc', if_version: 7 },
    { op: 'delete', collection: 'calib', doc_id: 'testpc', if_version: 2 },
  ]);
});

test('plan: more than 50 documents are split into batches of at most 50 deletes', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  const docs = {};
  for (let i = 0; i < 120; i++) {
    const id = `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}_testpc`;
    write(path.join(out, 'days', `${id}.json`), { date: id.slice(0, 10), pc: 'testpc', hours: [], sessions: [] });
    docs[id] = { version: 1, hash: 'h' };
  }
  write(path.join(w.dir, 'sync-state.json'), { docs, pending: {} });
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--in', out]));
  assert.deepEqual(plan.batches.map((b) => b.writes.length), [50, 50, 20]);
  assert.equal(plan.summary.delete_calls, 3);
});

test('done: this machine forgets the sent documents and the next sync sends nothing from before the clear', () => {
  const w = world();
  buildSession(w.root);
  const prepare = () => JSON.parse(w.run(USAGE, ['prepare', '--project', w.project])).batches.flatMap((b) => b.writes);
  assert.ok(prepare().some((x) => x.doc_id === '2026-01-01_testpc'), 'before: the old day is sent');
  w.run(USAGE, ['ack']);
  w.run(CLEAR, ['start', '--project', w.project]);
  w.run(CLEAR, ['plan', '--in', tmp('keel-clear-out-')]);
  assert.match(w.run(CLEAR, ['done']), /^usage-clear: this machine sends only data from \S+ on/);
  const state = w.state();
  assert.deepEqual([state.docs, state.pending, state.sessions_rule], [{}, {}, 'keel']);
  assert.equal(state.synced_until, state.cleared_at);
  assert.deepEqual(prepare().map((x) => x.collection), ['machines'], 'after: the old day is not sent again');
  // The day of the clear, with nothing in it yet, is not sent as an empty document.
  writeSession(w.root, { id: 'before', rows: [{ t: Date.parse(state.cleared_at) - 60000, prompt: 'old work' }, { t: Date.parse(state.cleared_at) - 59000, model: 'claude-opus-4-test', tok: { in: 1000 } }] });
  assert.deepEqual(prepare().map((x) => x.collection), ['machines'], 'the clear day holds only older work: nothing to send');
  // A request after the clear goes out, in a day that holds only what came after it.
  const t = Date.parse(state.cleared_at) + 60000;
  writeSession(w.root, { id: 'fresh', rows: [{ t, prompt: 'new work' }, { t: t + 1000, model: 'claude-opus-4-test', tok: { in: 1000 } }] });
  const after = prepare().filter((x) => x.collection === 'days');
  assert.equal(after.length, 1);
  const doc = read(after[0].file_path);
  assert.deepEqual(doc.sessions.map((s) => s.id), ['fresh']);
  assert.equal(doc.hours.reduce((n, h) => n + h.req, 0), 1);
});

// A page index as the model saves it from the page (read_file): the machines with their month files and recent hours.
function indexOf(machines) {
  const pcs = {};
  for (const [name, months, usd] of machines) {
    pcs[name] = {
      name, user: 't@x.y', wallet_default: 'subscription', install_id: `id-${name}`, synced_until: '2026-01-03T00:00:00.000Z', last_seen: '2026-01-03T01:00:00.000Z',
      calib: { rates: [] }, recent: { hours: [{ h: '2026-01-03T10:00:00.000Z', wallet: 'subscription', usd, by_model: {} }, { h: '2026-01-03T11:00:00.000Z', wallet: 'subscription', usd: 0.5, by_model: {} }], snapshots: [{ t: '2026-01-03T10:00:00.000Z' }] },
      months: Object.fromEntries(months.map((m) => [m, 'a'.repeat(64)])),
    };
  }
  return { schema: 2, kind: 'index', language: 'uk', template: '0123456789ab', pcs };
}
const pageIn = (w, name, value) => { const f = path.join(w.project, '.keel', 'local', 'usage', 'in', name); write(f, value); return f; };

// Changed on purpose: a clear removes only this machine's page files; the other machines' entries stay as they are.
test('plan --page: this machine\'s months and last 35 days\' dollars; the publish removes its month files and writes the new index', () => {
  const w = world();
  const page = pageIn(w, 'index.json', indexOf([['testpc', ['2026-02', '2026-01'], 4], ['office', ['2026-03'], 1.25]]));
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--page', page, '--project', w.project]));
  assert.equal(plan.summary, undefined, 'no database part without --in');
  assert.deepEqual(plan.files.machine, { name: 'testpc', months: 2, first_month: '2026-01', last_month: '2026-02', last_35_days_usd: 4.5 });
  assert.equal(plan.files.publishes.length, 1);
  const [publish] = plan.files.publishes;
  assert.deepEqual(publish.remove, ['data/testpc-2026-01.json', 'data/testpc-2026-02.json']);
  assert.equal(publish.files.length, 1);
  assert.equal(publish.files[0].path, 'data/index.json');
  const next = read(publish.files[0].file);
  assert.ok(publish.files[0].file.startsWith(path.join(w.project, '.keel', 'local', 'usage', 'clear', 'out')));
  const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
  const SCHEMA = read(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'));
  assert.deepEqual(validate(next, { ...SCHEMA.$defs.index, $defs: SCHEMA.$defs }), []);
  assert.deepEqual([next.language, next.template], ['uk', '0123456789ab']);
  const mine = next.pcs.testpc;
  assert.deepEqual([mine.months, mine.recent, mine.calib, mine.install_id], [{}, { hours: [], snapshots: [] }, null, 'id-testpc']);
  assert.deepEqual(next.pcs.office, indexOf([['office', ['2026-03'], 1.25]]).pcs.office, 'another machine stays as it was');
  assert.ok(w.state().clear_pending_at, 'done will use the time of this plan');
});

test('plan --page: an entry with this name but another install id (or none here) is another PC\'s: nothing of it is cleared', () => {
  const page = (w) => pageIn(w, 'index.json', indexOf([['testpc', ['2026-01'], 4]]));
  const other = world('testpc', 'id-another-pc');
  assert.deepEqual(JSON.parse(other.run(CLEAR, ['plan', '--page', page(other), '--project', other.project])).files, { machine: null, publishes: [], name: 'taken' });
  const fresh = world('testpc', null);
  assert.deepEqual(JSON.parse(fresh.run(CLEAR, ['plan', '--page', page(fresh), '--project', fresh.project])).files, { machine: null, publishes: [], name: 'ask' });
});

test('plan: a plan that fails leaves no clear time, so done after it changes nothing', () => {
  const w = world();
  w.run(CLEAR, ['start', '--project', w.project]);
  const bad = indexOf([['testpc', ['2026-01'], 1]]);
  delete bad.pcs.testpc.install_id;
  assert.match(w.run(CLEAR, ['plan', '--page', pageIn(w, 'bad.json', bad), '--project', w.project]), /^usage-clear: error: .* does not match the index format/);
  assert.ok(!fs.existsSync(path.join(w.dir, 'sync-state.json')) || !w.state().clear_pending_at);
  assert.match(w.run(CLEAR, ['done']), /^usage-clear: nothing to finish/);
});

test('plan --in: a day document saved wrapped ({version, data}) is still this machine\'s and is deleted', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  savedPage(out);
  const file = path.join(out, 'days', '2026-01-01_testpc.json');
  write(file, { version: 3, data: read(file) });
  write(path.join(w.dir, 'sync-state.json'), { docs: {}, pending: {} });
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--in', out]));
  assert.deepEqual([plan.summary.day_documents, plan.summary.sessions, plan.summary.first_day], [2, 3, '2026-01-01']);
  assert.ok(plan.missing_versions.includes('2026-01-01_testpc'));
});

test('plan --page: more than 256 files and removes are split over publishes; only the first carries the index', () => {
  const w = world();
  const months = Array.from({ length: 600 }, (_, i) => `${2000 + i}-01`);
  const page = pageIn(w, 'index.json', indexOf([['testpc', months, 1]]));
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--page', page, '--project', w.project]));
  assert.deepEqual(plan.files.publishes.map((p) => (p.files || []).length + p.remove.length), [256, 256, 89]);
  assert.deepEqual(plan.files.publishes.map((p) => Boolean(p.files)), [true, false, false]);
  assert.deepEqual(plan.files.publishes.flatMap((p) => p.remove), months.map((m) => `data/testpc-${m}.json`));
});

test('plan: --in and --page together give both parts; --page none alone gives an empty files part; neither is an error', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  savedPage(out);
  write(path.join(w.dir, 'sync-state.json'), { docs: {}, pending: {} });
  const page = pageIn(w, 'index.json', indexOf([['testpc', ['2026-01'], 1]]));
  const both = JSON.parse(w.run(CLEAR, ['plan', '--in', out, '--page', page, '--project', w.project]));
  assert.equal(both.summary.documents, 4);
  assert.equal(both.files.publishes.length, 1);
  const at = w.state().clear_pending_at;
  // A rerun for the missing versions keeps the time of the first plan.
  w.run(CLEAR, ['plan', '--in', out]);
  assert.equal(w.state().clear_pending_at, at);
  assert.deepEqual(JSON.parse(w.run(CLEAR, ['plan', '--page', 'none', '--project', w.project])), { files: { machine: null, publishes: [] } });
  assert.deepEqual(JSON.parse(w.run(CLEAR, ['plan', '--page', pageIn(w, 'other.json', indexOf([['office', ['2026-01'], 1]])), '--project', w.project])).files, { machine: null, publishes: [] }, 'this machine is not on the page');
  assert.match(w.run(CLEAR, ['plan']), /^usage-clear: error: give --in .* and\/or --page/);
});

test('plan --page: a file outside .keel/local, a file that is not the index or does not fit it → one error line', () => {
  const w = world();
  const outside = path.join(w.home, 'index.json');
  write(outside, indexOf([['testpc', [], 1]]));
  assert.match(w.run(CLEAR, ['plan', '--page', outside, '--project', w.project]), /^usage-clear: error: .* must be a file under the project's \.keel\/local\/$/);
  assert.match(w.run(CLEAR, ['plan', '--page', pageIn(w, 'm.json', { schema: 2, kind: 'month', pc: 'testpc', month: '2026-01', days: [] }), '--project', w.project]), /^usage-clear: error: .* is not the page's data\/index\.json$/);
  const bad = indexOf([['testpc', ['2026-01'], 1]]);
  bad.pcs['../x'] = bad.pcs.testpc;
  assert.match(w.run(CLEAR, ['plan', '--page', pageIn(w, 'bad.json', bad), '--project', w.project]), /^usage-clear: error: .* does not match the index format/);
});

test('done: uses the time of the plan, resets the files sync and deletes the local month files; without a plan it changes nothing', () => {
  const w = world();
  const HOUR = 3600000;
  const at = Date.now() - 3 * HOUR;
  writeSession(w.root, { id: 'old', rows: [{ t: at, prompt: 'old work' }, { t: at + 60000, model: 'claude-opus-4-test', tok: { in: 1000000 } }], mtimeMs: at + 120000 });
  const spec = JSON.parse(w.run(USAGE, ['prepare', '--tools', 'files', '--page', 'none', '--page-version', '1', '--project', w.project]));
  assert.equal(spec.action, 'publish');
  const localDir = path.join(w.dir, 'usage-files');
  assert.equal(fs.readdirSync(localDir).length, 1);
  w.run(USAGE, ['report', '--project', w.project, '--published', '2']);
  assert.ok(Object.keys(w.state().files.published).length);

  assert.match(w.run(CLEAR, ['done']), /^usage-clear: nothing to finish/);
  assert.equal(w.state().cleared_at, null);
  w.run(CLEAR, ['start', '--project', w.project]);
  w.run(CLEAR, ['plan', '--page', pageIn(w, 'index.json', indexOf([['testpc', ['2026-01'], 1]])), '--project', w.project]);
  const planned = w.state().clear_pending_at;
  assert.match(w.run(CLEAR, ['done']), new RegExp(`sends only data from ${planned} on`));
  const state = w.state();
  assert.deepEqual([state.cleared_at, state.synced_until, state.clear_pending_at], [planned, planned, null]);
  assert.deepEqual(state.files, {});
  assert.deepEqual(fs.readdirSync(localDir), []);
  assert.match(w.run(CLEAR, ['done']), /^usage-clear: nothing to finish/, 'a second done does not move the clear time');
  assert.equal(w.state().cleared_at, planned);
});

test('start: forgets the clear time of an earlier run that was not finished', () => {
  const w = world();
  w.run(CLEAR, ['start', '--project', w.project]);
  w.run(CLEAR, ['plan', '--page', 'none', '--project', w.project]);
  const declined = w.state().clear_pending_at;
  assert.ok(declined);
  w.run(CLEAR, ['start', '--project', w.project]);
  assert.equal(w.state().clear_pending_at, null);
  const before = Date.now();
  w.run(CLEAR, ['plan', '--in', tmp('keel-clear-out-')]);
  w.run(CLEAR, ['done']);
  assert.ok(Date.parse(w.state().cleared_at) >= before, 'the clear that ran, not the declined one');
});

test('after this machine\'s clear in a session without the page-file tools, its next files sync removes its old page files and reads nothing back', () => {
  const DAY = 24 * 3600000;
  const w = world();
  // 40 days back is always another month than now.
  const old = Date.now() - 40 * DAY;
  writeSession(w.root, { id: 'old', rows: [{ t: old, prompt: 'old work' }, { t: old + 60000, model: 'claude-opus-4-test', tok: { in: 1000000 } }], mtimeMs: old + 120000 });
  const prepare = (...more) => JSON.parse(w.run(USAGE, ['prepare', '--tools', 'files', '--project', w.project, ...more]));
  const first = prepare('--page', 'none', '--page-version', '1');
  const month = first.files.find((f) => f.path.startsWith('data/testpc-')).path;
  w.run(USAGE, ['report', '--project', w.project, '--published', '2']);
  const index = pageIn(w, 'index.json', read(first.files.find((f) => f.path === 'data/index.json').file));

  // The clear deletes only database documents (built-in tools): the page files stay.
  w.run(CLEAR, ['start', '--project', w.project]);
  w.run(CLEAR, ['plan', '--in', tmp('keel-clear-out-')]);
  w.run(CLEAR, ['done']);

  const fresh = Date.now();
  writeSession(w.root, { id: 'fresh', rows: [{ t: fresh, prompt: 'new work' }, { t: fresh + 1000, model: 'claude-opus-4-test', tok: { in: 1000000 } }], mtimeMs: fresh + 2000 });
  const spec = prepare('--page', index, '--page-version', '3');
  assert.equal(spec.action, 'publish', 'nothing is read back from before the clear');
  const sessions = spec.files.filter((f) => f.path.startsWith('data/testpc-')).flatMap((f) => read(f.file).days).flatMap((d) => d.sessions.map((s) => s.id));
  assert.deepEqual(sessions, ['fresh']);
  assert.deepEqual(spec.remove, [month], 'the old month file is removed');
});

test('usage-clear skill: user-only, warns with the period and the effects, deletes only after a yes, then resets', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'skills', 'usage-clear', 'SKILL.md'), 'utf8');
  assert.match(text, /^disable-model-invocation: true$/m);
  assert.match(text, /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/usage-setup\.js" "\$\{CLAUDE_PROJECT_DIR\}" show`$/m);
  for (const sub of ['start --project', 'plan --project', 'done']) assert.ok(text.includes(`usage-clear.js" ${sub}`), sub);
  // Changed on purpose: the plan takes the page files (--page) and the database (--in), whichever this session's tools read.
  assert.match(text, /plus `--page <the saved\s+data\/index\.json>` \(files tools; `--page none` when there was none\) and `--in "<the folder>"` \(built-in\s+tools\)/);
  assert.ok(text.indexOf('Only an explicit yes') < text.indexOf('one `publish_files` call'), 'the question comes before any publish');
  // Changed on purpose: the local reset runs right after the yes, so a clear cut short never re-sends old data.
  assert.ok(text.indexOf('Only an explicit yes') < text.indexOf('usage-clear.js" done'), 'the reset comes after the yes');
  assert.ok(text.indexOf('usage-clear.js" done') < text.indexOf('one `publish_files` call'), 'the reset comes before the publishes');
  assert.match(text, /`first_day` to `last_day`/);
  assert.match(text, /it cannot be undone/);
  assert.match(text, /"No, keep\s+it" first/);
  assert.match(text, /Only an explicit yes goes on/);
  assert.match(text, /never read the saved files/);
  assert.ok(text.indexOf('Only an explicit yes') < text.indexOf('action: "batch"'), 'the question comes before any delete');
  assert.ok(text.indexOf('usage-clear.js" done') < text.indexOf('action: "batch"'), 'the reset comes before the deletes');
  // Changed on purpose: the clear deletes only this machine's data; the warning names the delete calls.
  assert.match(text, /The clear deletes only \*\*this machine's\*\* data/);
  assert.match(text, /runs `\/keel:usage-clear` on every\s+machine/);
  assert.ok(text.indexOf('`delete_calls` calls') > 0 && text.indexOf('`delete_calls` calls') < text.indexOf('Only an explicit yes'), 'the price is named before the question');
});
