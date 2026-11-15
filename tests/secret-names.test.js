'use strict';
// A secret file is found by its name; a source file with a secret-like name is code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tempDir } = require('./fixtures/tmp.js');

const { isSecretName } = require('../plugins/keel/scripts/lib/secret-names.js');
const { scan } = require('../plugins/keel/scripts/scan.js');
const { secretCheck } = require('../plugins/keel/scripts/lib/project.js');
const { collectChanges } = require('../plugins/keel/scripts/lib/diff.js');
const catalog = require('../plugins/keel/data/catalog.json');

const CODE = ['secrets.py', 'src/credentials.ts', 'lib/Secrets.PY', 'app/credentials.go', 'credentials.rb', 'secrets.kts', 'id_rsa.php'];
const SECRET = ['.env', '.env.js', 'config/.env.production.ts', 'credentials.json', 'secrets.yml', 'secrets.sh', 'credentials', 'prod.tfvars', 'server.pem', 'tls.key', 'service-account-prod.json', 'credentials.toml', 'secrets.ini'];

test('a source file named like a secret is code; every other secret name stays hidden', () => {
  for (const name of CODE) assert.equal(isSecretName(name), false, name);
  for (const name of SECRET) assert.equal(isSecretName(name), true, name);
});

test('the strict form ignores the code-extension exemption', () => {
  for (const name of [...CODE, ...SECRET]) assert.equal(isSecretName(name, { strict: true }), true, name);
  for (const name of ['.env.example', 'key.pub', 'src/env.js']) assert.equal(isSecretName(name, { strict: true }), false, name);
});

test('a name next to a secret pattern with an extension the catalog does not list stays a secret', () => {
  assert.ok(!catalog.secrets.code_extensions.includes('lua'));
  assert.equal(isSecretName('credentials.lua'), true);
  assert.equal(isSecretName('config/secrets.lua', { strict: true }), true);
});

test('a profile path written by the old name rule does not hide a source file; other paths still count', () => {
  const dir = tempDir('keel-secret-names-');
  fs.mkdirSync(path.join(dir, '.keel'));
  const secret_paths = ['src/secrets.py', 'src/credentials.ts', 'credentials.json', 'config/local.js', 'src/credentials.lua'];
  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), JSON.stringify({ secret_paths }));
  const { isSecret } = secretCheck(dir);
  for (const code of ['src/secrets.py', 'src/credentials.ts']) assert.equal(isSecret(code), false, code);
  for (const secret of ['credentials.json', 'config/local.js', 'src/credentials.lua']) assert.equal(isSecret(secret), true, secret);
});

test('the code extensions in the catalog are plain lowercase extensions of source files', () => {
  const ext = catalog.secrets.code_extensions;
  assert.ok(ext.every((e) => /^[a-z]+$/.test(e)));
  for (const e of ['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'sh']) assert.ok(!ext.includes(e), e);
});

test('the scan counts a secrets.py as Python and does not list it as a secret', () => {
  const dir = tempDir('keel-secret-names-');
  fs.writeFileSync(path.join(dir, 'secrets.py'), 'KEY = 1\n');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  fs.writeFileSync(path.join(dir, 'credentials.json'), '{}\n');
  const { profile } = scan(dir);
  assert.deepEqual(profile.secret_paths, ['credentials.json']);
  assert.equal(profile.languages.find((l) => l.name === 'Python').files, 2);
});

test('reviewers see the change in secrets.py and credentials.ts, not in credentials.json', () => {
  const dir = tempDir('keel-secret-names-');
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@x.y', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  git('init', '-q', '-b', 'main');
  for (const f of ['secrets.py', 'credentials.ts', 'credentials.json']) fs.writeFileSync(path.join(dir, f), 'old\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  for (const f of ['secrets.py', 'credentials.ts', 'credentials.json']) fs.writeFileSync(path.join(dir, f), 'new line\n');
  fs.writeFileSync(path.join(dir, 'untracked_secrets.py'), 'print(1)\n');
  const { files, diff } = collectChanges(dir, { isSecret: isSecretName });
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
  assert.deepEqual(byPath['secrets.py'].added, ['new line']);
  assert.deepEqual(byPath['credentials.ts'].added, ['new line']);
  assert.equal(byPath['credentials.json'].secret, true);
  assert.deepEqual(byPath['credentials.json'].added, []);
  assert.match(diff, /\+new line/);
  assert.match(diff, /\(secret file modified: content not shown\)/);
  assert.equal(byPath['untracked_secrets.py'].secret, false, 'a name that matches no secret pattern');
});
