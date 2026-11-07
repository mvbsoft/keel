'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');
const { writeSession } = require('./fixtures/usage.js');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const CLI = path.join(PLUGIN, 'scripts', 'usage.js');
const SETUP = path.join(PLUGIN, 'scripts', 'usage-setup.js');

const HOUR = 3600000;
const OPUS = 'claude-opus-4-test';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const URL = 'https://claude.ai/artifact/own';

// A private world with a page; `page` is a folder under .keel/local where the test puts what the model
// would have saved from the page.
function world(usage = {}) {
  const w = { dir: tempDir('keel-ps-usage-'), root: tempDir('keel-ps-proj-'), home: tempDir('keel-ps-home-'), project: tempDir('keel-ps-work-') };
  w.out = path.join(w.project, '.keel', 'local', 'usage', 'out');
  w.page = path.join(w.project, '.keel', 'local', 'usage', 'in');
  fs.mkdirSync(w.page, { recursive: true });
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ pc: 'testpc', user: 't@x.y', wallet_default: 'subscription', artifact_url: URL, ...usage }));
  w.env = { ...process.env, KEEL_USAGE_DIR: w.dir, KEEL_PROJECTS_DIR: w.root, HOME: w.home, USERPROFILE: w.home, CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' };
  w.run = (args, extraEnv = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...w.env, ...extraEnv } });
    assert.equal(r.status, 0, r.stderr);
    w.stderr = r.stderr;
    return r.stdout.trim();
  };
  w.prepare = (...more) => JSON.parse(w.run(['prepare', '--out', w.out, '--project', w.project, ...more]));
  w.report = (...more) => w.run(['report', '--project', w.project, ...more]);
  w.state = () => read(path.join(w.dir, 'sync-state.json'));
  w.machine = () => read(path.join(w.dir, 'usage.json'));
  return w;
}

function session(w, id = 'sess-a', at = Date.now() - HOUR, dollars = 1) {
  // The transcript was last written right after its request, so a later sync does not rebuild its day.
  return writeSession(w.root, { id, rows: [{ t: at, prompt: 'do it' }, { t: at + 60000, model: OPUS, tok: { in: (dollars / 5) * 1e6 } }], mtimeMs: at + 120000 });
}

// The day documents of a write spec, as the model would save them back from the page's database.
const dayWrites = (spec) => spec.batches.flatMap((b) => b.writes).filter((x) => x.collection === 'days');
function saveDays(w, spec, edit = (d) => d) {
  const saved = path.join(w.page, 'audit');
  fs.mkdirSync(saved, { recursive: true });
  for (const x of dayWrites(spec)) fs.writeFileSync(path.join(saved, `${x.doc_id}.json`), JSON.stringify(edit(read(x.file_path))));
  return saved;
}

test('sync off: nothing goes to the page, and after on everything since is sent', () => {
  const w = world();
  const setup = (...a) => spawnSync(process.execPath, [SETUP, w.project, 'sync', ...a], { encoding: 'utf8', env: w.env }).stdout.trim();
  assert.match(setup('off'), /^sync: off since \d{4}-/);
  const since = w.machine().sync_off_since;
  assert.match(setup('off'), new RegExp(`since ${since}`), 'a second off keeps the first date');
  session(w);
  const off = w.prepare();
  assert.deepEqual([off.action, off.reason], ['skip', 'sync_off']);
  assert.match(w.report(), new RegExp(`sync of this PC is off since ${since.slice(0, 10)}`));
  assert.match(spawnSync(process.execPath, [SETUP, w.project, 'show'], { encoding: 'utf8', env: w.env }).stdout, new RegExp(`sync: off since ${since}`));
  assert.equal(setup('on'), 'sync: on');
  assert.equal(w.machine().sync_off_since, null);
  const spec = w.prepare();
  assert.equal(spec.action, 'write');
  assert.equal(read(dayWrites(spec)[0].file_path).sessions[0].id, 'sess-a');
});

test('a skipped sync keeps the session\'s keel fields, so the later sync sends them', () => {
  for (const [skipArgs, setupOff] of [[[], true], [['--tools', 'none'], false]]) {
    const w = world();
    const setup = (a) => spawnSync(process.execPath, [SETUP, w.project, 'sync', a], { encoding: 'utf8', env: w.env });
    session(w);
    if (setupOff) setup('off');
    const skipped = w.prepare('--session', 'sess-a', '--level', 'Standard', '--findings', '1/2/0', '--gates', 'pass', ...skipArgs);
    assert.equal(skipped.action, 'skip');
    if (setupOff) setup('on');
    const spec = w.prepare('--session', 'sess-a');
    assert.equal(spec.action, 'write');
    const keel = read(dayWrites(spec)[0].file_path).sessions[0].keel;
    assert.deepEqual([keel && keel.level, keel && keel.gates, keel && keel.findings], ['Standard', 'pass', { must: 1, should: 2, nice: 0 }], skipArgs.join(' ') || 'sync off');
  }
});

test('a note keel no longer has a text for is left out of the report, not printed as its key', () => {
  const w = world();
  fs.writeFileSync(path.join(w.dir, 'sync-state.json'), JSON.stringify({ artifact_url: URL, notes: [{ key: 'gone_note' }, { key: 'no_tools' }] }));
  const text = w.report();
  assert.doesNotMatch(text, /report\.note\./);
  assert.match(text, /no page tools, so the sync waits/);
});

test('sync off on a machine that was never configured: it still counts as not configured', () => {
  const w = world();
  fs.rmSync(path.join(w.dir, 'usage.json'));
  const show = () => spawnSync(process.execPath, [SETUP, w.project, 'show'], { encoding: 'utf8', env: w.env }).stdout;
  assert.match(show(), /not configured on this machine yet/);
  spawnSync(process.execPath, [SETUP, w.project, 'sync', 'off'], { encoding: 'utf8', env: w.env });
  assert.match(show(), /not configured on this machine yet/);
  assert.match(show(), /sync: off since/);
});

test('no page tools: the sync waits with one line; with an API key the line says why', () => {
  const w = world();
  session(w);
  const spec = w.prepare('--tools', 'none');
  assert.deepEqual([spec.action, spec.reason], ['skip', 'no_tools']);
  assert.match(w.report(), /no page tools, so the sync waits/);
  const api = w.prepare('--tools', 'none');
  assert.equal(api.reason, 'no_tools');
  const r = spawnSync(process.execPath, [CLI, 'prepare', '--tools', 'none', '--project', w.project], { encoding: 'utf8', env: { ...w.env, ANTHROPIC_API_KEY: 'x' } });
  assert.equal(JSON.parse(r.stdout).reason, 'api');
  assert.match(w.report('--lang', 'uk'), /працює з API-ключем/);
  // No page set at all: nothing to say.
  const none = world({ artifact_url: undefined });
  session(none);
  assert.equal(none.prepare('--tools', 'none').reason, 'no_page');
  assert.doesNotMatch(none.report(), /Usage page/);
});

test('a machine that synced to the old shared page starts its own page from scratch', () => {
  const w = world({ artifact_url: undefined });
  session(w);
  fs.writeFileSync(path.join(w.dir, 'sync-state.json'), JSON.stringify({ artifact_url: 'https://claude.ai/artifact/team', docs: { 'machines/testpc': { version: 5, hash: 'h' } }, pending: {}, synced_until: new Date().toISOString() }));
  assert.equal(w.prepare().reason, 'no_page');
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ pc: 'testpc', user: 't@x.y', wallet_default: 'subscription', artifact_url: URL }));
  const spec = w.prepare();
  assert.equal(spec.action, 'write');
  const writes = spec.batches.flatMap((b) => b.writes);
  assert.ok(writes.some((x) => x.collection === 'days'), 'the history is sent to the new page');
  assert.ok(!writes.some((x) => x.if_version === 5), 'no version of the old page');
});

test('a project with the old shared page URL is told once that it is no longer used, and nothing goes there', () => {
  const w = world({ artifact_url: undefined });
  session(w);
  fs.mkdirSync(path.join(w.project, '.keel'), { recursive: true });
  fs.writeFileSync(path.join(w.project, '.keel', 'config.json'), JSON.stringify({ usage: { artifact_url: 'https://claude.ai/artifact/team' } }));
  const spec = w.prepare();
  assert.equal(spec.artifact_url, null);
  assert.equal(spec.action, 'skip');
  assert.match(w.report(), /shared usage page .* is no longer used/);
  w.prepare();
  assert.doesNotMatch(w.report(), /no longer used/, 'once per machine');
});

test('audit: the page as published matches the local transcripts; a changed file shows the difference', () => {
  const w = world();
  session(w, 'sess-a', Date.now() - 3 * HOUR, 2);
  const spec = w.prepare();
  const saved = saveDays(w, spec);
  assert.match(w.run(['audit', '--project', w.project, '--page', saved]), /^audit: 1 sessions on 1 days compared; differences: 0$/);
  saveDays(w, spec, (doc) => { doc.sessions[0].participants[0].usd += 1; return doc; });
  assert.match(w.run(['audit', '--project', w.project, '--page', saved]), /differences: 1\n {2}\d{4}-\d{2}-\d{2} sess-a: page \$3\.00/);
  assert.match(w.run(['audit', '--project', w.project, '--page', w.home]), /must be a folder under/);
});

test('audit: a session only on the page, one only in the transcripts, one that went on after the sync, and Claude Code\'s own cost', () => {
  const w = world();
  const t0 = Date.now() - 5 * HOUR;
  session(w, 'a', t0, 2);
  session(w, 'c', t0 + 40 * 60000, 1);
  const d = session(w, 'd', t0 + 60 * 60000, 1);
  fs.writeFileSync(path.join(w.dir, 'limits.jsonl'), `${JSON.stringify({ t: new Date(t0 + 120000).toISOString(), five_hour: null, five_hour_resets_at: null, seven_day: null, seven_day_resets_at: null, session_id: 'a', cost_usd: 2.5, src: 'statusline' })}\n`);
  const saved = saveDays(w, w.prepare(), (day) => {
    const a = day.sessions.find((s) => s.id === 'a');
    // b: a session the transcripts never had.
    day.sessions = day.sessions.filter((s) => s.id !== 'c').concat(a ? [{ ...a, id: 'b', participants: a.participants.map((p) => ({ ...p, usd: p.usd / 2 })) }] : []);
    return day;
  });
  require('./fixtures/usage.js').appendRequest(d.file, 'd', { t: Date.now(), model: OPUS, tok: { in: 1e6 } });
  const out = w.run(['audit', '--project', w.project, '--page', saved]);
  assert.match(out, /^audit: 1 sessions on 1 days compared; differences: 2$/m, out);
  assert.match(out, / b: only on the page \(\$1\.00\)/);
  assert.match(out, / c: only in the local transcripts \(\$1\.00\)/);
  assert.doesNotMatch(out, / d: /, 'a session that went on after the sync is not compared');
  assert.match(out, /Claude Code's own cost of the compared sessions: \$2\.50, keel's: \$2\.00 \(\$-0\.50\)/);
});

test('after this machine\'s clear, the hour of the clear keeps the requests after it', () => {
  const w = world();
  // A clear at half past an hour two hours ago; a session with one request ten minutes after it.
  const clearAt = Math.floor((Date.now() - 2 * HOUR) / HOUR) * HOUR + 30 * 60000;
  fs.writeFileSync(path.join(w.dir, 'sync-state.json'), JSON.stringify({ cleared_at: new Date(clearAt).toISOString(), synced_until: new Date(clearAt).toISOString() }));
  writeSession(w.root, { id: 'before', rows: [{ t: clearAt - 20 * 60000, prompt: 'old' }, { t: clearAt - 15 * 60000, model: OPUS, tok: { in: 0.2e6 } }], mtimeMs: clearAt - 14 * 60000 });
  writeSession(w.root, { id: 'after', rows: [{ t: clearAt + 5 * 60000, prompt: 'go' }, { t: clearAt + 10 * 60000, model: OPUS, tok: { in: 0.2e6 } }], mtimeMs: clearAt + 12 * 60000 });
  const days = dayWrites(w.prepare()).map((x) => read(x.file_path));
  assert.equal(days.flatMap((d) => d.hours).reduce((n, h) => n + h.req, 0), 1, 'only the request after the clear');
  assert.deepEqual(days.flatMap((d) => d.sessions.map((s) => s.id)), ['after']);
});
