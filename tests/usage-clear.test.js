'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildSession } = require('./fixtures/transcripts.js');
const { writeSession } = require('./fixtures/usage.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const CLEAR = path.join(PLUGIN, 'scripts', 'usage-clear.js');
const USAGE = path.join(PLUGIN, 'scripts', 'usage.js');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

function world() {
  const w = { dir: tmp('keel-clear-usage-'), root: tmp('keel-clear-proj-'), home: tmp('keel-clear-home-'), project: tmp('keel-clear-work-') };
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ pc: 'testpc', user: 't@x.y', wallet_default: 'subscription', history_days: 3650 }));
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
  write(path.join(out, 'meta', 'settings.json'), { language: 'uk', schema: 1 });
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

test('plan: the summary names the period, machines, sessions and dollars; meta stays; versions come from the sync state or --version', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  savedPage(out);
  write(path.join(w.dir, 'sync-state.json'), { docs: { '2026-01-01_testpc': { version: 3, hash: 'h' }, '2026-01-01_testpc_p2': { version: 1, hash: 'h' }, 'machines/testpc': { version: 7, hash: 'h' }, 'calib/testpc': { version: 2, hash: 'h' } }, pending: {} });
  const first = JSON.parse(w.run(CLEAR, ['plan', '--in', out]));
  assert.deepEqual(first.summary, {
    documents: 5, day_documents: 3, first_day: '2026-01-01', last_day: '2026-01-05', days_with_data: 2,
    machines: ['office', 'testpc'], sessions: 3, sessions_usd: 3.75, all_usd: 8, calibration_documents: 1, kilobytes: first.summary.kilobytes,
  });
  assert.deepEqual(first.missing_versions, ['2026-01-05_office'], 'another machine\'s day: its version is not known here');
  assert.equal(first.batches, undefined, 'nothing is deleted before every version is known');
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--in', out, '--version', 'days/2026-01-05_office=4']));
  assert.equal(plan.missing_versions, undefined);
  assert.deepEqual(plan.batches.flatMap((b) => b.writes), [
    { op: 'delete', collection: 'days', doc_id: '2026-01-01_testpc', if_version: 3 },
    { op: 'delete', collection: 'days', doc_id: '2026-01-01_testpc_p2', if_version: 1 },
    { op: 'delete', collection: 'days', doc_id: '2026-01-05_office', if_version: 4 },
    { op: 'delete', collection: 'machines', doc_id: 'testpc', if_version: 7 },
    { op: 'delete', collection: 'calib', doc_id: 'testpc', if_version: 2 },
  ]);
});

test('plan: more than 50 documents are split into batches of at most 50 deletes', () => {
  const w = world();
  const out = tmp('keel-clear-out-');
  const docs = {};
  for (let i = 0; i < 120; i++) {
    const id = `2026-01-${String(1 + (i % 28)).padStart(2, '0')}_pc${i}`;
    write(path.join(out, 'days', `${id}.json`), { date: id.slice(0, 10), pc: `pc${i}`, hours: [], sessions: [] });
    docs[id] = { version: 1, hash: 'h' };
  }
  write(path.join(w.dir, 'sync-state.json'), { docs, pending: {} });
  const plan = JSON.parse(w.run(CLEAR, ['plan', '--in', out]));
  assert.deepEqual(plan.batches.map((b) => b.writes.length), [50, 50, 20]);
});

test('done: this machine forgets the sent documents and the next sync sends nothing from before the clear', () => {
  const w = world();
  buildSession(w.root);
  const prepare = () => JSON.parse(w.run(USAGE, ['prepare', '--project', w.project])).batches.flatMap((b) => b.writes);
  assert.ok(prepare().some((x) => x.doc_id === '2026-01-01_testpc'), 'before: the old day is sent');
  w.run(USAGE, ['ack']);
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

test('usage-clear skill: user-only, warns with the period and the effects, deletes only after a yes, then resets', () => {
  const text = fs.readFileSync(path.join(PLUGIN, 'skills', 'usage-clear', 'SKILL.md'), 'utf8');
  assert.match(text, /^disable-model-invocation: true$/m);
  assert.match(text, /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/usage-setup\.js" "\$\{CLAUDE_PROJECT_DIR\}" show`$/m);
  for (const sub of ['start --project', 'plan --in', 'done']) assert.ok(text.includes(`usage-clear.js" ${sub}`), sub);
  assert.match(text, /`first_day` to `last_day`/);
  assert.match(text, /it cannot be undone/);
  assert.match(text, /"No, keep\s+it" first/);
  assert.match(text, /Only an explicit yes goes on/);
  assert.match(text, /never read the saved files/);
  assert.ok(text.indexOf('Only an explicit yes') < text.indexOf('action: "batch"'), 'the question comes before any delete');
  assert.ok(text.indexOf('action: "batch"') < text.indexOf('usage-clear.js" done'), 'the reset comes after the deletes');
});
