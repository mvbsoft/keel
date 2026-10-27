'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const CLI = path.join(PLUGIN, 'scripts', 'usage.js');
const store = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-store.js'));
const { batches } = require(CLI);
const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'), 'utf8'));
const { buildSession, SESSION_ID } = require('./fixtures/transcripts.js');
const { writeSession, appendRequest } = require('./fixtures/usage.js');

const MIN = 60000;
const HOUR = 3600000;
const tmp = tempDir;
const iso = (ms) => new Date(ms).toISOString();

// A private world: usage dir, transcripts root, home (no price override), project folder.
function world(usage = {}) {
  const w = { dir: tmp('keel-cli-usage-'), root: tmp('keel-cli-proj-'), home: tmp('keel-cli-home-'), project: tmp('keel-cli-work-') };
  w.out = path.join(w.project, '.keel', 'local', 'usage', 'out');
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ pc: 'testpc', user: 't@x.y', wallet_default: 'subscription', ...usage }));
  w.run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, KEEL_USAGE_DIR: w.dir, KEEL_PROJECTS_DIR: w.root, HOME: w.home, USERPROFILE: w.home, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: '', ...extraEnv },
    });
    assert.equal(r.status, 0, r.stderr);
    w.stderr = r.stderr;
    return r.stdout.trim();
  };
  w.prepare = (...more) => JSON.parse(w.run(['prepare', '--out', w.out, '--project', w.project, ...more]));
  return w;
}

const writesOf = (spec) => spec.batches.flatMap((b) => b.writes);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
// Bundled price of claude-opus-4*: $5 per million input tokens.
const OPUS = 'claude-opus-4-test';
const opusReq = (t, dollars) => ({ t, model: OPUS, tok: { in: (dollars / 5) * 1e6 } });

test('batches: at most 50 writes and 1 000 000 bytes each', () => {
  const w = (i, bytes) => ({ op: 'set', doc_id: `d${i}`, bytes });
  const b = batches(Array.from({ length: 120 }, (_, i) => w(i, 10)));
  assert.deepEqual(b.map((x) => x.writes.length), [50, 50, 20]);
  assert.ok(b[0].writes.every((x) => !('bytes' in x)));
  const c = batches([w(1, 600000), w(2, 600000), w(3, 300000), w(4, 300000), w(5, 500000)]);
  assert.deepEqual(c.map((x) => x.writes.map((y) => y.doc_id)), [['d1'], ['d2', 'd3'], ['d4', 'd5']]);
  assert.deepEqual(batches([]), []);
});

test('prepare: writes day documents and the machine document, prints the batch spec', () => {
  const w = world();
  buildSession(w.root);
  const spec = w.prepare();
  assert.equal(spec.artifact_url, null);
  const writes = writesOf(spec);
  assert.deepEqual(writes.map((x) => [x.op, x.collection, x.doc_id]), [['set', 'days', '2026-01-01_testpc'], ['set', 'machines', 'testpc']]);
  for (const x of writes) {
    assert.ok(path.isAbsolute(x.file_path) && fs.existsSync(x.file_path));
    assert.ok(!('if_version' in x));
  }
  const day = read(writes[0].file_path);
  assert.deepEqual(validate(day, SCHEMA), []);
  assert.equal(day.user, 't@x.y');
  const machine = read(writes[1].file_path);
  assert.deepEqual([machine.name, machine.user, machine.wallet_default], ['testpc', 't@x.y', 'subscription']);
  assert.ok(Date.parse(machine.synced_until) > 0 && machine.last_seen === machine.synced_until);
  assert.equal(fs.existsSync(path.join(w.dir, 'sync-state.json')), true);
});

// Changed on purpose: the committed project URL used to win without any check, so a cloned repo chose where this
// machine's usage data went. Now it is used only after the user approved that exact URL on this machine.
test('prepare: the artifact url comes from the flag, machine config, then an approved project url', () => {
  const w = world();
  buildSession(w.root);
  assert.equal(w.prepare().artifact_url, null);
  fs.mkdirSync(path.join(w.project, '.keel'), { recursive: true });
  fs.writeFileSync(path.join(w.project, '.keel', 'config.json'), JSON.stringify({ usage: { artifact_url: 'https://claude.ai/artifact/proj' } }));
  const open = w.prepare();
  assert.equal(open.artifact_url, null, 'a repo url nobody approved is not used');
  assert.equal(open.not_approved, 'https://claude.ai/artifact/proj');
  assert.match(open.note, /not approved on this machine/);
  assert.equal(read(path.join(w.dir, 'sync-state.json')).artifact_url, null, 'and not remembered');
  assert.equal(w.prepare().artifact_url, null, 'still not used on the next run');
  const user = { pc: 'testpc', user: 't@x.y' };
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ ...user, approved_artifact_urls: ['https://claude.ai/artifact/other'] }));
  assert.equal(w.prepare().artifact_url, null, 'approving a different url does not help');
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ ...user, approved_artifact_urls: ['https://claude.ai/artifact/proj'] }));
  const ok = w.prepare();
  assert.equal(ok.artifact_url, 'https://claude.ai/artifact/proj');
  assert.ok(!('not_approved' in ok));
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ ...user, artifact_url: 'https://claude.ai/artifact/machine' }));
  assert.equal(w.prepare().artifact_url, 'https://claude.ai/artifact/machine');
  assert.equal(w.prepare('--artifact', 'https://claude.ai/artifact/flag').artifact_url, 'https://claude.ai/artifact/flag');
});

test('ack then prepare: committed documents are skipped, versions become if_version', () => {
  const w = world();
  const s = buildSession(w.root);
  const first = writesOf(w.prepare());
  assert.equal(first.length, 2);
  const msg = w.run(['ack']);
  assert.match(msg, /ack: 2 documents recorded; synced until /);
  const state = read(path.join(w.dir, 'sync-state.json'));
  assert.deepEqual(Object.keys(state.docs).sort(), ['2026-01-01_testpc', 'machines/testpc']);
  assert.equal(state.docs['2026-01-01_testpc'].version, 1);
  assert.deepEqual(state.pending, {});
  // nothing changed: only the machine document (its synced_until moved) is written, with if_version 1
  const second = writesOf(w.prepare());
  assert.deepEqual(second.map((x) => [x.doc_id, x.if_version]), [['testpc', 1]]);
  w.run(['ack']);
  assert.equal(read(path.join(w.dir, 'sync-state.json')).docs['machines/testpc'].version, 2);
  // a new request in an old session: its day is rebuilt and written with if_version 1
  appendRequest(s.main, SESSION_ID, { t: Date.UTC(2026, 0, 1, 10, 30), model: 'test-opus-1', tok: { in: 5 } });
  const third = writesOf(w.prepare());
  assert.deepEqual(third.map((x) => [x.doc_id, x.if_version]), [['2026-01-01_testpc', 1], ['testpc', 2]]);
});

test('ack --failed keeps the document pending; prepare --version rewrites it with the version found', () => {
  const w = world();
  buildSession(w.root);
  w.prepare();
  const msg = w.run(['ack', '--failed', '2026-01-01_testpc']);
  assert.match(msg, /ack: 1 documents recorded/);
  assert.match(msg, /still pending: 2026-01-01_testpc/);
  assert.match(msg, /--version/);
  const state = read(path.join(w.dir, 'sync-state.json'));
  assert.deepEqual(Object.keys(state.pending), ['2026-01-01_testpc']);
  assert.equal(state.synced_until, null, 'synced_until does not move while a document is pending');
  const again = writesOf(w.prepare('--version', '2026-01-01_testpc=4'));
  assert.deepEqual(again.map((x) => [x.doc_id, x.if_version]), [['2026-01-01_testpc', 4], ['testpc', 1]]);
  assert.match(w.run(['ack']), /ack: 2 documents recorded; synced until/);
  assert.equal(read(path.join(w.dir, 'sync-state.json')).docs['2026-01-01_testpc'].version, 5);
  assert.equal(w.run(['ack']), 'ack: nothing was pending');
});

test('prepare: more than 50 documents are chunked into batches of at most 50 writes', () => {
  const w = world();
  for (let i = 0; i < 60; i++) {
    const t = Date.UTC(2026, 0, 1) + i * 24 * HOUR + 3 * HOUR;
    writeSession(w.root, { id: `chunk-${i}`, rows: [{ t, prompt: 'x' }, opusReq(t + MIN, 1)] });
  }
  const spec = w.prepare();
  assert.deepEqual(spec.batches.map((b) => b.writes.length), [50, 11]);
  assert.equal(writesOf(spec).length, 61);
  assert.ok(spec.batches.every((b) => b.writes.length <= 50));
});

test('prepare: keel fields from flags, the session\'s active task and changes.json', () => {
  const w = world();
  buildSession(w.root);
  const keelDir = path.join(w.project, '.keel');
  fs.mkdirSync(path.join(keelDir, 'local', 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(keelDir, 'local', 'active'), { recursive: true });
  fs.mkdirSync(path.join(keelDir, 'tasks', 'CAN-9'), { recursive: true });
  const taskFile = path.join(keelDir, 'tasks', 'CAN-9', 'task.md');
  const marker = path.join(keelDir, 'local', 'active', `${SESSION_ID}.json`);
  fs.writeFileSync(taskFile, '---\nid: CAN-9\ntitle: Fix the thing\nstatus: active\nplan: inline\n---\n\n# CAN-9: Fix the thing\n\n## Goal\nx\n');
  fs.writeFileSync(marker, JSON.stringify({ id: 'CAN-9' }));
  fs.writeFileSync(path.join(keelDir, 'local', 'tmp', 'changes.json'), JSON.stringify({ totals: { files: 3, added: 40, removed: 7 } }));
  const planFile = path.join(w.project, 'plan.md');
  fs.writeFileSync(planFile, '# plan\n\n### Step 1: First\n- files: `a.js`\n- model: sonnet\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ⬜\n');
  const spec = w.prepare('--session', SESSION_ID, '--level', 'standard', '--findings', '0/2/5', '--gates', 'pass');
  const day = read(writesOf(spec)[0].file_path);
  assert.deepEqual(day.sessions[0].keel, {
    task: 'CAN-9: Fix the thing', lines: { add: 40, del: 7 }, files: 3, level: 'standard', findings: { must: 0, should: 2, nice: 5 }, gates: 'pass',
  });
  assert.deepEqual(validate(day, SCHEMA), []);
  // the plan file named by the task supplies the steps
  fs.writeFileSync(taskFile, `---\nid: CAN-9\ntitle: Fix the thing\nplan: ${planFile}\n---\n\n# CAN-9: Fix the thing\n`);
  const keel = read(writesOf(w.prepare('--session', SESSION_ID))[0].file_path).sessions[0].keel;
  assert.equal(keel.task, 'CAN-9: Fix the thing');
  assert.deepEqual(keel.steps, [{ title: 'First', model: 'sonnet' }]);
  // the steps of an inline plan come from the task file itself
  fs.writeFileSync(taskFile, '---\nid: CAN-9\ntitle: Fix the thing\nplan: inline\n---\n\n## Plan\n### Step 1: Inline\n- files: `b.js`\n- model: haiku\n- effort: low\n- do: x\n- done when:\n  1. y\n- status: ✅\n');
  assert.deepEqual(read(writesOf(w.prepare('--session', SESSION_ID))[0].file_path).sessions[0].keel.steps, [{ title: 'Inline', model: 'haiku' }]);
  // a --keel file (only under .keel/local/) gives the base values, flags win; a session without an
  // active task has no task fields; fields keel does not record never leave the machine
  const file = path.join(keelDir, 'local', 'tmp', 'keel.json');
  fs.writeFileSync(file, JSON.stringify({ task: 'From file', level: 'basic', token: 'sk-secret', files: '7', lines: { add: 2, del: 1, x: 'y' } }));
  fs.rmSync(marker);
  const k2 = read(writesOf(w.prepare('--session', SESSION_ID, '--keel', file, '--level', 'maximum'))[0].file_path).sessions[0].keel;
  assert.equal(k2.task, 'From file');
  assert.equal(k2.level, 'maximum');
  assert.equal(k2.token, undefined, 'an unknown field is dropped');
  assert.deepEqual(k2.lines, { add: 2, del: 1 });
  // a file outside the project's .keel/local/ is not read at all (a credentials file leaked its token)
  const outside = path.join(w.project, 'credentials.json');
  fs.writeFileSync(outside, JSON.stringify({ task: 'Leaked', token: 'sk-secret' }));
  const k3 = read(writesOf(w.prepare('--session', SESSION_ID, '--keel', outside))[0].file_path).sessions[0].keel;
  assert.ok(!JSON.stringify(k3).includes('sk-secret') && !JSON.stringify(k3).includes('Leaked'));
});

test('prepare --feature: a planning chat records only its feature name, over an earlier task\'s fields', () => {
  const w = world();
  buildSession(w.root);
  fs.mkdirSync(path.join(w.project, '.keel', 'local', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(w.project, '.keel', 'local', 'tmp', 'changes.json'), JSON.stringify({ totals: { files: 3, added: 40, removed: 7 } }));
  w.prepare('--session', SESSION_ID, '--level', 'standard', '--findings', '0/2/5', '--gates', 'pass');
  const day = read(writesOf(w.prepare('--session', SESSION_ID, '--feature', 's3-connection'))[0].file_path);
  assert.deepEqual(day.sessions[0].keel, { task: 'planning: s3-connection', steps: [], level: null, findings: null, gates: null, lines: null, files: null });
  assert.deepEqual(validate(day, SCHEMA), []);
  assert.equal(w.stderr, '');
});

test('prepare --feature: an invalid or missing name is ignored with one line and records nothing', () => {
  const w = world();
  buildSession(w.root);
  fs.mkdirSync(path.join(w.project, '.keel', 'local', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(w.project, '.keel', 'local', 'tmp', 'changes.json'), JSON.stringify({ totals: { files: 3, added: 40, removed: 7 } }));
  for (const flag of [['--feature', 'Bad_Name'], ['--feature']]) {
    const day = read(writesOf(w.prepare('--session', SESSION_ID, ...flag))[0].file_path);
    assert.equal(day.sessions[0].keel, null, `${flag.join(' ')}: no keel fields, changes.json not used`);
    assert.equal(w.stderr, 'usage: --feature ignored (not a feature name)\n', 'the value is not echoed');
  }
  assert.equal(fs.existsSync(path.join(w.dir, 'keel-tasks.jsonl')), false);
});

test('prepare: with no keel data nothing is attached', () => {
  const w = world();
  buildSession(w.root);
  assert.equal(read(writesOf(w.prepare())[0].file_path).sessions[0].keel, null);
});

test('calibration is published as one more document, rewritten only when it changes', () => {
  const w = world();
  const now = Date.now();
  writeSession(w.root, { id: 'c1', cwd: w.project, projDir: store.projectFolderName(w.project), rows: [{ t: now - 3 * HOUR, prompt: 'x' }, opusReq(now - 150 * MIN, 10)] });
  const resets = iso(now + 3 * 24 * HOUR);
  const snap = (t, seven) => JSON.stringify({ t: iso(t), five_hour: null, five_hour_resets_at: null, seven_day: seven, seven_day_resets_at: resets, session_id: null, cost_usd: null, src: 'statusline' });
  fs.writeFileSync(path.join(w.dir, 'limits.jsonl'), [snap(now - 4 * HOUR, 10), snap(now - HOUR, 12)].join('\n') + '\n');
  assert.ok(!writesOf(w.prepare()).some((x) => x.collection === 'calib'), 'no calibration saved yet');
  w.run(['report', '--project', w.project]);
  const saved = read(path.join(w.dir, 'calib-latest.json'));
  assert.deepEqual([saved.pc, saved.weekly.rate, saved.weekly.n, saved.five_hour.rate, saved.waiting], ['testpc', 5, 1, null, []]);
  assert.equal(saved.weekly.points.length, 1);
  assert.ok(Date.parse(saved.computed_at) > 0 && Date.parse(saved.weekly.points[0].from) > 0);
  const first = writesOf(w.prepare());
  const calib = first.find((x) => x.collection === 'calib');
  assert.equal(calib.doc_id, 'testpc');
  assert.deepEqual(read(calib.file_path), saved);
  assert.ok(!('if_version' in calib));
  w.run(['ack']);
  assert.equal(read(path.join(w.dir, 'sync-state.json')).docs['calib/testpc'].version, 1);
  // the same calibration again (only computed_at differs) is not written; a new rate is, with if_version 1
  w.run(['calibrate']);
  assert.ok(!writesOf(w.prepare()).some((x) => x.collection === 'calib'));
  fs.appendFileSync(path.join(w.dir, 'limits.jsonl'), snap(now - 30 * MIN, 14) + '\n');
  w.run(['calibrate']);
  const next = writesOf(w.prepare()).find((x) => x.collection === 'calib');
  assert.equal(next.if_version, 1);
  assert.equal(read(next.file_path).weekly.points.length, 2);
});

// --- report ---

// A session that ran from 3 h to 2 h ago and cost $10 (opus: $5 per million input tokens).
function reportWorld({ usage, wallet, model = OPUS, extraRows = [] } = {}) {
  const w = world(usage);
  const now = Date.now();
  const start = now - 3 * HOUR;
  const id = 'rep-1';
  writeSession(w.root, {
    id, cwd: w.project, projDir: store.projectFolderName(w.project),
    rows: [{ t: start, prompt: 'cheap first question' }, { t: start + MIN, model, tok: { in: 2e6 } },
      { t: start + 10 * MIN, prompt: 'the expensive second question' }, { t: start + 11 * MIN, model, tok: { in: 2e6 } }, ...extraRows],
  });
  if (wallet) fs.writeFileSync(path.join(w.dir, 'sessions.jsonl'), JSON.stringify({ session_id: id, wallet }) + '\n');
  const resets = iso(now + 3 * 24 * HOUR);
  const snap = (t, five, seven, extra = {}) => JSON.stringify({ t: iso(t), five_hour: five, five_hour_resets_at: iso(now + 2 * HOUR), seven_day: seven, seven_day_resets_at: resets, session_id: null, cost_usd: null, src: 'statusline', ...extra });
  w.snaps = (list) => fs.writeFileSync(path.join(w.dir, 'limits.jsonl'), list.join('\n') + '\n');
  w.now = now;
  w.start = start;
  w.snap = snap;
  w.report = (...more) => w.run(['report', '--project', w.project, ...more]);
  return w;
}

test('report: subscription with calibration shows participants, share of both limits and the account change', () => {
  const w = reportWorld();
  const { now, start, snap } = w;
  w.snaps([
    snap(now - 4 * HOUR, 10, 10), snap(start + 5 * MIN, 12, 10.5), snap(start + 8 * MIN, 14, 10.8), snap(now - HOUR, 30, 12),
  ]);
  const text = w.report();
  assert.match(text, /^usage report: session rep-1/);
  assert.match(text, /wallet subscription/);
  assert.match(text, /^\| who \| requests \| in \| cache write \| cache read \| out \| \$ \|$/m, 'the costs are a markdown table');
  assert.match(text, /^\| main \(claude-opus-4-test\) \| 2 \| 4\.00M \| 0 \| 0 \| 0 \| \$20\.00 \|$/m, 'one participant: no share column');
  assert.match(text, /^\| \*\*total\*\* \| 2 \| 4\.00M \| 0 \| 0 \| 0 \| \*\*\$20\.00\*\* \|$/m);
  assert.doesNotMatch(text, /\| agent /, 'no agent ran: no agent rows');
  assert.match(text, /time: 11 min, active 2 min/);
  assert.match(text, /user turns: 2/);
  assert.match(text, /top turns by cost:\n1\. \$10\.00 \(1 request\) "cheap first question"\n2\. \$10\.00/);
  // week: gain 2 % for $20 -> 1 % = $10, the session ($20) is 2.0 %; 5-hour: gain 20 % -> 1 % = $1, 20.0 %... both in one window
  assert.match(text, /week: about 2\.0 % of the weekly limit \(1 % = about \$10\.00, 1 point\)/);
  assert.match(text, /5-hour: about 20\.0 % of the 5-hour limit \(1 % = about \$1\.00, 1 point\)/);
  assert.match(text, /account week limit during the session: 10\.5 → 10\.8 %/);
  assert.match(text, /account 5-hour limit during the session: 12 → 14 %/);
  assert.doesNotMatch(text, /unpriced|new model|cross-check/);
});

test('report: agents that ran get rows with their share; an agent without requests has none', () => {
  const { renderReport } = require(CLI);
  const { translator } = require(path.join(PLUGIN, 'scripts', 'lib', 'i18n.js'));
  const tok = (n) => ({ in: n, cw5: 0, cw1h: 0, cr: 0, out: 0 });
  const summary = {
    id: 'rep-agents', project: 'p', entrypoint: null, usd: 4, duration_min: 10, active_min: 5, turns: [], unpriced: [],
    participants: [
      { kind: 'main', model: 'opus', requests: 3, tok: tok(1000), usd: 3 },
      { kind: 'agent', type: 'reviewer', model: 'haiku', requests: 2, tok: tok(500), usd: 1 },
      { kind: 'agent', type: 'judge', model: 'opus', requests: 0, tok: tok(0), usd: 0 },
    ],
  };
  const text = renderReport({ t: translator('en'), summary, wallet: 'api', cal: null, snapshots: [], cc: null });
  assert.match(text, /^\| main \(opus\) \| 3 \| 1k \| 0 \| 0 \| 0 \| \$3\.00 \(75 %\) \|$/m);
  assert.match(text, /^\| agent reviewer \(haiku\) \| 2 \| 500 \| 0 \| 0 \| 0 \| \$1\.00 \(25 %\) \|$/m);
  assert.doesNotMatch(text, /judge/);
  assert.match(text, /^\| \*\*total\*\* \| 5 \| 2k \| 0 \| 0 \| 0 \| \*\*\$4\.00\*\* \|$/m);
});

test('report: a | in an agent type or model name is escaped, so the table keeps its columns', () => {
  const { renderReport } = require(CLI);
  const { translator } = require(path.join(PLUGIN, 'scripts', 'lib', 'i18n.js'));
  const tok = (n) => ({ in: n, cw5: 0, cw1h: 0, cr: 0, out: 0 });
  const summary = {
    id: 'rep-pipe', project: 'p', entrypoint: null, usd: 1, duration_min: 1, active_min: 1, turns: [], unpriced: [],
    participants: [{ kind: 'main', model: 'op|us', requests: 1, tok: tok(1), usd: 0.5 }, { kind: 'agent', type: 'a|b', model: 'x', requests: 1, tok: tok(1), usd: 0.5 }],
  };
  const text = renderReport({ t: translator('en'), summary, wallet: 'api', cal: null, snapshots: [], cc: null });
  const rows = text.split('\n').filter((l) => l.startsWith('| main') || l.startsWith('| agent'));
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.split(/(?<!\\)\|/).length - 2, 7, r);
  assert.ok(rows[1].includes('agent a\\|b (x)'));
  // a backslash before | would turn the escape back into a column break; control characters go
  const tricky = { ...summary, participants: [summary.participants[0], { ...summary.participants[1], type: 'a\\|b\u001b[31m' }] };
  const row = renderReport({ t: translator('en'), summary: tricky, wallet: 'api', cal: null, snapshots: [], cc: null }).split('\n').find((l) => l.startsWith('| agent'));
  assert.ok(row.includes('agent a\\\\\\|b [31m (x)'), row);
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 7, row);
  assert.ok(!row.includes('\u001b'));
});

test('report: no snapshots means no calibration and no invented number', () => {
  const w = reportWorld();
  const text = w.report();
  assert.match(text, /no calibration yet — it appears after a few sessions with the status line or desktop snapshots/);
  assert.doesNotMatch(text, /about [\d.]+ %/);
});

test('report: an api or credit wallet has no percentages; an unknown wallet neither', () => {
  for (const [wallet, pattern] of [['api', /wallet api: real money/], ['credit', /wallet credit: paid from prepaid credit/]]) {
    const w = reportWorld({ wallet });
    w.snaps([w.snap(w.now - 4 * HOUR, 10, 10), w.snap(w.now - HOUR, 30, 12)]);
    const text = w.report();
    assert.match(text, pattern);
    assert.doesNotMatch(text, /about [\d.]+ %|no calibration|account week/);
  }
  const u = reportWorld({ usage: { also_api: true } });
  assert.match(u.report(), /wallet unknown/);
  assert.doesNotMatch(u.report(), /about [\d.]+ %/);
});

test('report: a model without a price is named and counts nothing', () => {
  const w = reportWorld({ model: 'mystery-model-9' });
  const text = w.report();
  assert.match(text, /new model without a price \(mystery-model-9\) — run price update: \/keel:configure prices/);
  assert.match(text, /^\| \*\*total\*\* \| 2 \|.*\*\*\$0\.00\*\* \|$/m);
});

test('report: the cross-check line appears only when Claude Code\'s own total differs by more than 10 %', () => {
  const w = reportWorld();
  w.snaps([w.snap(w.start + 5 * MIN, 1, 1, { session_id: 'rep-1', cost_usd: 30 })]);
  assert.match(w.report(), /cross-check: our estimate \$20\.00, Claude Code's own total \$30\.00/);
  w.snaps([w.snap(w.start + 5 * MIN, 1, 1, { session_id: 'rep-1', cost_usd: 21 })]);
  assert.doesNotMatch(w.report(), /cross-check/);
});

test('report: Ukrainian text with --lang uk', () => {
  const w = reportWorld();
  const text = w.report('--lang', 'uk');
  assert.match(text, /^звіт про витрати: сесія rep-1/);
  assert.match(text, /калібрування ще немає/);
  assert.match(text, /ходів користувача: 2/);
  assert.match(text, /^\| хто \| запитів \| вхід \| запис кешу \| читання кешу \| вихід \| \$ \|$/m);
  assert.match(text, /^\| \*\*разом\*\* \|/m);
});

test('report: --session picks a session by id and prompt previews can be switched off', () => {
  const w = reportWorld({ usage: { prompt_preview: false } });
  const text = w.run(['report', '--session', 'rep-1']);
  assert.match(text, /session rep-1/);
  assert.match(text, /\(no preview\)/);
  assert.doesNotMatch(text, /cheap first question/);
  assert.match(w.run(['report', '--session', 'nope']), /no session found/);
});

test('report: a remote machine that has not synced holds calibration back until its synced_until passes', () => {
  const w = reportWorld();
  const { now, start, snap } = w;
  w.snaps([snap(now - 4 * HOUR, null, 10), snap(now - HOUR, null, 12)]);
  const inDir = tmp('keel-cli-in-');
  fs.mkdirSync(path.join(inDir, 'days'));
  const hour = Math.floor((now - 2 * HOUR) / HOUR) * HOUR;
  const remote = (syncedUntil) => ({
    schema: 1, date: iso(hour).slice(0, 10), pc: 'otherpc', user: null, part: 1, parts: 1, synced_until: syncedUntil, snapshots: [], sessions: [],
    hours: [{ h: iso(hour), wallet: 'subscription', usd: 10, req: 5, tok: { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: { [OPUS]: 10 } }],
  });
  const file = path.join(inDir, 'days', `${iso(hour).slice(0, 10)}_otherpc.json`);
  fs.writeFileSync(file, JSON.stringify({ version: 3, data: remote(iso(now - 5 * HOUR)) }));
  const waiting = w.report('--in', inDir);
  assert.match(waiting, /calibration waits for the sync of: otherpc/);
  assert.match(waiting, /no calibration yet/);
  assert.match(w.run(['calibrate', '--in', inDir]), /waiting for a machine to sync[\s\S]*machines still to sync: otherpc/);
  // once it has synced past the window, its $10 joins ours ($20 in 2 % -> 1 % = $15)
  fs.writeFileSync(file, JSON.stringify(remote(iso(now))));
  const done = w.report('--in', inDir);
  assert.doesNotMatch(done, /waits for the sync/);
  assert.match(done, /week: about 1\.3 % of the weekly limit \(1 % = about \$15\.00, 1 point\)/);
  // a machine document alone also counts as a known machine
  fs.rmSync(file);
  fs.mkdirSync(path.join(inDir, 'machines'));
  fs.writeFileSync(path.join(inDir, 'machines', 'otherpc.json'), JSON.stringify({ doc: { name: 'otherpc', user: null, wallet_default: 'subscription', synced_until: iso(start), last_seen: iso(start) } }));
  assert.match(w.report('--in', inDir), /calibration waits for the sync of: otherpc/);
});

test('snapshot: records desktop percentages and the log feeds the report', () => {
  const w = world();
  const resets = iso(Date.now() + 86400000);
  const out = w.run(['snapshot', '--src', 'desktop', '--five-hour', '12.5', '--seven-day', '40', '--seven-day-resets', resets, '--session', 'abc']);
  assert.match(out, /snapshot recorded: 5-hour 12.5 %, week 40 %/);
  const lines = fs.readFileSync(path.join(w.dir, 'limits.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([lines[0].five_hour, lines[0].seven_day, lines[0].seven_day_resets_at, lines[0].session_id, lines[0].src], [12.5, 40, resets, 'abc', 'desktop']);
  assert.match(w.run(['snapshot', '--five-hour', '12.5', '--seven-day', '40', '--seven-day-resets', resets, '--session', 'abc']), /unchanged/);
  assert.match(w.run(['snapshot']), /give --five-hour/);
});

test('unknown command and handled errors print one line and exit 0', () => {
  const w = world();
  assert.match(w.run([]), /^usage: node usage\.js prepare/);
  assert.match(w.run(['report', '--project', w.project]), /no session found/);
  assert.equal(w.run(['ack']), 'ack: nothing was pending');
});

test('prepare --version days/<id>=3 is the same as --version <id>=3', () => {
  const a = world();
  buildSession(a.root);
  a.prepare();
  a.run(['ack', '--failed', '2026-01-01_testpc']);
  const b = world();
  buildSession(b.root);
  b.prepare();
  b.run(['ack', '--failed', '2026-01-01_testpc']);
  const bare = writesOf(a.prepare('--version', '2026-01-01_testpc=4'));
  const prefixed = writesOf(b.prepare('--version', 'days/2026-01-01_testpc=4'));
  assert.deepEqual(prefixed.map((x) => [x.doc_id, x.if_version]), [['2026-01-01_testpc', 4], ['testpc', 1]]);
  assert.deepEqual(prefixed.map((x) => [x.doc_id, x.if_version]), bare.map((x) => [x.doc_id, x.if_version]));
});

// --- other machines: same user only ---

test('loadRemote: only machines of the same user count; unknown users count, everyone counts without a local user', () => {
  const { loadRemote } = require(CLI);
  const inDir = tmp('keel-cli-users-');
  fs.mkdirSync(path.join(inDir, 'days'));
  const hour = (pc, user) => ({ schema: 1, date: '2026-03-03', pc, user, part: 1, parts: 1, synced_until: '2026-03-03T12:00:00.000Z', snapshots: [{ t: '2026-03-03T10:00:00.000Z', seven_day: 5, five_hour: 1, session_id: pc }], sessions: [],
    hours: [{ h: '2026-03-03T10:00:00.000Z', wallet: 'subscription', usd: 10, req: 1, tok: {}, by_model: { m: 10 } }] });
  for (const [pc, user] of [['mine', 'Me@X.Y'], ['rival', 'other@x.y'], ['anon', null], ['local', 'me@x.y']]) {
    fs.writeFileSync(path.join(inDir, 'days', `${pc}.json`), JSON.stringify({ data: hour(pc, user) }));
  }
  fs.mkdirSync(path.join(inDir, 'machines'));
  fs.writeFileSync(path.join(inDir, 'machines', 'rival2.json'), JSON.stringify({ doc: { name: 'rival2', user: 'other@x.y', synced_until: '2026-03-03T00:00:00.000Z', last_seen: '2026-03-03T00:00:00.000Z' } }));
  fs.writeFileSync(path.join(inDir, 'machines', 'mine2.json'), JSON.stringify({ doc: { name: 'mine2', user: 'me@x.y', synced_until: '2026-03-03T00:00:00.000Z', last_seen: '2026-03-04T00:00:00.000Z' } }));
  const r = loadRemote(inDir, 'local', 'me@x.y');
  assert.deepEqual(r.machines.map((m) => m.pc).sort(), ['anon', 'mine', 'mine2']);
  assert.deepEqual(r.hours.map((h) => h.pc).sort(), ['anon', 'mine']);
  assert.deepEqual(r.snapshots.map((s) => s.session_id).sort(), ['anon', 'mine'], 'another account limits are not mixed in');
  assert.equal(r.machines.find((m) => m.pc === 'mine2').last_seen, '2026-03-04T00:00:00.000Z');
  assert.deepEqual(loadRemote(inDir, 'local', null).machines.map((m) => m.pc).sort(), ['anon', 'mine', 'mine2', 'rival', 'rival2']);
});

test('report: a machine of another user never holds calibration back or adds its spend', () => {
  const w = reportWorld();
  const { now, snap } = w;
  w.snaps([snap(now - 4 * HOUR, null, 10), snap(now - HOUR, null, 12)]);
  const inDir = tmp('keel-cli-in-');
  fs.mkdirSync(path.join(inDir, 'days'));
  const hour = Math.floor((now - 2 * HOUR) / HOUR) * HOUR;
  const remote = (user) => ({ schema: 1, date: iso(hour).slice(0, 10), pc: 'otherpc', user, part: 1, parts: 1, synced_until: iso(now - 5 * HOUR), snapshots: [], sessions: [],
    hours: [{ h: iso(hour), wallet: 'subscription', usd: 10, req: 5, tok: { in: 0, cw5: 0, cw1h: 0, cr: 0, out: 0 }, by_model: { [OPUS]: 10 } }] });
  const file = path.join(inDir, 'days', 'otherpc.json');
  fs.writeFileSync(file, JSON.stringify({ data: remote('someone@else.org') }));
  const text = w.report('--in', inDir);
  assert.doesNotMatch(text, /waits for the sync/);
  assert.match(text, /1 % = about \$10\.00/, 'only our own $20 for the 2 % gained');
  fs.writeFileSync(file, JSON.stringify({ data: remote('t@x.y') }));
  assert.match(w.report('--in', inDir), /calibration waits for the sync of: otherpc/);
});

test('calibration document keeps at most the newest 200 points per kind', () => {
  const w = world();
  const now = Date.now();
  const lines = [];
  for (let p = 0; p < 3; p++) {
    const resets = iso(now + (p + 1) * 24 * HOUR);
    for (let i = 1; i <= 90; i++) {
      lines.push(JSON.stringify({ t: iso(now - (30 - p * 10) * 24 * HOUR + i * MIN), five_hour: null, five_hour_resets_at: null, seven_day: i, seven_day_resets_at: resets, session_id: null, cost_usd: null, src: 'statusline' }));
    }
  }
  fs.writeFileSync(path.join(w.dir, 'limits.jsonl'), lines.join('\n') + '\n');
  w.run(['calibrate']);
  const saved = read(path.join(w.dir, 'calib-latest.json'));
  assert.equal(saved.weekly.points.length, 200);
  const stamps = saved.weekly.points.map((p) => Date.parse(p.to));
  assert.deepEqual(stamps, [...stamps].sort((a, b) => a - b));
  assert.ok(stamps[stamps.length - 1] > now - 10 * 24 * HOUR, 'the newest points are the ones kept');
});

// --- batches are acked one by one ---

test('ack --batch: a failed second batch does not make the next prepare resend the first', () => {
  const w = world({ artifact_url: 'https://claude.ai/artifact/x', history_days: 90 });
  const DAYMS = 86400000;
  const base = Date.now() - 70 * DAYMS;
  for (let i = 0; i < 60; i++) {
    writeSession(w.root, { id: `d${String(i).padStart(2, '0')}`, rows: [{ t: base + i * DAYMS, prompt: 'x' }, opusReq(base + i * DAYMS + 1000, 1)] });
  }
  const first = w.prepare();
  assert.equal(first.batches.length, 2);
  const sizes = first.batches.map((b) => b.writes.length);
  assert.equal(sizes[0], 50);
  const state = () => read(path.join(w.dir, 'sync-state.json'));
  assert.match(w.run(['ack', '--batch', '1']), /^ack: 50 documents recorded/m);
  assert.equal(Object.keys(state().docs).length, 50);
  assert.equal(state().synced_until, null, 'batch 2 is still unwritten');
  assert.match(w.run(['ack', '--batch', '9']), /no pending batch 9/);
  // batch 2 failed; prepare again sends only what is left, with the right versions
  const second = w.prepare();
  const keys = second.batches.flatMap((b) => b.writes.map((x) => `${x.collection}/${x.doc_id}`));
  assert.equal(keys.length, sizes[1], 'only the unwritten documents');
  const firstKeys = new Set(first.batches[0].writes.map((x) => `${x.collection}/${x.doc_id}`));
  assert.ok(keys.every((k) => !firstKeys.has(k)), 'nothing from batch 1 again');
  assert.ok(second.batches.flatMap((b) => b.writes).every((x) => !x.if_version || x.collection === 'machines'));
  w.run(['ack', '--batch', '1']);
  assert.notEqual(state().synced_until, null);
  assert.deepEqual(state().pending, {});
});

test('usage-sync.md: reads as many days of other machines as the calibration looks back, and acks per batch', () => {
  const md = fs.readFileSync(path.join(PLUGIN, 'skills', '_shared', 'usage-sync.md'), 'utf8');
  assert.match(md, /today minus 35 days/);
  assert.doesNotMatch(md, /today minus 7 days/);
  assert.match(md, /ack --batch <n>/);
});

test('prepare: --out only under the project\'s .keel/local/usage/; it removes only the files it wrote itself', () => {
  const w = world();
  buildSession(w.root);
  const trashed = path.join(w.project, '.keel', 'local', 'trash', '20261001-100000', 'files', 'kept.json');
  fs.mkdirSync(path.dirname(trashed), { recursive: true });
  fs.writeFileSync(trashed, '{}');
  for (const out of [path.join(w.project, '.keel', 'local', 'trash', '20261001-100000', 'files'), path.join(w.project, '.keel', 'local'), w.home]) {
    assert.match(w.run(['prepare', '--out', out, '--project', w.project]), /^usage: error: --out must be a folder inside /, out);
  }
  assert.ok(fs.existsSync(trashed), 'a trashed file is never removed');
  const first = writesOf(w.prepare());
  assert.ok(first.length);
  for (const name of ['mine.json', '2026-01-02_otherpc.json']) fs.writeFileSync(path.join(w.out, name), '{}');
  w.prepare();
  assert.ok(fs.existsSync(path.join(w.out, 'mine.json')) && fs.existsSync(path.join(w.out, '2026-01-02_otherpc.json')), 'files prepare did not write stay');
  assert.deepEqual(read(path.join(w.out, 'written.json')).sort(), fs.readdirSync(w.out, { recursive: true }).map((f) => String(f).split(path.sep).join('/')).filter((f) => f.endsWith('.json') && !['mine.json', '2026-01-02_otherpc.json', 'written.json'].includes(f)).sort());
});

test('prepare: day documents sent before only keel sessions were listed are rebuilt once, back to the first day sent', () => {
  const w = world({ history_days: 3650 });
  const s = buildSession(w.root);
  writeSession(w.root, { id: 'plain', keel: false, rows: [{ t: Date.UTC(2026, 0, 1, 11), prompt: 'hi' }, opusReq(Date.UTC(2026, 0, 1, 11, 1), 1)] });
  const old = new Date(Date.UTC(2026, 0, 2));
  for (const f of [s.main, ...Object.values(s.agentFiles), path.join(w.root, 'proj-test', 'plain.jsonl')]) fs.utimesSync(f, old, old);
  const first = writesOf(w.prepare());
  const day = read(first.find((x) => x.doc_id === '2026-01-01_testpc').file_path);
  assert.deepEqual(day.sessions.map((x) => x.id), [SESSION_ID], 'the session without keel commands is not listed');
  assert.ok(day.hours.some((h) => h.by_model[OPUS]), 'but its spend is in the hours');
  w.run(['ack']);
  const file = path.join(w.dir, 'sync-state.json');
  assert.equal(read(file).sessions_rule, 'keel');
  assert.deepEqual(writesOf(w.prepare()).map((x) => x.doc_id), ['testpc'], 'nothing changed: no day is rebuilt');
  w.run(['ack']);
  // A state an older keel wrote: no rule, and a day document that listed every session.
  const state = read(file);
  delete state.sessions_rule;
  state.docs['2026-01-01_testpc'].hash = 'listed every session';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.deepEqual(writesOf(w.prepare()).map((x) => x.doc_id), ['2026-01-01_testpc', 'testpc']);
  w.run(['ack']);
  assert.equal(read(file).sessions_rule, 'keel');
  assert.deepEqual(writesOf(w.prepare()).map((x) => x.doc_id), ['testpc'], 'only once');
});

// --- the page's template: meta/settings read back by the sync ---

const SETUP = path.join(PLUGIN, 'scripts', 'usage-setup.js');
const { pageTemplate } = require(SETUP);
const metaIn = (doc) => {
  const inDir = tmp('keel-cli-in-');
  if (doc !== undefined) {
    fs.mkdirSync(path.join(inDir, 'meta'));
    fs.writeFileSync(path.join(inDir, 'meta', 'settings.json'), JSON.stringify(doc));
  }
  return inDir;
};
const machineFile = (w) => read(path.join(w.dir, 'usage.json'));

test("report --in: the page's template becomes this machine's page_template, and show then offers nothing", () => {
  const now = pageTemplate();
  const w = world({ artifact_url: 'https://claude.ai/artifact/x', page_template: 'aaaaaaaaaaaa' });
  w.run(['report', '--project', w.project, '--in', metaIn({ language: 'uk', schema: 1, template: now })]);
  assert.equal(machineFile(w).page_template, now);
  assert.equal(machineFile(w).pc, 'testpc', 'the other settings stay');
  const show = spawnSync(process.execPath, [SETUP, w.project, 'show'], { encoding: 'utf8', env: { ...process.env, KEEL_USAGE_DIR: w.dir, KEEL_USER_SETTINGS: path.join(w.home, 'settings.json'), HOME: w.home, USERPROFILE: w.home } });
  assert.ok(show.stdout.split(/\r?\n/).includes(`page template: ${now} (this keel's)`), show.stdout);
});

test('report --in: the settings document may come wrapped, as the query saves it', () => {
  for (const doc of [{ version: 2, data: { language: 'en', template: '0123456789ab' } }, { doc: { schema: 1, template: '0123456789ab' } }]) {
    const w = world();
    w.run(['report', '--project', w.project, '--in', metaIn(doc)]);
    assert.equal(machineFile(w).page_template, '0123456789ab', JSON.stringify(doc));
  }
});

test("report --in: a page without a template (or a bad one) runs an older keel's page, so page_template is cleared", () => {
  for (const doc of [{ language: 'uk', schema: 1 }, { language: 'uk', template: 'not-a-print' }, { language: 'uk', template: 5 }]) {
    const w = world({ page_template: '0123456789ab' });
    w.run(['report', '--project', w.project, '--in', metaIn(doc)]);
    assert.equal(machineFile(w).page_template, null, JSON.stringify(doc));
  }
});

test('report: no settings document read, or no --in → page_template stays as it was', () => {
  for (const args of [['--in', metaIn()], ['--in', metaIn('not an object')], []]) {
    const w = world({ page_template: '0123456789ab' });
    w.run(['report', '--project', w.project, ...args]);
    assert.equal(machineFile(w).page_template, '0123456789ab', JSON.stringify(args));
  }
});

test('report --in: a machine that was never configured gets no usage.json from the page template', () => {
  const w = world();
  fs.rmSync(path.join(w.dir, 'usage.json'));
  w.run(['report', '--project', w.project, '--in', metaIn({ template: '0123456789ab' })]);
  assert.equal(fs.existsSync(path.join(w.dir, 'usage.json')), false);
});
