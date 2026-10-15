'use strict';
// Table tests for the catalog and signal lists the change overview reads, and the level proposal around them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const SCRIPTS = path.join(PLUGIN, 'scripts');
const catalog = require(path.join(PLUGIN, 'data', 'catalog.json'));
const signals = require(path.join(PLUGIN, 'data', 'change-signals.json'));
const { matches, matchesAny } = require(path.join(SCRIPTS, 'lib', 'patterns.js'));
const { analyze, changesBehavior, isBulk } = require(path.join(SCRIPTS, 'lib', 'tier.js'));
const { fanIn, pointsAt } = require(path.join(SCRIPTS, 'lib', 'fanin.js'));
const { secretCheck } = require(path.join(SCRIPTS, 'lib', 'project.js'));
const { isSecret: scanIsSecret } = require(path.join(SCRIPTS, 'scan.js'));
const changes = require(path.join(SCRIPTS, 'changes.js'));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const CONFIG = {
  schema_version: 1,
  repo_language: 'en',
  gates: { checks: [], security_scanners: [] },
  git: { mode: 'manual', main_branch: 'main', ask_before_merge: true, state_in_git: true },
  verification: {
    tier_rules: { gates_only_max_files: 1, basic_max_modules: 1, large_change_lines: 400, very_large_change_lines: 1000 },
    verifier_caps: { basic: 3, standard: 5, maximum: 8 },
  },
  architecture: { file_lines_warn: 700, file_lines_max: 1000 },
  docs: { profile: 1, pattern: 'none' },
};
const PROFILE = {
  parts: [{ path: '.', ecosystems: ['npm'], commands: {} }],
  triggers: {
    security: ['**/auth/**', '**/*auth*', '**/*payment*'],
    data: ['**/migrations/**', '**/*.sql', '**/models/**', '**/routes/**'],
    docs: ['**/*.md', 'docs/**'],
    env: ['**/package.json', '**/Dockerfile*', '.github/workflows/**'],
  },
};
const file = (p, added = [], removed = [], extra = {}) => ({ path: p, oldPath: null, status: 'modified', binary: false, secret: false, added, removed, ...extra });
const run = (files, sizes = {}) => analyze({ files, sizes, fan_in: {} }, PROFILE, CONFIG);
const tierOf = (files, sizes) => run(files, sizes).proposal.tier;
const lines = (n, f = (i) => `call${i}();`) => Array.from({ length: n }, (_, i) => f(i));

test('catalog patterns ignore case: the globs are lowercase, the names are not', () => {
  assert.ok(matches('src/PaymentService.java', '**/*payment*'));
  assert.ok(matches('Controllers/AuthController.cs', '**/*auth*'));
  assert.ok(matches('App/Auth/Login.cs', '**/auth/**'));
  assert.ok(matches('SRC/Data/Schema.PRISMA', '**/schema.prisma'));
  assert.ok(matchesAny('Docker/DOCKERFILE.dev', ['**/Dockerfile*']));
  assert.ok(!matches('src/pay.js', '**/*payment*'));
});

test('level proposal: a security-path file is recognised whatever its case', () => {
  assert.equal(tierOf([file('src/PaymentService.java', ['const amount = order.total;'])]), 'maximum', 'money in PaymentService.java');
  assert.equal(tierOf([file('src/Auth/Login.cs', ['if (!user.IsAdmin) return;'])]), 'maximum', 'access code in Auth/Login.cs');
});

test('secret files are found whatever their case', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-secret-'));
  const { isSecret } = secretCheck(dir);
  for (const name of ['.ENV', '.Env.Local', 'Credentials.json', 'server.PEM', 'id_RSA', 'Secrets.yml', 'config/Prod.TFVARS']) {
    assert.equal(isSecret(name), true, name);
    assert.equal(scanIsSecret(name), true, `scan: ${name}`);
  }
  for (const name of ['.ENV.EXAMPLE', 'Key.PUB', 'src/Environment.ts']) assert.equal(isSecret(name), false, name);
});

test('a path from the profile counts as a secret too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-secret-'));
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'profile.json'), JSON.stringify({ secret_paths: ['config/prod.js'] }));
  assert.equal(secretCheck(dir).isSecret('config/prod.js'), true);
});

// One name per catalog secret pattern. A new pattern fails the table until it gets a name here.
const SECRET_SAMPLES = {
  '.env': '.env', '.env.*': 'config/.env.local', '*.env': 'prod.env', '*.pem': 'certs/server.pem', '*.key': 'tls.key',
  '*.p12': 'a.p12', '*.pfx': 'a.pfx', '*.jks': 'a.jks', '*.keystore': 'release.keystore',
  'id_rsa*': 'id_rsa', 'id_dsa*': 'id_dsa', 'id_ecdsa*': 'id_ecdsa', 'id_ed25519*': 'id_ed25519',
  'credentials*': 'credentials', '*credentials.json': 'gcp-credentials.json', 'service-account*.json': 'service-account-prod.json',
  '*.tfstate': 'terraform.tfstate', '*.tfstate.*': 'terraform.tfstate.backup', '*.tfvars': 'prod.tfvars',
  '.npmrc': '.npmrc', '.pypirc': '.pypirc', '.netrc': '.netrc', '.htpasswd': '.htpasswd',
  'secrets.*': 'secrets.yml', '*.secret': 'db.secret', '*.secrets': 'app.secrets',
  '.envrc': '.envrc', '*.tfvars.json': 'prod.tfvars.json', '.git-credentials': '.git-credentials', '.dockercfg': '.dockercfg',
  '*.ppk': 'putty.ppk', '*.p8': 'AuthKey_ABC123.p8', '*.gpg': 'backup.gpg', 'client_secret*.json': 'client_secret_123.apps.json',
  kubeconfig: 'kubeconfig', '*.kdbx': 'vault.kdbx',
};

test('secret patterns: every pattern has a name that matches it; public and example files are not secrets', () => {
  assert.deepEqual(Object.keys(SECRET_SAMPLES).sort(), [...catalog.secrets.patterns].sort(), 'the table covers exactly the catalog');
  const { isSecret } = secretCheck(fs.mkdtempSync(path.join(os.tmpdir(), 'keel-secret-')));
  for (const [pattern, name] of Object.entries(SECRET_SAMPLES)) {
    assert.ok(matches(name, pattern), `${name} matches ${pattern}`);
    assert.equal(isSecret(name), true, name);
  }
  for (const name of ['.env.example', '.env.sample', 'prod.env.example', 'key.pub', 'id_rsa.pub', 'README.md', 'package.json', 'src/kubeconfig.go', 'src/env.js', 'config.json', 'secret-santa.js']) {
    assert.equal(isSecret(name), false, name);
  }
});

// A positive and a negative line for each pattern of change-signals.json, in file order.
const SIGNAL_SAMPLES = {
  security: [
    { yes: ['const password = req.body.password;', 'headers.Authorization = `Bearer ${jwt}`'], no: ['const passage = 1;'] },
    { yes: ['if (!user.isAdmin) return;', 'authorize(user)'], no: ['const author = a;'] },
    { yes: ['eval(code)', 'const out = exec(cmd);', 'execSync("ls")', 'system("ls")', 'x = shell_exec($c)'], no: ['const m = re.exec(line);', 'regex.exec(s)', 'const e = this.exec(x)', 'myexec(a)'] },
    { yes: ['child_process.exec(cmd)', 'os.system(cmd)', 'pickle.loads(blob)', 'yaml.load(text)', 'subprocess.Popen(args)', 'Runtime.getRuntime().exec(cmd)'], no: ['await db.exec(sql)', 'yaml.safe_load(text)'] },
    { yes: ['el.innerHTML = html;', '<div v-html="x">', '{{ value|safe }}'], no: ['el.textContent = html;'] },
    { yes: ['hashlib.md5(data)', 'const n = Math.random();'], no: ['const m = md5sum;'] },
  ],
  money: [{ yes: ['const total = price * qty;', 'refund(order)'], no: ['const pricing_page = 1;'] }],
  deletion: [
    { yes: ['DROP TABLE users;', 'TRUNCATE TABLE logs', 'DELETE FROM orders;', 'db.query("DELETE FROM orders")'], no: ['DELETE FROM orders WHERE id = 1', 'delete from t where x in (select 1)', 'SELECT 1 FROM t'] },
    { yes: ['dropColumn("name")', 'op.drop_table("t")', 'Model.deleteMany({})', 'qs.delete_all()'], no: ['dropdown()'] },
  ],
  file_removal: [
    { yes: ['rm -rf build/', 'shutil.rmtree(path)', 'fs.rmSync(dir, { recursive: true })', 'fs.rm(dir, { recursive: true, force: true }, cb)'], no: ['fs.rmSync(tmpFile)', 'fs.rm(file, cb)', 'os.remove(f)'] },
  ],
};

test('change signals: every pattern fires on its examples and stays quiet on the near misses', () => {
  for (const [kind, samples] of Object.entries(SIGNAL_SAMPLES)) {
    const patterns = signals.content[kind].patterns;
    assert.equal(patterns.length, samples.length, `${kind}: the table covers every pattern`);
    patterns.forEach((p, i) => {
      const re = new RegExp(p, 'i');
      for (const line of samples[i].yes) assert.ok(re.test(line), `${kind}[${i}] should match: ${line}`);
      for (const line of samples[i].no) assert.ok(!re.test(line), `${kind}[${i}] should not match: ${line}`);
    });
  }
  assert.deepEqual(Object.keys(SIGNAL_SAMPLES).sort(), Object.keys(signals.content).sort());
});

test('level proposal: a regex exec call is not a shell, a DELETE with WHERE and a single file removal are not bulk', () => {
  assert.equal(run([file('src/lib/parse.js', ['const m = re.exec(line);'])]).groups.security, undefined);
  assert.equal(tierOf([file('src/lib/parse.js', ['const m = re.exec(line);'])]), 'basic');
  assert.equal(tierOf([file('src/lib/run.js', ['execSync(cmd);'])]), 'standard', 'a real shell call calls the security group');
  assert.equal(tierOf([file('src/lib/repo.js', ['db.query("DELETE FROM orders WHERE id = $1", [id]);'])]), 'basic');
  assert.equal(tierOf([file('src/lib/repo.js', ['db.query("DELETE FROM orders");'])]), 'maximum');
  assert.equal(tierOf([file('src/lib/tmp.js', ['fs.rmSync(file, { force: true });'])]), 'basic');
  // A recursive file removal deletes files, not data: the security group checks the path, no Maximum.
  assert.equal(tierOf([file('src/lib/tmp.js', ['fs.rmSync(dir, { recursive: true, force: true });'])]), 'standard');
  assert.match(run([file('scripts/build.js', ['fs.rmSync(outDir, { recursive: true });'])]).groups.security.reasons.join(' '), /recursive file removal/);
});

test('level proposal: a money word in ordinary code is a signal, not a security review', () => {
  const cart = run([file('src/cart/total.js', ['const total = price * qty;'])]);
  assert.equal(cart.proposal.tier, 'basic');
  assert.equal(cart.groups.security, undefined);
  assert.equal(cart.signals.money.length, 1, 'still listed among the signals');
  assert.equal(tierOf([file('src/PaymentService.java', ['const amount = order.total;'])]), 'maximum', 'business code still escalates');
  // Three ordinary files with money words listed first never hide the business file.
  const ordinary = ['src/a/cart.js', 'src/a/item.js', 'src/a/list.js'].map((p) => file(p, ['const total = price * qty;']));
  assert.equal(tierOf([...ordinary, file('src/PaymentService.java', ['const amount = order.total;'])]), 'maximum');
});

test('text files: only doc-like .txt names are docs; requirements.txt and CMakeLists.txt are code and manifests', () => {
  for (const p of ['README.txt', 'docs/guide.txt', 'NOTES.txt', 'notes.md', 'LICENSE']) assert.equal(changesBehavior(file(p, ['words'])), false, p);
  for (const p of ['requirements.txt', 'CMakeLists.txt', 'robots.txt', 'data/words.txt']) assert.equal(changesBehavior(file(p, ['words'])), true, p);
  assert.equal(run([file('CMakeLists.txt', ['add_library(a a.c)'])]).groups.docs, undefined);
  assert.deepEqual(run([file('requirements.txt', ['flask==3.0'])]).groups.env.topics, ['dependencies']);
});

test('every migration folder and API file of the catalog calls its topic', () => {
  for (const dir of catalog.database.migration_dirs) {
    for (const prefix of ['', 'service/']) {
      const p = `${prefix}${dir}/0001_init.sql`;
      const a = run([file(p, ['CREATE TABLE t (id int);'], [], { status: 'added' })]);
      assert.deepEqual(a.migrations, [p], p);
      assert.equal(a.proposal.tier, 'maximum', p);
    }
  }
  for (const pattern of catalog.api) {
    const p = `api/${pattern.replace('*', 'service')}`;
    assert.ok(run([file(p, ['x'])]).groups.data.topics.includes('api'), p);
  }
});

test('manifests are matched as globs: App.csproj, x.gemspec and a .cabal file call the dependencies topic', () => {
  for (const p of ['src/App/App.csproj', 'lib/thing.gemspec', 'pkg.cabal', 'App.sln', 'Directory.Build.props', 'package-lock.json', 'sub/Cargo.lock']) {
    const a = run([file(p, ['x'])]);
    assert.ok(a.groups.env && a.groups.env.topics.includes('dependencies'), p);
  }
  assert.equal(run([file('src/app.js', ['x'])]).groups.env, undefined);
});

test('lock files, generated and vendored files do not size the change, and still call the dependencies topic', () => {
  const lock = file('package-lock.json', lines(3000), lines(1500));
  const a = run([file('src/billing/sum.js', lines(7)), lock]);
  assert.equal(a.totals.lines, 7);
  assert.deepEqual([a.totals.bulk_files, a.totals.bulk_lines], [1, 4500]);
  assert.equal(a.proposal.tier, 'basic', 'not a larger level for 4500 lock lines');
  assert.match(a.proposal.reasons.join(' | '), /touches env \(manifest package-lock\.json\)/, 'the dependency change is named');
  assert.ok(a.groups.env.topics.includes('dependencies'));
  assert.equal(a.modules.join(), 'billing');
  assert.equal(tierOf([file('src/billing/sum.js', lines(7)), file('gen/api.pb.go', lines(3000))]), 'basic', 'generated code');
  assert.equal(tierOf([file('src/billing/sum.js', lines(7)), file('web/app.min.js', lines(2000)), file('web/vendor/lib.js', lines(2000))]), 'basic', 'minified and vendored files');
  for (const p of ['yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock', 'poetry.lock', 'go.sum', 'a/b/composer.lock', 'x.min.css', 'x.map', 'node_modules/a/b.js']) assert.equal(isBulk(p), true, p);
  for (const p of ['src/lock.js', 'src/cache/lru.js', 'src/vendor.js', 'package.json']) assert.equal(isBulk(p), false, p);
  const lockOnly = run([file('package-lock.json', lines(1500), lines(1500))]);
  assert.equal(lockOnly.proposal.tier, 'basic', 'a lock file alone: Basic, and the dependency change is named');
  assert.match(lockOnly.proposal.reasons.join(' | '), /touches env/);
});

test('level proposal: boundaries and kinds of change that must not drop to gates-only', () => {
  assert.equal(tierOf([file('src/billing/sum.js', [], lines(1000))]), 'maximum', '1000 removed lines');
  assert.equal(tierOf([file('src/billing/sum.js', [], lines(999))]), 'standard', '999 lines: large but not very large');
  assert.equal(tierOf([file('assets/logo.png', [], [], { binary: true })]), 'basic', 'a binary');
  assert.equal(tierOf([file('src/billing/total.js', [], [], { status: 'renamed', oldPath: 'src/billing/sum.js' })]), 'basic', 'a pure rename');
  assert.equal(tierOf([file('src/billing/old.js', [], lines(5), { status: 'deleted' })]), 'basic', 'a deleted file');
  assert.equal(tierOf([file('config.json', ['"retries": 5'], ['"retries": 3'])]), 'basic', 'one changed line of config');
  assert.equal(tierOf([file('README.md', ['text'])]), 'gates-only', 'the control: docs only');
});

test('file sizes: 700 lines is over warn, 1000 over max, 699 nothing', () => {
  const size = (now) => run([file('src/billing/sum.js', ['x()'])], { 'src/billing/sum.js': { now, before: 10 } }).sizes;
  assert.deepEqual(size(699), []);
  assert.deepEqual(size(700).map((s) => [s.lines, s.level]), [[700, 'over warn']]);
  assert.deepEqual(size(999).map((s) => s.level), ['over warn']);
  assert.deepEqual(size(1000).map((s) => [s.lines, s.level, s.grew]), [[1000, 'over max', 990]]);
});

test('fan-in: TypeScript NodeNext imports ./a.js for a.ts', () => {
  assert.ok(pointsAt('./a.js', 'src/b.ts', 'src/a.ts', 'js'));
  assert.ok(pointsAt('../lib/a.js', 'src/app/b.tsx', 'src/lib/a.tsx', 'js'));
  assert.ok(pointsAt('./a.mjs', 'src/b.mts', 'src/a.mts', 'js'));
  assert.ok(pointsAt('./a.cjs', 'src/b.cts', 'src/a.cts', 'js'));
  assert.ok(pointsAt('./a.js', 'src/b.js', 'src/a.js', 'js'), 'a real .js file still matches');
  assert.ok(!pointsAt('./a.js', 'src/b.ts', 'src/other.ts', 'js'));
  assert.ok(!pointsAt('./a.js', 'src/b.ts', 'src/a.css', 'js'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-fanin-'));
  const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  put('src/core.ts', 'export const a = 1;\n');
  put('src/x.ts', "import { a } from './core.js';\n");
  put('src/y.ts', "export { a } from './core.js';\n");
  const r = fanIn(dir, ['src/core.ts'], () => false);
  assert.deepEqual(r.counts, { 'src/core.ts': 2 });
  assert.equal(r.truncated, false);
  const cut = fanIn(dir, ['src/core.ts'], () => false, { maxScan: 2 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.scanned, 2);
});

test('changes.js says when the fan-in scan stopped early', (t) => {
  if (!hasGit) { t.skip('git is not installed'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keel-fanin-note-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, '.keel'));
  fs.writeFileSync(path.join(dir, '.keel', 'config.json'), JSON.stringify(CONFIG));
  fs.writeFileSync(path.join(dir, '.keel', '.gitignore'), 'local/\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  g('add', '-A');
  g('commit', '-qm', 'init');
  fs.appendFileSync(path.join(dir, 'src', 'a.js'), 'b\n');
  assert.doesNotMatch(changes.run(dir, {}), /fan-in incomplete/);
  const result = JSON.parse(fs.readFileSync(path.join(dir, '.keel', 'local', 'tmp', 'changes.json'), 'utf8'));
  assert.equal(result.fan_in_incomplete, null);
  assert.match(changes.summary({ ...result, fan_in_incomplete: 20000 }), /^fan-in incomplete \(20000 files scanned\)/m);
});
