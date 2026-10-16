'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { makeProject, CANARY, NAMES } = require('./fixtures/projects.js');
const { scan } = require('../plugins/keel/scripts/scan.js');
const { validate } = require('../plugins/keel/scripts/lib/schema.js');

const PROFILE_SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'keel', 'schemas', 'profile.schema.json'), 'utf8'));
const results = Object.fromEntries(NAMES.map((n) => [n, scan(makeProject(n))]));
const part = (name, p) => results[name].profile.parts.find((x) => x.path === p);
const langs = (name) => results[name].profile.languages.map((l) => l.name);
const gaps = (name) => results[name].findings.gaps.map((g) => `${g.kind}:${g.part || ''}`);

test('every fixture yields a profile that passes profile.schema.json', () => {
  for (const n of NAMES) assert.deepEqual(validate(results[n].profile, PROFILE_SCHEMA), [], n);
});

test('JS monorepo: pnpm workspace parts, CI commands first, vendored code ignored', () => {
  const { profile, findings } = results['js-monorepo'];
  assert.equal(profile.monorepo_tool, 'pnpm');
  assert.deepEqual(profile.parts.map((p) => p.path), ['.', 'packages/api', 'packages/web']);
  assert.deepEqual(part('js-monorepo', '.').ecosystems, ['npm:pnpm']);
  assert.deepEqual(part('js-monorepo', '.').commands, { test: ['pnpm -r test'], lint: ['pnpm lint'], types: ['pnpm run typecheck'] });
  assert.deepEqual(part('js-monorepo', 'packages/api').commands, { test: ['pnpm test'], lint: ['pnpm run lint'] });
  assert.deepEqual(langs('js-monorepo'), ['TypeScript'], 'node_modules is not counted');
  const ci = findings.command_candidates['.'].filter((c) => c.source.startsWith('.github/'));
  assert.ok(!ci.some((c) => /git config|install/.test(c.command)), 'setup lines are not checks');
  assert.deepEqual(profile.ai_rules, ['AGENTS.md']);
  assert.deepEqual(findings.docs.adr_dirs, ['docs/adr']);
});

test('Python: uv runner, tools from pyproject sections, alembic, OpenAPI, version pin', () => {
  const { profile, findings } = results.python;
  assert.deepEqual(part('python', '.').ecosystems, ['python:uv']);
  assert.deepEqual(part('python', '.').commands, { test: ['uv run pytest'], lint: ['uv run ruff check .'], types: ['uv run mypy .'] });
  assert.equal(langs('python')[0], 'Python');
  assert.deepEqual(findings.database.migration_dirs, ['alembic/versions']);
  assert.deepEqual(findings.api, ['openapi.yaml']);
  assert.equal(findings.env_versions['.python-version'], '3.12');
  assert.deepEqual(Object.keys(findings.infra).sort(), ['compose', 'docker']);
  assert.ok(profile.triggers.data.includes('**/alembic/versions/**'));
});

test('PHP without a manifest: languages found, gaps raised for the context agent', () => {
  assert.deepEqual(langs('php-legacy'), ['PHP', 'Twig']);
  assert.deepEqual(part('php-legacy', '.').ecosystems, []);
  assert.ok(gaps('php-legacy').includes('no-manifest:.'));
  assert.ok(gaps('php-legacy').includes('unclear-part:system/library/mailer'), 'a bundled library is a question, not a part');
});

test('C#: one .NET part, conventional commands, EF migrations', () => {
  assert.deepEqual(results.csharp.profile.parts.map((p) => p.path), ['.']);
  assert.deepEqual(part('csharp', '.').commands.test, ['dotnet test']);
  assert.deepEqual(langs('csharp'), ['C#']);
  assert.deepEqual(results.csharp.findings.database.migration_dirs, ['Migrations']);
});

test('C++: CMake part, nested CMakeLists are not separate parts, headers count as C++', () => {
  assert.deepEqual(results.cpp.profile.parts.map((p) => p.path), ['.']);
  assert.deepEqual(part('cpp', '.').ecosystems, ['cmake']);
  assert.match(part('cpp', '.').commands.test[0], /ctest/);
  assert.equal(part('cpp', '.').commands.lint, undefined, 'no made-up lint command');
  assert.equal(results.cpp.profile.languages.find((l) => l.name === 'C++').files, 3);
  assert.ok(!langs('cpp').includes('C'));
});

test('Go: Makefile targets beat conventions; a deploy target is never proposed', () => {
  assert.deepEqual(part('go', '.').commands, { test: ['make test'], lint: ['make lint'] });
  const all = results.go.findings.command_candidates['.'].map((c) => c.command);
  assert.ok(!all.some((c) => /deploy|kubectl/.test(c)));
  assert.deepEqual(results.go.findings.api, ['api/service.proto']);
});

test('Rust: cargo workspace members become parts', () => {
  assert.equal(results.rust.profile.monorepo_tool, 'cargo-workspace');
  assert.deepEqual(results.rust.profile.parts.map((p) => p.path), ['.', 'crates/cli', 'crates/core']);
  assert.deepEqual(part('rust', 'crates/core').commands.test, ['cargo test']);
});

test('secret files are listed by path and never opened', () => {
  const expected = { 'js-monorepo': ['.env'], python: ['secrets/prod.pem'], 'php-legacy': ['config/credentials.json'], csharp: [], cpp: ['server.key'], go: [], rust: ['id_ed25519'] };
  for (const n of NAMES) assert.deepEqual(results[n].profile.secret_paths, expected[n], n);

  // Record every file the scan opens while it runs.
  const opened = [];
  const origRead = fs.readFileSync;
  const origOpen = fs.openSync;
  fs.readFileSync = function (p, ...rest) { if (typeof p === 'string') opened.push(p); return origRead.call(this, p, ...rest); };
  fs.openSync = function (p, ...rest) { if (typeof p === 'string') opened.push(p); return origOpen.call(this, p, ...rest); };
  let output;
  try {
    output = NAMES.map((n) => JSON.stringify(scan(makeProject(n)))).join('\n');
  } finally {
    fs.readFileSync = origRead;
    fs.openSync = origOpen;
  }
  const secretNames = ['.env', 'prod.pem', 'credentials.json', 'server.key', 'id_ed25519'];
  const touched = opened.filter((p) => secretNames.includes(path.basename(p)));
  assert.deepEqual(touched, []);
  assert.ok(!output.includes(CANARY));
});

test('in a git repository, ignored secrets are still found by name', (t) => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git is not installed'); return; }
  const dir = makeProject('js-monorepo');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\nnode_modules/\n');
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  try { g('init', '-q'); } catch { t.skip('git cannot create a repository here'); return; }
  const { profile, findings } = scan(dir);
  assert.equal(findings.git, true);
  assert.deepEqual(profile.secret_paths, ['.env']);
  assert.deepEqual(langs('js-monorepo'), profile.languages.map((l) => l.name));
});

test('the CLI prints the same JSON and exits 0', () => {
  const dir = makeProject('go');
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'scan.js'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout).profile.parts, scan(dir).profile.parts);
});

test('--out writes the full result only inside .keel/local/tmp and prints a short summary', () => {
  const dir = makeProject('js-monorepo');
  const script = path.join(__dirname, '..', 'plugins', 'keel', 'scripts', 'scan.js');
  const out = path.join(dir, '.keel', 'local', 'tmp', 'scan.json');
  const r = spawnSync(process.execPath, [script, dir, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^scan: \d+ files; full result in /);
  assert.match(r.stdout, /part packages\/api: npm:pnpm \| test: pnpm test; lint: pnpm run lint/);
  assert.match(r.stdout, /secret files \(never opened\): \.env/);
  assert.ok(!r.stdout.includes(CANARY));
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).profile.monorepo_tool, 'pnpm');
  const outside = spawnSync(process.execPath, [script, dir, '--out', path.join(dir, 'scan.json')], { encoding: 'utf8' });
  assert.match(outside.stdout, /--out must be a file inside/);
  assert.ok(!fs.existsSync(path.join(dir, 'scan.json')));
});

test('installed scanners are found on PATH without running anything', () => {
  const bin = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'keel-bin-'));
  const exe = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks';
  fs.writeFileSync(path.join(bin, exe), 'not a real program');
  const saved = process.env.PATH;
  process.env.PATH = bin;
  try {
    const { findings } = scan(makeProject('go'));
    assert.equal(findings.scanners_installed.gitleaks, true);
    assert.equal(findings.scanners_installed.semgrep, false);
  } finally {
    process.env.PATH = saved;
  }
});

test('other instructions: counted in the project and ~/.claude; the audit is advised from 50 lines or 3 folder entries', () => {
  const os = require('node:os');
  const { describe } = require('../plugins/keel/scripts/lib/instructions.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-ins-'));
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-user-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'one\ntwo\nthree\n');
  fs.mkdirSync(path.join(root, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'rules', 'style.md'), 'Use tabs.\n');
  fs.writeFileSync(path.join(user, 'CLAUDE.md'), 'one\ntwo\n');
  fs.mkdirSync(path.join(user, 'skills', 'notes'), { recursive: true });
  const before = process.env.KEEL_USER_SETTINGS;
  process.env.KEEL_USER_SETTINGS = path.join(user, 'settings.json');
  try {
    const ins = () => scan(root).findings.other_instructions;
    assert.deepEqual(ins(), { project: ['CLAUDE.md (3 lines)', 'rules: 1'], user: ['CLAUDE.md (2 lines)', 'skills: 1'], advise_audit: false });
    assert.equal(describe(ins()), 'other instructions: project CLAUDE.md (3 lines), rules: 1; user ~/.claude CLAUDE.md (2 lines), skills: 1; audit: not needed');
    fs.mkdirSync(path.join(user, 'agents', 'helper'), { recursive: true });
    assert.equal(ins().advise_audit, true, '3 folder entries');
    fs.rmSync(path.join(user, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'line\n'.repeat(45));
    assert.equal(ins().advise_audit, true, '50 lines in all');
    process.env.KEEL_USER_SETTINGS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keel-user-')), 'settings.json');
    assert.equal(describe(scan(fs.mkdtempSync(path.join(os.tmpdir(), 'keel-bare-'))).findings.other_instructions), 'other instructions: none; audit: not needed');
  } finally {
    if (before === undefined) delete process.env.KEEL_USER_SETTINGS; else process.env.KEEL_USER_SETTINGS = before;
  }
});
