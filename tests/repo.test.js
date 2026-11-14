'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const gitTest = (name, fn) => test(name, { skip: !hasGit && 'git is not installed' }, fn);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

// What is in git or what `git add -A` would take: tracked files plus untracked ones that are not ignored.
const repoFiles = () => git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
const repoTexts = () => repoFiles()
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);

// A home folder: C:\Users\<name> (any slashes, doubled in a JS string), /Users/<name> or /home/<name>,
// not the tail of a longer path such as src/users/list.js or a URL.
const HOME_PATH = /(?<![\w.\/\\-])(?:[a-z]:[\\/]+users|\/users|\/home)[\\/]+([\w.-]+)/gi;
// Invented names in tests and docs; runner and runneradmin are the GitHub Actions accounts, dev the
// user of the Docker image in tools/docker.
const FIXTURE_USERS = new Set(['ann', 'dev', 'jane', 'jkeeling', 'me', 'runner', 'runneradmin', 'u', 'x']);

// An address whose domain ends in a label of 2+ letters: a@b.c and t@x.y cannot be real, and
// claude-code@2.1.319 is a package version. A local part right after ':' or '/' is a URL's user.
const EMAIL = /(?<![\w.%+:\/-])[\w.%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w.-]*\w)/gi;
// Domains reserved for examples and tests (RFC 2606, RFC 6761).
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;
// Public service addresses: the attribution tests strip them from commits; git@ is GitHub's SSH user.
const SERVICE_ADDRESSES = new Set(['noreply@anthropic.com', 'copilot@github.com', 'git@github.com']);

// The owner's own words (names, other projects), one per line, '#' starts a comment. The file sits in
// .git/info, so it never goes into git; without it the check has nothing to look for.
function privateWords() {
  const file = path.resolve(ROOT, git('rev-parse', '--git-common-dir').trim(), 'info', 'private-words.txt');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#'));
}

// The messages of the commits that main does not have yet.
function branchMessages() {
  const exists = (ref) => { try { git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };
  const base = ['origin/main', 'main'].find(exists);
  return git('log', '--format=%h %B%x00', base ? `${base}..HEAD` : 'HEAD').split('\0').map((m) => m.trim()).filter(Boolean);
}

test('marketplace lists the keel plugin from ./plugins/keel', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.equal(m.name, 'keel');
  assert.deepEqual(m.plugins.map((p) => [p.name, p.source]), [['keel', './plugins/keel']]);
});

test('plugin manifest: name, version and the two userConfig options', () => {
  const p = json('plugins/keel/.claude-plugin/plugin.json');
  assert.equal(p.name, 'keel');
  assert.equal(p.version, '1.4.0');
  assert.equal(p.license, 'MIT');
  assert.deepEqual(Object.keys(p.userConfig).sort(), ['allow_opus', 'conversation_language']);
  assert.equal(p.userConfig.conversation_language.default, 'en');
  assert.equal(p.userConfig.allow_opus.type, 'boolean');
  assert.equal(p.userConfig.allow_opus.default, true);
  assert.equal(p.mcpServers, undefined, 'no MCP servers in the manifest');
});

test('LICENSE is MIT and the plugin ships an identical copy', () => {
  const root = read('LICENSE');
  assert.match(root, /^MIT License/);
  assert.equal(read('plugins/keel/LICENSE'), root);
});

test('line endings are pinned to LF', () => {
  assert.match(read('.gitattributes'), /^\* text=auto eol=lf$/m);
});

test('the dev package requires Node 22 or newer', () => {
  assert.equal(json('package.json').engines.node, '>=22');
  const [major] = process.versions.node.split('.').map(Number);
  assert.ok(major >= 22, `tests run on Node ${process.versions.node}`);
});

gitTest('no development folder goes into git', () => {
  assert.deepEqual(repoFiles().filter((f) => /(^|\/)(\.keel|\.design)\/|^tickets\//.test(f)), []);
});

gitTest('no real home folder or this checkout\'s own path is written in a file', () => {
  const checkout = [ROOT, ROOT.split(path.sep).join('/')].map((p) => p.toLowerCase());
  const hits = [];
  for (const [file, text] of repoTexts()) {
    for (const [, name] of text.matchAll(HOME_PATH)) {
      if (!FIXTURE_USERS.has(name.toLowerCase())) hits.push(`${file}: ${name}`);
    }
    const lower = text.toLowerCase();
    for (const p of checkout) if (lower.includes(p)) hits.push(`${file}: ${p}`);
  }
  assert.deepEqual(hits, []);
});

gitTest('email addresses are only on example domains', () => {
  const hits = [];
  for (const [file, text] of repoTexts()) {
    for (const [address, domain] of text.matchAll(EMAIL)) {
      if (!EXAMPLE_DOMAIN.test(domain) && !SERVICE_ADDRESSES.has(address.toLowerCase())) hits.push(`${file}: ${address}`);
    }
  }
  assert.deepEqual(hits, []);
});

gitTest('no private word is in a file, a file name or a commit message of the branch', () => {
  const words = privateWords();
  if (!words.length) return;
  const hits = [];
  for (const [file, text] of repoTexts()) {
    const lower = `${file}\n${text}`.toLowerCase();
    for (const word of words) if (lower.includes(word)) hits.push(`${file}: ${word}`);
  }
  for (const message of branchMessages()) {
    const lower = message.toLowerCase();
    for (const word of words) if (lower.includes(word)) hits.push(`commit ${message.split(' ')[0]}: ${word}`);
  }
  assert.deepEqual(hits, []);
});
