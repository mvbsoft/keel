'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const { recordSnapshot, snapshotFromPercents, readSnapshots } = require(path.join(PLUGIN, 'scripts', 'lib', 'limits.js'));

function tmp(prefix = 'keel-limits-') { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function lines(file) { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
function input(five, seven, extra = {}) {
  return {
    session_id: 's1',
    cost: { total_cost_usd: 1.25 },
    rate_limits: {
      five_hour: { used_percentage: five, resets_at: extra.fiveReset ?? 1000 },
      seven_day: { used_percentage: seven, resets_at: extra.sevenReset ?? '2026-10-14T00:00:00Z' },
      ...(extra.spend ? { spend_limit: extra.spend } : {}),
    },
  };
}

// --- limits.js ---

test('recordSnapshot: builds the snapshot and writes only when something changed', () => {
  const dir = tmp();
  const now = new Date('2026-10-11T10:00:00Z');
  const first = recordSnapshot(input(10, 20, { spend: { used: 1 } }), { src: 'statusline', dir, now });
  assert.deepEqual(first, {
    t: '2026-10-11T10:00:00.000Z', five_hour: 10, five_hour_resets_at: 1000, seven_day: 20,
    seven_day_resets_at: '2026-10-14T00:00:00Z', spend_limit: { used: 1 }, session_id: 's1', cost_usd: 1.25, src: 'statusline',
  });
  assert.equal(recordSnapshot(input(10, 20), { src: 'statusline', dir, now }), null, 'same values: nothing written');
  assert.ok(recordSnapshot(input(11, 20), { src: 'statusline', dir, now }), 'five_hour changed');
  assert.ok(recordSnapshot(input(11, 21), { src: 'statusline', dir, now }), 'seven_day changed');
  assert.equal(lines(path.join(dir, 'limits.jsonl')).length, 3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'limits-last.json'), 'utf8')).seven_day, 21);
});

test('recordSnapshot: a changed resets_at counts as a change', () => {
  const dir = tmp();
  assert.ok(recordSnapshot(input(5, 5), { dir }));
  assert.ok(recordSnapshot(input(5, 5, { fiveReset: 2000 }), { dir }), 'five-hour window rolled over');
  assert.ok(recordSnapshot(input(5, 5, { fiveReset: 2000, sevenReset: '2026-10-21T00:00:00Z' }), { dir }), 'weekly window rolled over');
  assert.equal(recordSnapshot(input(5, 5, { fiveReset: 2000, sevenReset: '2026-10-21T00:00:00Z' }), { dir }), null);
  assert.equal(lines(path.join(dir, 'limits.jsonl')).length, 3);
});

test('recordSnapshot: no rate_limits (API users) returns null and writes nothing', () => {
  const dir = tmp();
  assert.equal(recordSnapshot({ session_id: 's', cost: { total_cost_usd: 1 } }, { dir }), null);
  assert.equal(recordSnapshot(null, { dir }), null);
  assert.equal(recordSnapshot({ rate_limits: {} }, { dir }), null);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('recordSnapshot: rotates limits.jsonl above 1 MB into limits.1.jsonl, replacing the older one', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'limits.1.jsonl'), 'old\n');
  fs.writeFileSync(path.join(dir, 'limits.jsonl'), JSON.stringify({ t: 'x', pad: 'a'.repeat(1024 * 1024) }) + '\n');
  assert.ok(recordSnapshot(input(1, 2), { dir }));
  const rotated = fs.readFileSync(path.join(dir, 'limits.1.jsonl'), 'utf8');
  assert.ok(rotated.length > 1024 * 1024 && rotated.includes('"pad"'), 'the big file became limits.1.jsonl');
  assert.equal(lines(path.join(dir, 'limits.jsonl')).length, 1);
});

test('recordSnapshot: an unwritable directory returns null without throwing', () => {
  const dir = tmp();
  const file = path.join(dir, 'not-a-dir');
  fs.writeFileSync(file, 'x');
  assert.equal(recordSnapshot(input(1, 2), { dir: file }), null);
});

test('readSnapshots: reads limits.1.jsonl then limits.jsonl, skips bad lines, filters by sinceMs', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'limits.1.jsonl'), '{"t":"2026-10-01T00:00:00Z","five_hour":1}\nnot json\n');
  fs.writeFileSync(path.join(dir, 'limits.jsonl'), '\n[1]\n{"t":"2026-10-10T00:00:00Z","five_hour":2}\n{broken\n');
  const all = readSnapshots(dir, {});
  assert.deepEqual(all.map((s) => s.five_hour), [1, 2]);
  assert.deepEqual(readSnapshots(dir, { sinceMs: Date.parse('2026-10-05T00:00:00Z') }).map((s) => s.five_hour), [2]);
  assert.deepEqual(readSnapshots(tmp(), {}), []);
});

test('snapshotFromPercents: desktop fallback follows the same change rule', () => {
  const dir = tmp();
  const p = { five_hour: 30, seven_day: 40, five_hour_resets_at: 5, seven_day_resets_at: 6, session_id: 'd1' };
  const s = snapshotFromPercents(p, { dir, now: new Date('2026-10-11T00:00:00Z') });
  assert.equal(s.src, 'desktop');
  assert.equal(s.session_id, 'd1');
  assert.equal(s.cost_usd, null);
  assert.equal(snapshotFromPercents(p, { dir }), null);
  assert.ok(snapshotFromPercents({ ...p, five_hour: 31 }, { dir }));
  assert.equal(snapshotFromPercents({}, { dir }), null, 'no percentages: nothing to record');
  assert.equal(readSnapshots(dir, {}).length, 2);
});

// --- statusline/run.js ---

const RUN = path.join(PLUGIN, 'statusline', 'run.js');
const PRINTER = path.join(tmp('keel-printer-'), 'printer.js');
const EXPECTED = Buffer.concat([Buffer.from('\x1b[32m'), Buffer.from('✓ ok — Київ 📁', 'utf8'), Buffer.from('\x1b[0m\n')]);
fs.writeFileSync(PRINTER, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(Buffer.from(${JSON.stringify(EXPECTED.toString('base64'))}, 'base64')));`);

function wrapDir() {
  const dir = tmp('keel-run-');
  const original = { type: 'command', command: `"${process.execPath}" "${PRINTER}"` };
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ statusline: { mode: 'wrap', original } }));
  return dir;
}
function run(dir, stdin) {
  return spawnSync(process.execPath, [RUN], { input: stdin, env: { ...process.env, KEEL_USAGE_DIR: dir } });
}

test('run.js wrap mode: output is byte-identical and the snapshot is recorded', () => {
  const dir = wrapDir();
  const r = run(dir, JSON.stringify(input(12, 34)));
  assert.equal(r.status, 0);
  assert.ok(Buffer.compare(r.stdout, EXPECTED) === 0, 'bytes unchanged');
  const [s] = lines(path.join(dir, 'limits.jsonl'));
  assert.equal(s.five_hour, 12);
  assert.equal(s.src, 'statusline');
  assert.equal(run(dir, JSON.stringify(input(12, 34))).status, 0);
  assert.equal(lines(path.join(dir, 'limits.jsonl')).length, 1, 'unchanged limits are not recorded again');
});

test('run.js wrap mode: a failing recorder does not change the output or the exit code', () => {
  const dir = wrapDir();
  fs.mkdirSync(path.join(dir, 'limits.jsonl')); // appending to a directory fails
  const r = run(dir, JSON.stringify(input(12, 34)));
  assert.equal(r.status, 0);
  assert.ok(Buffer.compare(r.stdout, EXPECTED) === 0);
});

test('run.js wrap mode: invalid stdin JSON still prints the line', () => {
  const dir = wrapDir();
  const r = run(dir, 'not json {');
  assert.equal(r.status, 0);
  assert.ok(Buffer.compare(r.stdout, EXPECTED) === 0);
  assert.equal(fs.existsSync(path.join(dir, 'limits.jsonl')), false);
});

test('run.js wrap mode: a failing child prints nothing and exits 0', () => {
  const dir = tmp('keel-run-');
  fs.writeFileSync(path.join(dir, 'usage.json'), JSON.stringify({ statusline: { mode: 'wrap', original: { command: 'keel-no-such-command-xyz' } } }));
  const r = run(dir, JSON.stringify(input(1, 2)));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.length, 0);
  assert.equal(lines(path.join(dir, 'limits.jsonl')).length, 1, 'the limits are still recorded');
});

test('run.js default mode: runs the vendored script, exits 0 even when the usage dir is a file', () => {
  const dir = tmp('keel-run-');
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  const r = run(file, JSON.stringify({ ...input(7, 8), cwd: dir, model: { display_name: 'Test' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr.length, 0);
});

test('statusline.ps1: plan-limit percentages are rounded down like statusline.sh, so 99.6% is not full', { skip: process.platform !== 'win32' && 'Windows PowerShell only' }, () => {
  const line = (five, seven) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(PLUGIN, 'statusline', 'statusline.ps1')], {
    input: JSON.stringify({ cwd: os.tmpdir(), cost: { total_cost_usd: 1.5 }, rate_limits: { five_hour: { used_percentage: five }, seven_day: { used_percentage: seven } } }), encoding: 'utf8',
  }).stdout;
  const below = line(99.6, 40.7);
  assert.match(below, /5h \(99%\)/);
  assert.match(below, /1w \(40%\)/);
  assert.doesNotMatch(below, /\$1\.50/, 'the cost of a full limit is not shown');
  assert.match(line(100, 40), /\$1\.50 .*5h \(100%\)/);
});

test('vendored status line files are present with the license', () => {
  for (const f of ['statusline.ps1', 'statusline.sh', 'LICENSE', 'README.md', 'run.js']) {
    assert.ok(fs.existsSync(path.join(PLUGIN, 'statusline', f)), f);
  }
  assert.match(fs.readFileSync(path.join(PLUGIN, 'statusline', 'README.md'), 'utf8'), /e3f08392581b4a2229d7f939596843f60d690a77/);
});

// --- hooks/session-wallet.js ---

const WALLET_HOOK = path.join(PLUGIN, 'hooks', 'session-wallet.js');

function runWallet(stdin, env = {}) {
  const usage = tmp('keel-wallet-');
  fs.writeFileSync(path.join(usage, 'usage.json'), JSON.stringify({ pc: 'pc1', user: 'me@example.com' }));
  const config = tmp('keel-claude-cfg-');
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_)/.test(k)));
  const r = spawnSync(process.execPath, [WALLET_HOOK], {
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    env: { ...clean, KEEL_USAGE_DIR: usage, CLAUDE_CONFIG_DIR: config, ...env },
    encoding: 'utf8',
  });
  const file = path.join(usage, 'sessions.jsonl');
  return { r, rows: fs.existsSync(file) ? lines(file) : [], usage };
}
const START = { session_id: 'abc', cwd: os.tmpdir(), source: 'startup', transcript_path: 'x' };

test('session-wallet: records session, wallet, pc, user, entrypoint and prints nothing', () => {
  const { r, rows } = runWallet(START, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual(Object.keys(row), ['session_id', 'wallet', 'pc', 'user', 'entrypoint', 'started']);
  assert.equal(row.session_id, 'abc');
  assert.equal(row.wallet, 'subscription');
  assert.equal(row.pc, 'pc1');
  assert.equal(row.user, 'me@example.com');
  assert.equal(row.entrypoint, 'cli');
  assert.ok(!Number.isNaN(Date.parse(row.started)));
  assert.equal(runWallet({ ...START, source: 'resume' }).rows.length, 1);
  assert.equal(runWallet(START).rows[0].entrypoint, null);
});

test('session-wallet: startup, resume and clear are recorded (a clear is a new session id), compact is not; bad input is silent', () => {
  assert.equal(runWallet({ ...START, source: 'clear' }).rows.length, 1);
  for (const source of ['compact', undefined]) assert.equal(runWallet({ ...START, source }).rows.length, 0, String(source));
  assert.equal(runWallet({ source: 'startup' }).rows.length, 0, 'no session id');
  const bad = runWallet('not json');
  assert.equal(bad.r.status, 0);
  assert.equal(bad.r.stdout, '');
  assert.equal(bad.rows.length, 0);
});

test('session-wallet: wallet detection from the environment and settings', () => {
  assert.equal(runWallet(START, { ANTHROPIC_API_KEY: 'k' }).rows[0].wallet, 'api');
  assert.equal(runWallet(START, { ANTHROPIC_BASE_URL: 'http://localhost:1' }).rows[0].wallet, 'subscription');
  assert.equal(runWallet(START, { CLAUDE_CODE_REMOTE: 'true' }).rows[0].wallet, 'credit');
  assert.equal(runWallet(START, { CLAUDE_CODE_USE_BEDROCK: '1' }).rows[0].wallet, 'api');
  const project = tmp('keel-proj-');
  fs.mkdirSync(path.join(project, '.claude'));
  fs.writeFileSync(path.join(project, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: 'get-key.sh' }));
  assert.equal(runWallet({ ...START, cwd: project }).rows[0].wallet, 'api');
});

test('hooks.json: session-wallet is the second SessionStart hook, in exec form', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const wallet = cfg.SessionStart[0].hooks[1];
  assert.deepEqual([wallet.command, ...wallet.args], ['node', '${CLAUDE_PLUGIN_ROOT}/hooks/session-wallet.js']);
  assert.equal(wallet.timeout, 10);
});
