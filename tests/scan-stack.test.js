'use strict';
// What the scan makes of a project's stack: ecosystem names read by stack-skills, Flutter, uv
// workspaces and workspace members named by a single folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');

const { scan } = require('../plugins/keel/scripts/scan.js');
const stackSkills = require('../plugins/keel/scripts/stack-skills.js');

function project(files) {
  const dir = tempDir('keel-scan-stack-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const part = (r, p) => r.profile.parts.find((x) => x.path === p);
const parts = (r) => r.profile.parts.map((p) => p.path);

function suggested(dir) {
  const available = path.join(dir, 'available.json');
  fs.writeFileSync(available, JSON.stringify({ available: [], installed: [] }));
  const r = stackSkills.run(dir, { available });
  return r.marketplaces_to_add.flatMap((m) => m.suggest.map((s) => s.plugin));
}

test('stack skills: a project with a lock file still gets the plugins asked for by ecosystem', () => {
  const npm = project({ 'package.json': '{"name":"x"}', 'package-lock.json': '{}' });
  assert.deepEqual(part(scan(npm), '.').ecosystems, ['npm:npm']);
  assert.ok(suggested(npm).includes('supply-chain-risk-auditor'), 'npm with a lock file');
  const poetry = project({ 'pyproject.toml': '[tool.poetry]\nname = "x"\n', 'poetry.lock': '' });
  assert.ok(suggested(poetry).includes('supply-chain-risk-auditor'), 'python with poetry');
  const noLock = project({ 'package.json': '{"name":"x"}' });
  assert.ok(suggested(noLock).includes('supply-chain-risk-auditor'), 'npm without a lock file');
  const ruby = project({ Gemfile: '', 'Gemfile.lock': '' });
  assert.ok(!suggested(ruby).includes('supply-chain-risk-auditor'), 'an ecosystem the plugin does not cover');
});

test('stackOf: ecosystem ids without the package manager, the same for every reader', () => {
  const dir = project({ 'package.json': '{"name":"x"}', 'pnpm-lock.yaml': '', 'go.mod': 'module x\n', 'go.sum': '' });
  const stack = stackSkills.stackOf(dir, scan(dir).profile);
  assert.deepEqual([...stack.ecosystems].sort(), ['go', 'npm']);
});

test('flutter: a project with the Flutter SDK gets flutter test, a plain Dart project dart test', () => {
  const flutter = scan(project({
    'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n',
    'lib/main.dart': 'void main() {}\n',
  }));
  assert.deepEqual(part(flutter, '.').commands.test, ['flutter test']);
  assert.deepEqual(part(flutter, '.').commands.lint, ['dart analyze']);
  assert.ok(!flutter.findings.command_candidates['.'].some((c) => c.command === 'dart test'), 'dart test is not offered for Flutter');
  const dart = scan(project({ 'pubspec.yaml': 'name: lib\ndev_dependencies:\n  test: ^1.0.0\n', 'lib/a.dart': 'void f() {}\n' }));
  assert.deepEqual(part(dart, '.').commands.test, ['dart test']);
});

test('uv workspace: members are parts', () => {
  const r = scan(project({
    'pyproject.toml': '[project]\nname = "root"\n\n[tool.uv.workspace]\nexclude = ["packages/old"]\nmembers = ["packages/*", "tools/cli"]\n',
    'packages/a/pyproject.toml': '[project]\nname = "a"\n',
    'packages/b/pyproject.toml': '[project]\nname = "b"\n',
    'tools/cli/pyproject.toml': '[project]\nname = "cli"\n',
    'other/pyproject.toml': '[project]\nname = "other"\n',
  }));
  assert.equal(r.profile.monorepo_tool, 'uv-workspace');
  assert.deepEqual(parts(r), ['.', 'packages/a', 'packages/b', 'tools/cli']);
});

test('workspace member named by one folder: matches that folder at the root only', () => {
  const cargo = scan(project({
    'Cargo.toml': '[workspace]\nmembers = ["core"]\n',
    'core/Cargo.toml': '[package]\nname = "core"\n',
    'tools/core/Cargo.toml': '[package]\nname = "other"\n',
  }));
  assert.deepEqual(parts(cargo), ['.', 'core']);
  assert.match(cargo.findings.gaps.find((g) => g.kind === 'unmapped-manifest').detail, /tools\/core/);
  const lib = "plugins { id 'java' }\n";
  const gradle = scan(project({
    'settings.gradle': "include ':app'\n",
    'build.gradle': '', 'app/build.gradle': lib, 'sub/app/build.gradle': lib,
  }));
  assert.deepEqual(parts(gradle), ['.', 'app']);
});
