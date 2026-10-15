'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scan } = require('../plugins/keel/scripts/scan.js');

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-scan-mono-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const pkg = (extra = {}) => JSON.stringify({ name: 'x', version: '1.0.0', ...extra });
const parts = (r) => r.profile.parts.map((p) => p.path);
const gap = (r, kind) => r.findings.gaps.filter((g) => g.kind === kind);

test('monorepo: a manifest folder that is not a workspace member is reported, not dropped silently', () => {
  const r = scan(project({
    'package.json': pkg({ workspaces: ['packages/*'] }),
    'packages/a/package.json': pkg(),
    'tools/x/package.json': pkg(),
    'services/billing/package.json': pkg(),
  }));
  assert.equal(r.profile.monorepo_tool, 'npm-workspaces');
  assert.deepEqual(parts(r), ['.', 'packages/a']);
  const [g] = gap(r, 'unmapped-manifest');
  assert.ok(g, 'a gap is reported');
  assert.match(g.detail, /2 folder\(s\).*services\/billing, tools\/x/);
});

test('monorepo: the word workspaces in a description is not a workspace marker', () => {
  const r = scan(project({
    'package.json': pkg({ description: 'Manage workspaces and projects' }),
    'api/package.json': pkg(),
  }));
  assert.equal(r.profile.monorepo_tool, null);
  assert.deepEqual(gap(r, 'unmapped-manifest'), []);
  const real = scan(project({ 'package.json': pkg({ workspaces: { packages: ['api'] } }), 'api/package.json': pkg() }));
  assert.equal(real.profile.monorepo_tool, 'npm-workspaces', 'the object form of workspaces counts');
  assert.deepEqual(parts(real), ['.', 'api']);
});

test('monorepo: gradle include is read as a statement, not as a word in a comment', () => {
  const lib = { 'app/build.gradle': "plugins { id 'java' }\n", 'lib/build.gradle': "plugins { id 'java' }\n", 'build.gradle': '' };
  const none = scan(project({ ...lib, 'settings.gradle': "rootProject.name = 'x'\n// we include no sub-projects here\n" }));
  assert.equal(none.profile.monorepo_tool, null);
  const multi = scan(project({ ...lib, 'settings.gradle': "rootProject.name = 'x'\ninclude ':app', ':lib'\n" }));
  assert.equal(multi.profile.monorepo_tool, 'gradle-multiproject');
  assert.deepEqual(parts(multi), ['.', 'app', 'lib']);
  const kts = scan(project({ ...lib, 'settings.gradle.kts': 'include(":app")\ninclude(":lib")\n' }));
  assert.deepEqual(parts(kts), ['.', 'app', 'lib']);
});

test('monorepo: a member folder named like a cache or vendor folder is still a part', () => {
  const r = scan(project({
    'package.json': pkg({ workspaces: ['packages/*'] }),
    'packages/cache/package.json': pkg({ scripts: { test: 'node --test' } }),
    'packages/api/package.json': pkg(),
  }));
  assert.deepEqual(parts(r), ['.', 'packages/api', 'packages/cache']);
  assert.deepEqual(r.profile.parts.find((p) => p.path === 'packages/cache').commands.test, ['npm test']);
  assert.deepEqual(gap(r, 'unmapped-manifest'), []);
  // without a workspace naming it, a vendored folder is still left out
  const plain = scan(project({ 'package.json': pkg(), 'vendor/lib/package.json': pkg(), 'third_party/x/package.json': pkg() }));
  assert.deepEqual(parts(plain), ['.']);
});

test('dotnet: global.json or Directory.Build.props alone does not make a part where the solution is elsewhere', () => {
  const r = scan(project({
    'global.json': '{ "sdk": { "version": "8.0.100" } }\n',
    'Directory.Build.props': '<Project />\n',
    'src/App.sln': '\n',
    'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n',
    'src/App/Program.cs': 'class P { static void Main() {} }\n',
  }));
  assert.deepEqual(r.profile.parts.find((p) => p.path === '.').ecosystems, [], 'no dotnet command at the root');
  assert.equal(r.profile.parts.find((p) => p.path === '.').commands.test, undefined);
  assert.deepEqual(r.profile.parts.find((p) => p.path === 'src').commands.test, ['dotnet test']);
  const here = scan(project({ 'global.json': '{}\n', 'App.sln': '\n', 'App.csproj': '<Project />\n' }));
  assert.deepEqual(here.profile.parts.find((p) => p.path === '.').commands.test, ['dotnet test']);
  assert.ok(r.profile.manifest_fingerprint !== scan(project({ 'src/App.sln': '\n', 'src/App/App.csproj': '<Project Sdk="Microsoft.NET.Sdk" />\n' })).profile.manifest_fingerprint, 'global.json still counts for the re-scan fingerprint');
});
