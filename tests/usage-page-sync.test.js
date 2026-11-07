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
const { validate } = require(path.join(PLUGIN, 'scripts', 'lib', 'schema.js'));
const { combineRemote } = require(CLI);
const { pageTemplate, PAGE_FILES } = require(SETUP);
const SCHEMA = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'schemas', 'usage-day.schema.json'), 'utf8'));

const HOUR = 3600000;
const OPUS = 'claude-opus-4-test';
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const URL = 'https://claude.ai/artifact/own';

// A private world with one keel session an hour ago; `page` is a folder under .keel/local where the
// test puts what the model would have saved from the page.
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
  w.files = (...more) => w.prepare('--tools', 'files', ...more);
  w.report = (...more) => w.run(['report', '--project', w.project, ...more]);
  w.save = (name, value) => { const f = path.join(w.page, name); fs.writeFileSync(f, typeof value === 'string' ? value : JSON.stringify(value)); return f; };
  w.state = () => read(path.join(w.dir, 'sync-state.json'));
  w.machine = () => read(path.join(w.dir, 'usage.json'));
  w.local = () => { try { return fs.readdirSync(path.join(w.dir, 'usage-files')).sort(); } catch { return []; } };
  return w;
}

function session(w, id = 'sess-a', at = Date.now() - HOUR, dollars = 1) {
  // The transcript was last written right after its request, so a later sync does not rebuild its day.
  return writeSession(w.root, { id, rows: [{ t: at, prompt: 'do it' }, { t: at + 60000, model: OPUS, tok: { in: (dollars / 5) * 1e6 } }], mtimeMs: at + 120000 });
}

const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
const pathOf = (spec, rel) => spec.files.find((f) => f.path === rel);

// What the page holds after a publish: the files as published, as the model would read them back.
function publishTo(w, spec, version) {
  const page = {};
  for (const f of spec.files) page[f.path] = fs.readFileSync(f.file, 'utf8');
  w.report('--published', String(version));
  return page;
}

test('files: the first sync of a page without data publishes the index, the month file and this keel\'s page', () => {
  const w = world();
  session(w);
  const spec = w.files('--page', 'none', '--page-version', '7');
  assert.equal(spec.action, 'publish');
  assert.equal(spec.tools, 'files');
  assert.equal(spec.artifact_url, URL);
  assert.equal(spec.base_version, '7');
  assert.deepEqual(spec.remove, []);
  const month = `data/testpc-${monthOf(Date.now() - HOUR)}.json`;
  assert.ok(pathOf(spec, 'data/index.json') && pathOf(spec, month), JSON.stringify(spec.files.map((f) => f.path)));
  for (const name of PAGE_FILES) assert.ok(pathOf(spec, name), `page file ${name}`);
  for (const f of spec.files) assert.ok(f.file.startsWith(w.out), f.file);
  const index = read(pathOf(spec, 'data/index.json').file);
  assert.deepEqual(validate(index, { ...SCHEMA.$defs.index, $defs: SCHEMA.$defs }), []);
  assert.equal(index.template, pageTemplate());
  const entry = index.pcs.testpc;
  assert.match(entry.install_id, /^[0-9a-f-]{36}$/);
  assert.equal(w.machine().install_id, entry.install_id, 'the install id is kept in usage.json');
  const monthFile = read(pathOf(spec, month).file);
  assert.deepEqual(validate(monthFile, { ...SCHEMA.$defs.month, $defs: SCHEMA.$defs }), []);
  // The index names the month file by the sha256 of exactly the published bytes.
  const sha = require('node:crypto').createHash('sha256').update(fs.readFileSync(pathOf(spec, month).file)).digest('hex');
  assert.equal(entry.months[monthOf(Date.now() - HOUR)], sha);
  assert.equal(entry.recent.hours.length, 1);
  assert.equal(monthFile.days[0].sessions[0].id, 'sess-a');
  // Nothing is recorded until the publish went through.
  assert.deepEqual(w.state().files.published, {});
  assert.ok(w.local().includes(`testpc-${monthOf(Date.now() - HOUR)}.json`));
});

test('files: a page without a language gets the conversation language (--lang, else the setting); a page\'s own language stays', () => {
  const w = world();
  session(w);
  const lang = (spec) => read(pathOf(spec, 'data/index.json').file).language;
  assert.equal(lang(w.files('--page', 'none', '--page-version', '1', '--lang', 'uk')), 'uk');
  assert.equal(lang(w.prepare('--tools', 'files', '--page', 'none', '--page-version', '1')), 'en');
  const spec = JSON.parse(w.run(['prepare', '--out', w.out, '--project', w.project, '--tools', 'files', '--page', 'none', '--page-version', '1'], { CLAUDE_PLUGIN_OPTION_CONVERSATION_LANGUAGE: 'uk' }));
  assert.equal(lang(spec), 'uk');
  const index = w.save('index.json', { ...read(pathOf(spec, 'data/index.json').file), language: 'en' });
  assert.equal(lang(w.files('--page', index, '--page-version', '2', '--take', 'none', '--lang', 'uk')), 'en', 'the page keeps the language it has');
});

test('files: after --published the next sync sends only the index; a page with the current template gets no page files', () => {
  const w = world();
  session(w);
  const first = w.files('--page', 'none', '--page-version', '1');
  const page = publishTo(w, first, 2);
  assert.equal(Object.keys(w.state().files.published).length, 1);
  assert.equal(w.state().files.pending, null);
  const again = w.files('--page', w.save('index.json', page['data/index.json']), '--page-version', '2');
  assert.equal(again.action, 'publish');
  assert.deepEqual(again.files.map((f) => f.path), ['data/index.json']);
  // A page that runs another template gets this keel's page files again.
  const old = JSON.parse(page['data/index.json']);
  const other = w.files('--page', w.save('index.json', { ...old, template: 'aaaaaaaaaaaa' }), '--page-version', '2');
  assert.ok(pathOf(other, 'index.html'));
  assert.equal(read(pathOf(other, 'data/index.json').file).template, pageTemplate());
});

test('files: a page that runs a newer keel keeps its page files; an older or unknown one gets this keel\'s', () => {
  const w = world();
  session(w);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  const index = JSON.parse(page['data/index.json']);
  const mine = require(path.join(PLUGIN, '.claude-plugin', 'plugin.json')).version;
  assert.equal(index.keel_version, mine);
  const newer = w.files('--page', w.save('index.json', { ...index, template: 'aaaaaaaaaaaa', keel_version: '99.0.0' }), '--page-version', '2');
  assert.ok(!pathOf(newer, 'index.html'), 'an older keel leaves a newer page alone');
  assert.deepEqual([read(pathOf(newer, 'data/index.json').file).template, read(pathOf(newer, 'data/index.json').file).keel_version], ['aaaaaaaaaaaa', '99.0.0']);
  for (const older of ['0.1.0', undefined]) {
    const spec = w.files('--page', w.save('index.json', { ...index, template: 'aaaaaaaaaaaa', keel_version: older }), '--page-version', '2');
    assert.ok(pathOf(spec, 'index.html'), String(older));
    assert.equal(read(pathOf(spec, 'data/index.json').file).keel_version, mine);
  }
});

test('files: a publish that was not recorded is offered again; --published twice changes nothing', () => {
  const w = world();
  session(w);
  const first = w.files('--page', 'none', '--page-version', '1');
  const month = first.files.find((f) => f.path.startsWith('data/testpc-')).path;
  const again = w.files('--page', 'none', '--page-version', '1');
  assert.ok(pathOf(again, month), 'without --published the month is sent again');
  w.report('--published', '2');
  const state = w.state().files;
  w.report('--published', '2');
  assert.deepEqual(w.state().files, state);
});

test('files: a page URL change starts the files sync over for the new page', () => {
  const w = world();
  session(w);
  publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  assert.ok(Object.keys(w.state().files.published).length);
  fs.writeFileSync(path.join(w.dir, 'usage.json'), JSON.stringify({ ...w.machine(), artifact_url: 'https://claude.ai/artifact/new' }));
  const spec = w.files('--page', 'none', '--page-version', '1');
  assert.ok(spec.files.some((f) => f.path.startsWith('data/testpc-')), 'the new page gets the month file');
});

test('files: other machines\' entries in the index are kept as they are', () => {
  const w = world();
  session(w);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  const index = JSON.parse(page['data/index.json']);
  const other = { ...index.pcs.testpc, name: 'laptop', install_id: 'other-id', months: { '2026-01': 'a'.repeat(64) } };
  index.pcs.laptop = other;
  const spec = w.files('--page', w.save('index.json', index), '--page-version', '2');
  assert.deepEqual(read(pathOf(spec, 'data/index.json').file).pcs.laptop, other);
});

test('files: a wiped machine reads its month files back from the page before it publishes, and loses nothing', () => {
  const w = world();
  // Both sessions at midday three days ago, so they share a month whatever the date of the run.
  const noon = Date.parse(`${new Date(Date.now() - 3 * 24 * HOUR).toISOString().slice(0, 10)}T12:00:00Z`);
  const at = noon - 2 * HOUR;
  session(w, 'sess-old', at, 2);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  const install = w.machine().install_id;
  // The machine is wiped: transcripts, cache, state and local month files are gone; usage.json stays.
  for (const name of fs.readdirSync(w.dir)) if (name !== 'usage.json') fs.rmSync(path.join(w.dir, name), { recursive: true, force: true });
  fs.rmSync(w.root, { recursive: true, force: true });
  fs.mkdirSync(w.root);
  session(w, 'sess-new', noon - HOUR, 1);
  const indexFile = w.save('index.json', page['data/index.json']);
  const month = `data/testpc-${monthOf(at)}.json`;
  const ask = w.files('--page', indexFile, '--page-version', '2');
  assert.deepEqual(ask, { tools: 'files', artifact_url: URL, action: 'read', paths: [month] });
  // The client picks the saved name; the script knows the file by its content.
  const saved = w.save('whatever-name.json', page[month]);
  const spec = w.files('--page', indexFile, '--page-version', '2', '--take', saved);
  assert.equal(spec.action, 'publish');
  const days = read(pathOf(spec, month).file).days;
  const ids = days.flatMap((d) => d.sessions.map((s) => s.id)).sort();
  assert.deepEqual(ids, ['sess-new', 'sess-old']);
  const usd = days.flatMap((d) => d.hours).reduce((s, h) => s + h.usd, 0);
  assert.ok(usd >= 2, `the old session's hours stay (${usd})`);
  assert.equal(w.machine().install_id, install);
});

// Changed on purpose: the read is asked once per sync; a month the page could not give is then left on the page.
test('files: a month the page has but this machine did not take in is never published over, and is asked for once per sync', () => {
  const w = world();
  session(w);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  fs.rmSync(path.join(w.dir, 'sync-state.json'));
  const indexFile = w.save('index.json', page['data/index.json']);
  const index = JSON.parse(page['data/index.json']);
  const month = `data/testpc-${monthOf(Date.now() - HOUR)}.json`;
  assert.equal(w.files('--page', indexFile, '--page-version', '2').action, 'read');
  // A --take that is not this machine's month file, or --take none, ends the read round without that month.
  const other = w.save('other.json', { schema: 2, kind: 'month', pc: 'laptop', month: monthOf(Date.now() - HOUR), days: [] });
  for (const take of [other, w.save('i.json', index), 'none']) {
    const spec = w.files('--page', indexFile, '--page-version', '2', '--take', take);
    assert.equal(spec.action, 'publish', take);
    assert.ok(!pathOf(spec, month), 'the page copy is not published over');
    assert.deepEqual(spec.remove, []);
    assert.deepEqual(read(pathOf(spec, 'data/index.json').file).pcs.testpc.months, index.pcs.testpc.months, 'the index keeps the page copy');
  }
});

test('files: a published month whose local file is gone and that gets a new session is read back first, not published over', () => {
  const w = world();
  // Midday three days ago: both sessions share a month whatever the date of the run.
  const noon = Date.parse(`${new Date(Date.now() - 3 * 24 * HOUR).toISOString().slice(0, 10)}T12:00:00Z`);
  session(w, 'sess-old', noon - 2 * HOUR, 2);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  fs.rmSync(path.join(w.dir, 'usage-files'), { recursive: true, force: true });
  // A new transcript of the same month: only its day is rebuilt.
  writeSession(w.root, { id: 'sess-new', rows: [{ t: noon - HOUR, prompt: 'go' }, { t: noon - HOUR + 60000, model: OPUS, tok: { in: 0.2e6 } }], mtimeMs: Date.now() });
  const month = `data/testpc-${monthOf(noon)}.json`;
  const indexFile = w.save('index.json', page['data/index.json']);
  assert.deepEqual(w.files('--page', indexFile, '--page-version', '2').paths, [month]);
  const spec = w.files('--page', indexFile, '--page-version', '2', '--take', w.save('m.json', page[month]));
  assert.deepEqual(read(pathOf(spec, month).file).days.flatMap((d) => d.sessions.map((s) => s.id)).sort(), ['sess-new', 'sess-old']);
});

test('files: a published month whose local file is gone is read back from the page, not removed from it', () => {
  const w = world();
  session(w);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  fs.rmSync(path.join(w.dir, 'usage-files'), { recursive: true, force: true });
  // The local collection finds nothing new to rebuild: the old month is only on the page now.
  const spec = w.files('--page', w.save('index.json', page['data/index.json']), '--page-version', '2');
  assert.deepEqual(spec, { tools: 'files', artifact_url: URL, action: 'read', paths: [`data/testpc-${monthOf(Date.now() - HOUR)}.json`] });
});

test('files: a damaged copy of a month read back from the page is not merged; the local month is published over it', () => {
  const w = world();
  session(w);
  const page = publishTo(w, w.files('--page', 'none', '--page-version', '1'), 2);
  fs.rmSync(path.join(w.dir, 'usage-files'), { recursive: true, force: true });
  // A new session of the same month, written just now, gives this machine a local copy of it again.
  const t = Date.now() - HOUR + 5 * 60000;
  writeSession(w.root, { id: 'sess-new', rows: [{ t, prompt: 'more' }, { t: t + 60000, model: OPUS, tok: { in: 1e5 } }] });
  const month = `data/testpc-${monthOf(Date.now() - HOUR)}.json`;
  const index = w.save('index.json', page['data/index.json']);
  assert.equal(w.files('--page', index, '--page-version', '2').action, 'read');
  for (const damage of [(d) => { delete d.hours; }, (d) => { d.snapshots = 'x'; }]) {
    const copy = JSON.parse(page[month]);
    damage(copy.days[0]);
    const spec = w.files('--page', index, '--page-version', '2', '--take', w.save('month.json', copy));
    assert.equal(spec.action, 'publish');
    const published = read(pathOf(spec, month).file);
    assert.deepEqual(validate(published, { ...SCHEMA.$defs.month, $defs: SCHEMA.$defs }), [], 'the local month replaces the damaged copy');
  }
});

test('files: one read stays within read_file\'s limits (a month of unknown size counts as 1 MiB), the newest first; the rest are asked for by the next syncs', () => {
  const w = world({ install_id: 'mine' });
  session(w);
  const months = Array.from({ length: 40 }, (_, i) => `${2020 + Math.floor(i / 12)}-${String(1 + (i % 12)).padStart(2, '0')}`);
  const index = { schema: 2, kind: 'index', language: 'en', template: null, pcs: {} };
  index.pcs.testpc = { name: 'testpc', user: 't@x.y', wallet_default: 'subscription', install_id: 'mine', synced_until: new Date().toISOString(), last_seen: new Date().toISOString(), calib: null, recent: { hours: [], snapshots: [] }, months: Object.fromEntries(months.map((m) => [m, 'a'.repeat(64)])) };
  const spec = w.files('--page', w.save('index.json', index), '--page-version', '3');
  assert.equal(spec.action, 'read');
  assert.deepEqual(spec.paths, [39, 38, 37, 36].map((i) => `data/testpc-${months[i]}.json`), '4 MiB of months with no local copy');
  const after = w.files('--page', path.join(w.page, 'index.json'), '--page-version', '3', '--take', 'none');
  assert.equal(after.action, 'publish');
  for (const m of months) assert.equal(read(pathOf(after, 'data/index.json').file).pcs.testpc.months[m], 'a'.repeat(64), 'a month not read stays on the page');
});

test('files: the name of this machine taken by another install → nothing is sent; no install id yet → asked, --same-pc takes it over', () => {
  const w = world({ install_id: 'mine' });
  session(w);
  const index = { schema: 2, kind: 'index', language: null, template: null, pcs: {} };
  index.pcs.testpc = { name: 'testpc', user: 't@x.y', wallet_default: 'subscription', install_id: 'theirs', synced_until: null, last_seen: new Date().toISOString(), calib: null, recent: { hours: [], snapshots: [] }, months: {} };
  const file = w.save('index.json', index);
  const taken = w.files('--page', file, '--page-version', '3');
  assert.deepEqual([taken.action, taken.reason], ['skip', 'name_taken']);
  assert.ok(w.local().length, 'the local collection goes on');
  assert.match(w.report(), /another PC already syncs as "testpc"/);
  assert.doesNotMatch(w.report(), /another PC already syncs/, 'said once');

  const fresh = world();
  session(fresh);
  const ask = fresh.files('--page', fresh.save('index.json', index), '--page-version', '3');
  assert.equal(ask.reason, 'name_ask');
  assert.equal(fresh.machine().install_id, undefined);
  const spec = fresh.files('--page', path.join(fresh.page, 'index.json'), '--page-version', '3', '--same-pc');
  assert.equal(spec.action, 'publish');
  assert.equal(fresh.machine().install_id, 'theirs');
  assert.doesNotMatch(fresh.report('--published', '4'), /Nothing was sent until you say/, 'the answer was given: the question is not repeated');
});

test('files: --page and --take only under the project\'s .keel/local/; --page and --page-version are required', () => {
  const w = world();
  session(w);
  const outside = path.join(w.home, 'index.json');
  fs.writeFileSync(outside, '{}');
  assert.match(w.run(['prepare', '--tools', 'files', '--project', w.project, '--page', outside, '--page-version', '1']), /must be a file under the project's \.keel\/local/);
  assert.match(w.run(['prepare', '--tools', 'files', '--project', w.project, '--page', 'none', '--page-version', '1', '--take', outside]), /must be a file under/);
  assert.deepEqual(JSON.parse(w.run(['prepare', '--tools', 'files', '--project', w.project])), { tools: 'files', artifact_url: URL, action: 'index', paths: ['data/index.json'] });
  assert.match(w.run(['prepare', '--tools', 'files', '--project', w.project, '--page', '--page-version', '1']), /needs --page/);
  assert.match(w.run(['prepare', '--tools', 'files', '--project', w.project, '--page', 'none']), /needs --page-version/);
  assert.match(w.run(['prepare', '--tools', 'files', '--project', w.project, '--page', w.save('bad.json', { kind: 'month' }), '--page-version', '1']), /is not the page's data\/index\.json/);
});

test('files: --shared asks for the live publish of a shared page', () => {
  const w = world();
  session(w);
  assert.equal(w.files('--page', 'none', '--page-version', '1', '--shared').shared_live, true);
  assert.ok(!('shared_live' in w.files('--page', 'none', '--page-version', '1')));
});

test('sync off: nothing goes to the page, the local collection goes on, and after on everything collected is sent', () => {
  const w = world();
  const setup = (...a) => spawnSync(process.execPath, [SETUP, w.project, 'sync', ...a], { encoding: 'utf8', env: w.env }).stdout.trim();
  assert.match(setup('off'), /^sync: off since \d{4}-/);
  const since = w.machine().sync_off_since;
  assert.match(setup('off'), new RegExp(`since ${since}`), 'a second off keeps the first date');
  session(w);
  for (const tools of ['db', 'files']) {
    const spec = w.prepare('--tools', tools, '--page', 'none', '--page-version', '1');
    assert.deepEqual([spec.action, spec.reason], ['skip', 'sync_off']);
  }
  assert.ok(w.local().length, 'collected locally');
  assert.match(w.report(), new RegExp(`sync of this PC is off since ${since.slice(0, 10)}`));
  assert.match(spawnSync(process.execPath, [SETUP, w.project, 'show'], { encoding: 'utf8', env: w.env }).stdout, new RegExp(`sync: off since ${since}`));
  assert.equal(setup('on'), 'sync: on');
  assert.equal(w.machine().sync_off_since, null);
  const spec = w.files('--page', 'none', '--page-version', '1');
  assert.equal(spec.action, 'publish');
  assert.equal(read(pathOf(spec, `data/testpc-${monthOf(Date.now() - HOUR)}.json`).file).days[0].sessions[0].id, 'sess-a');
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
  assert.equal(none.files().reason, 'no_page');
  assert.deepEqual(none.local(), [], 'a machine without a page keeps no month files (they hold prompt previews)');
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

test('remoteFromIndex: the other machines of the same user with their recent hours and snapshots; this machine is left out', () => {
  const { remoteFromIndex } = require(path.join(PLUGIN, 'scripts', 'lib', 'usage-page-sync.js'));
  const entry = (user, hours) => ({ name: 'x', user, wallet_default: 'subscription', install_id: 'i', synced_until: '2026-11-02T00:00:00Z', last_seen: '2026-11-02T01:00:00Z', calib: null, recent: { hours, snapshots: [{ t: '2026-11-01T00:00:00Z', seven_day: 3 }] }, months: {} });
  const hour = { h: '2026-11-01T10:00:00.000Z', wallet: 'subscription', usd: 1.5, by_model: { m: 1.5 } };
  const index = { schema: 2, kind: 'index', pcs: { me: entry('t@x.y', [hour]), laptop: entry('T@X.Y', [hour, { bad: 1 }]), boss: entry('b@x.y', [hour]) } };
  const r = remoteFromIndex(index, 'me', 't@x.y');
  assert.deepEqual(r.machines, [{ pc: 'laptop', synced_until: '2026-11-02T00:00:00Z', last_seen: '2026-11-02T01:00:00Z' }]);
  assert.deepEqual(r.hours, [{ pc: 'laptop', ...hour }]);
  assert.equal(r.snapshots.length, 1);
  assert.deepEqual(remoteFromIndex(null, 'me', 't@x.y'), { machines: [], hours: [], snapshots: [] });
});

test('combineRemote: a machine seen in the database and the index keeps each hour from the source synced last', () => {
  const h = (usd) => ({ pc: 'b', h: '2026-11-01T10:00:00.000Z', wallet: 'subscription', usd, by_model: {} });
  const db = { machines: [{ pc: 'b', synced_until: '2026-11-01T12:00:00Z' }], hours: [h(1), { ...h(5), h: '2026-11-01T09:00:00.000Z' }], snapshots: [{ t: 'a' }] };
  const files = { machines: [{ pc: 'b', synced_until: '2026-11-02T12:00:00Z', last_seen: '2026-11-02T12:00:00Z' }], hours: [h(2)], snapshots: [{ t: 'b' }] };
  const r = combineRemote(db, files);
  assert.deepEqual(r.hours.map((x) => x.usd).sort(), [2, 5]);
  assert.deepEqual(r.machines, [{ pc: 'b', synced_until: '2026-11-02T12:00:00Z', last_seen: '2026-11-02T12:00:00Z' }]);
  assert.deepEqual(combineRemote(files, db).hours.map((x) => x.usd).sort(), [2, 5], 'the order of the sources does not matter');
});

test('audit: the page as published matches the local transcripts; a changed file shows the difference', () => {
  const w = world();
  session(w, 'sess-a', Date.now() - 3 * HOUR, 2);
  const spec = w.files('--page', 'none', '--page-version', '1');
  const month = `data/testpc-${monthOf(Date.now() - 3 * HOUR)}.json`;
  const saved = path.join(w.page, 'audit');
  fs.mkdirSync(saved);
  fs.copyFileSync(pathOf(spec, month).file, path.join(saved, 'm.json'));
  assert.match(w.run(['audit', '--project', w.project, '--page', saved]), /^audit: 1 sessions on 1 days compared; differences: 0$/);
  const file = read(path.join(saved, 'm.json'));
  file.days[0].sessions[0].participants[0].usd += 1;
  fs.writeFileSync(path.join(saved, 'm.json'), JSON.stringify(file));
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
  const spec = w.files('--page', 'none', '--page-version', '1');
  const saved = path.join(w.page, 'audit');
  fs.mkdirSync(saved);
  for (const f of spec.files.filter((x) => x.path.startsWith('data/testpc-'))) {
    const month = read(f.file);
    for (const day of month.days) {
      const a = day.sessions.find((s) => s.id === 'a');
      // b: a session the transcripts never had.
      day.sessions = day.sessions.filter((s) => s.id !== 'c').concat(a ? [{ ...a, id: 'b', participants: a.participants.map((p) => ({ ...p, usd: p.usd / 2 })) }] : []);
    }
    fs.writeFileSync(path.join(saved, path.basename(f.path)), JSON.stringify(month));
  }
  require('./fixtures/usage.js').appendRequest(d.file, 'd', { t: Date.now(), model: OPUS, tok: { in: 1e6 } });
  const out = w.run(['audit', '--project', w.project, '--page', saved]);
  assert.match(out, /^audit: 1 sessions on 1 days compared; differences: 2$/m, out);
  assert.match(out, / b: only on the page \(\$1\.00\)/);
  assert.match(out, / c: only in the local transcripts \(\$1\.00\)/);
  assert.doesNotMatch(out, / d: /, 'a session that went on after the sync is not compared');
  assert.match(out, /Claude Code's own cost of the compared sessions: \$2\.50, keel's: \$2\.00 \(\$-0\.50\)/);
});

test('files: after this machine\'s clear, the hour of the clear keeps the requests after it', () => {
  const w = world();
  // A clear at half past an hour two hours ago; a session with one request ten minutes after it.
  const clearAt = Math.floor((Date.now() - 2 * HOUR) / HOUR) * HOUR + 30 * 60000;
  fs.writeFileSync(path.join(w.dir, 'sync-state.json'), JSON.stringify({ cleared_at: new Date(clearAt).toISOString(), synced_until: new Date(clearAt).toISOString() }));
  writeSession(w.root, { id: 'before', rows: [{ t: clearAt - 20 * 60000, prompt: 'old' }, { t: clearAt - 15 * 60000, model: OPUS, tok: { in: 0.2e6 } }], mtimeMs: clearAt - 14 * 60000 });
  writeSession(w.root, { id: 'after', rows: [{ t: clearAt + 5 * 60000, prompt: 'go' }, { t: clearAt + 10 * 60000, model: OPUS, tok: { in: 0.2e6 } }], mtimeMs: clearAt + 12 * 60000 });
  const first = w.files('--page', 'none', '--page-version', '1');
  const month = `data/testpc-${monthOf(clearAt)}.json`;
  const days = read(pathOf(first, month).file).days;
  assert.equal(days.flatMap((d) => d.hours).reduce((n, h) => n + h.req, 0), 1, 'only the request after the clear');
  assert.deepEqual(days.flatMap((d) => d.sessions.map((s) => s.id)), ['after']);
  const page = publishTo(w, first, 2);
  const again = w.files('--page', w.save('index.json', page['data/index.json']), '--page-version', '2');
  assert.ok(!pathOf(again, month), 'the month did not change, so it is not sent again');
});
