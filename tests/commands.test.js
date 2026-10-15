'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { programOf, kindOfName, kindOfCommand, runLines, listItems, makeTargets, justRecipes, taskNames, findCommands } = require('../plugins/keel/scripts/lib/commands.js');
const { matches } = require('../plugins/keel/scripts/lib/patterns.js');

test('script names map to kinds; ambiguous names do not', () => {
  assert.equal(kindOfName('test:unit'), 'test');
  assert.equal(kindOfName('lint'), 'lint');
  assert.equal(kindOfName('typecheck'), 'types');
  assert.equal(kindOfName('check'), null);
  assert.equal(kindOfName('deploy'), null);
});

test('the program of a command comes after leading NAME=value words', () => {
  assert.equal(programOf('MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 detect'), 'docker');
  assert.equal(programOf(`  A=1 B="two words" C='x y' D= gitleaks detect`), 'gitleaks');
  assert.equal(programOf('gitleaks detect --no-banner'), 'gitleaks');
  assert.equal(programOf('./bin/scan --x=1'), './bin/scan');
  assert.equal(kindOfCommand('DEBUG=1 echo running tests'), null, 'a setup line stays one after an env prefix');
});

test('CI lines: checks are recognised, setup lines are not', () => {
  assert.equal(kindOfCommand('pnpm -r test'), 'test');
  assert.equal(kindOfCommand('npx tsc --noEmit'), 'types');
  assert.equal(kindOfCommand('ruff check .'), 'lint');
  assert.equal(kindOfCommand('git config --global user.email ci@shop.test'), null);
  assert.equal(kindOfCommand('pnpm install --frozen-lockfile'), null);
  assert.equal(kindOfCommand('echo "running tests"'), null);
  assert.equal(kindOfCommand('TEST_DB=ci.test pnpm build'), null);
});

test('YAML run steps, script lists, Makefile, justfile and Taskfile are parsed', () => {
  const gha = 'steps:\n  - run: npm ci\n  - name: t\n    run: |\n      npm test\n      npm run lint\n  - uses: x\n';
  assert.deepEqual(runLines(gha), ['npm ci', 'npm test', 'npm run lint']);
  assert.deepEqual(listItems('test:\n  script:\n    - pytest -q\n    - name: x\n'), ['pytest -q']);
  assert.deepEqual(makeTargets('.PHONY: test\ntest: build\n\tgo test\nX := 1\nlint:\n'), ['test', 'lint']);
  assert.deepEqual(justRecipes('set shell := ["bash"]\ntest arg="x":\n  cargo test\n@lint:\n  cargo clippy\n'), ['test', 'lint']);
  assert.deepEqual(taskNames('version: 3\ntasks:\n  test:\n    cmds: [go test]\n  lint:fix:\n    cmds: [x]\nvars:\n  A: 1\n'), ['test', 'lint:fix']);
});

test('catalog patterns: names anywhere, paths from the root, ** below', () => {
  assert.ok(matches('a/b/package.json', 'package.json'));
  assert.ok(!matches('a/b/package.json', 'b/package.json'));
  assert.ok(matches('.github/workflows/ci.yml', '.github/workflows/*.yml'));
  assert.ok(!matches('.github/workflows/sub/ci.yml', '.github/workflows/*.yml'));
  assert.ok(matches('src/auth/login.ts', '**/auth/**'));
  assert.ok(matches('auth/x.ts', '**/auth/**'));
  assert.ok(matches('x/.env.local', '.env.*'));
  assert.ok(matches('pyproject.toml', 'pyproject.toml#[tool.ruff'));
});

test('install and setup lines are never checks, even when they name a test extra', () => {
  assert.equal(kindOfCommand('pip install -e ".[test]"'), null);
  assert.equal(kindOfCommand('uv sync --extra test'), null);
  assert.equal(kindOfCommand('pip install -r requirements-test.txt'), null);
  assert.equal(kindOfCommand('npm ci'), null);
  assert.equal(kindOfCommand('npm ci && npm test'), 'test', 'the check after the setup step is found');
  assert.equal(kindOfCommand('cd app && pnpm run lint'), 'lint');
});

test('a script name with a colon keeps its words: npm run test:ci is a test; URLs, emails and KEY=value are dropped', () => {
  assert.equal(kindOfCommand('npm run test:ci'), 'test');
  assert.equal(kindOfCommand('yarn lint:ci'), 'lint');
  assert.equal(kindOfCommand('curl https://example.com/test'), null);
  assert.equal(kindOfCommand('deploy --url https://test.example.com --user ci@shop.test'), null);
});

test('CI lines: a quote is removed only when it wraps the whole value; lines with a GitHub expression are dropped', () => {
  const gha = [
    'steps:',
    '  - run: "npm run lint"',
    "  - run: 'pytest -q'",
    '  - run: npm test -- --grep "a b"',
    '  - run: echo "a" && npm test "b"',
    '  - run: npm run ${{ matrix.script }}',
    '  - run: |',
    '      npm run ${{ matrix.script }}',
    '      npm run typecheck',
  ].join('\n');
  assert.deepEqual(runLines(gha), ['npm run lint', 'pytest -q', 'npm test -- --grep "a b"', 'echo "a" && npm test "b"', 'npm run typecheck']);
  assert.deepEqual(listItems('script:\n  - "npm test"\n  - npm run x --y "z"\n'), ['npm test', 'npm run x --y "z"']);
});

function scriptsOf(pkg, packageManagers = { npm: 'npm' }) {
  const catalog = { task_runners: { make: [], just: [], task: [] }, git_hooks: { lefthook: [], husky: [] } };
  const files = new Set(['package.json']);
  const found = findCommands({ part: '.', files, readText: () => JSON.stringify(pkg), ecosystems: [], packageManagers, catalog, isRoot: false });
  return Object.fromEntries(['test', 'lint', 'types'].map((k) => [k, found.filter((c) => c.kind === k).map((c) => c.command)]));
}

test('package scripts: the exact names come first; watch, fix and dev variants and the npm init placeholder are skipped', () => {
  assert.deepEqual(scriptsOf({ scripts: { 'test:watch': 'vitest', 'test:unit': 'vitest run', test: 'vitest run', 'lint:fix': 'eslint --fix .', lint: 'eslint .', typecheck: 'tsc --noEmit' } }),
    { test: ['npm test', 'npm run test:unit'], lint: ['npm run lint'], types: ['npm run typecheck'] });
  assert.deepEqual(scriptsOf({ scripts: { test: 'echo "Error: no test specified" && exit 1', lint: 'eslint .' } }).test, []);
  assert.deepEqual(scriptsOf({ scripts: { 'dev:test': 'x', 'test-watch': 'x', 'test:e2e': 'playwright test' } }).test, ['npm run test:e2e']);
});

test('bun: the package script test runs as bun run test, not bun\'s own test runner', () => {
  assert.deepEqual(scriptsOf({ scripts: { test: 'vitest run', lint: 'eslint .' } }, { npm: 'bun' }), { test: ['bun run test'], lint: ['bun run lint'], types: [] });
  assert.deepEqual(scriptsOf({ scripts: { test: 'jest' } }, { npm: 'pnpm' }).test, ['pnpm test']);
  assert.deepEqual(scriptsOf({ scripts: { test: 'jest' } }, { npm: 'yarn' }).test, ['yarn test']);
});
