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

const DEV_FOLDER = /(^|\/)(\.keel|\.design)\/|^tickets\//;

// A home folder: C:\Users\<name> (any slashes, doubled in a JS string), /Users/<name> or /home/<name>,
// also after file:// and in WSL's /mnt/<drive>/Users, but not the tail of a longer path such as
// src/users/list.js or a URL. The name is letters of any script; a dot ending a sentence is not part of it.
const HOME_PATH = /(?:(?<![\w.\/\\-])|(?<=file:\/\/)|(?<=\/mnt\/[a-z]))(?:[a-z]:[\\/]+users|\/users|\/home)[\\/]+([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/giu;
// Invented names in tests and docs; runner and runneradmin are the GitHub Actions accounts, dev the
// user of the Docker image in tools/docker.
const FIXTURE_USERS = new Set(['ann', 'dev', 'jane', 'jkeeling', 'me', 'runner', 'runneradmin', 'u', 'x']);
const realHomeNames = (text) => [...text.matchAll(HOME_PATH)].map((m) => m[1]).filter((name) => !FIXTURE_USERS.has(name.toLowerCase()));
// This checkout's path as written with backslashes, forward slashes and doubled backslashes (JSON, JS).
// A root of fewer than 3 parts, such as a container's /work, is ordinary text, not a trace of a machine.
function checkoutForms(root) {
  if (root.split(/[\\/]+/).filter(Boolean).length < 3) return [];
  return [...new Set([root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')])].map((p) => p.toLowerCase());
}

// An address whose domain ends in a label of 2+ letters: a@b.c and t@x.y cannot be real, and
// claude-code@2.1.319 is a package version. A local part after '://' and an optional 'name:' is a
// URL's user (https://bot:token@host); one after mailto: or 'Contact:' is an address.
const EMAIL = /(?<![\w.%+\/-])(?<!:\/\/[^\s@\/?#]*)[\w.%+-]+@((?:[a-z0-9-]+\.)+[a-z]{2,})(?![\w.-]*\w)/gi;
// Domains reserved for examples and tests (RFC 2606, RFC 6761).
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;
// Public service addresses: the attribution tests strip them from commits; git@ is GitHub's SSH user.
const SERVICE_ADDRESSES = new Set(['noreply@anthropic.com', 'copilot@github.com', 'git@github.com']);
const realAddresses = (text) => [...text.matchAll(EMAIL)]
  .filter(([address, domain]) => !EXAMPLE_DOMAIN.test(domain) && !SERVICE_ADDRESSES.has(address.toLowerCase()))
  .map(([address]) => address);

// One word per line, '#' starts a comment. Windows PowerShell 5.1 writes UTF-16 LE with the bytes FF FE
// first ('>', Out-File); read as UTF-8 that text has a NUL in every word and would match nothing.
function parseWords(bytes) {
  const utf16 = bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = utf16 ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
  if (text.includes('\0')) throw new Error('private-words.txt must be UTF-8 or UTF-16 text');
  return text.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => w && !w.startsWith('#'));
}
const wordsIn = (words, text) => { const lower = text.toLowerCase(); return words.filter((w) => lower.includes(w)); };

// The owner's own words (names, other projects). The file sits in .git/info, so it never goes into
// git; without it the check has nothing to look for.
function privateWords() {
  const file = path.resolve(ROOT, git('rev-parse', '--git-common-dir').trim(), 'info', 'private-words.txt');
  return fs.existsSync(file) ? parseWords(fs.readFileSync(file)) : [];
}

// `git log --format=%h%x01%B%x00` output as [short hash, message] pairs; the hash stays out of the
// message, so a word of hex letters cannot match it.
const parseLog = (out) => out.split('\0').map((c) => c.trim()).filter(Boolean).map((c) => c.split('\x01'));

// The commits that main does not have yet.
function branchCommits() {
  const exists = (ref) => { try { git('rev-parse', '--verify', '-q', ref); return true; } catch { return false; } };
  const base = ['origin/main', 'main'].find(exists);
  return parseLog(git('log', '--format=%h%x01%B%x00', base ? `${base}..HEAD` : 'HEAD'));
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

test('the public-repo checks catch what they are for and let fixtures through', () => {
  // Samples that must be caught carry a '|' that is taken out before the check, so this file passes
  // the repository checks below.
  const live = (s) => s.replaceAll('|', '');
  assert.deepEqual(['.keel/a', 'x/.design/b', 'tickets/c', 'docs/tickets/d', 'plugins/keel/a'].filter((f) => DEV_FOLDER.test(f)), ['.keel/a', 'x/.design/b', 'tickets/c']);

  const home = (s) => realHomeNames(live(s)).map((n) => n.toLowerCase());
  for (const s of ['C:\\Us|ers\\bob\\x', 'C:\\\\Us|ers\\\\bob', 'c:/us|ers/bob', '"/ho|me/bob/x"', ' /Us|ers/bob', 'file:///ho|me/bob/a', '/mnt/c/Us|ers/bob/a']) {
    assert.deepEqual(home(s), ['bob'], s);
  }
  assert.deepEqual(home('C:\\Us|ers\\Олена\\x'), ['олена']);
  for (const s of ['src/users/list.js', 'https://example.com/home/page', '/home/ann/x', 'see /home/ann.', 'C:\\Users\\RUNNER~1', '/home/dev']) {
    assert.deepEqual(home(s), [], s);
  }

  const forms = checkoutForms('D:\\src\\app');
  assert.ok(forms.some((p) => JSON.stringify('D:\\src\\app\\x').toLowerCase().includes(p)), 'the path as JSON writes it');
  assert.ok(forms.some((p) => 'd:/src/app/x'.includes(p)), 'the path with forward slashes');
  assert.deepEqual(checkoutForms('/work'), [], 'a root this short is in ordinary text');

  for (const s of ['write to bob|@gmail.com', 'end bob|@gmail.com.', '<bob|@gmail.com>', '[mail](mailto:bob|@gmail.com)', 'Contact:bob|@gmail.com', 'https://x.io?email=bob|@gmail.com', 'a|@example.com.evil.io']) {
    assert.equal(realAddresses(live(s)).length, 1, s);
  }
  for (const s of ['a@example.com', 'b@mail.example.org', 'c@shop.test', 't@x.y', 'a@b.c', 'claude-code@2.1.319', 'noreply@anthropic.com', 'git@github.com:team/web.git', 'https://bot:s3cret@GitHub.com/x', 'https://token@github.com/x', 'ssh://git@github.com/x']) {
    assert.deepEqual(realAddresses(s), [], s);
  }

  const words = parseWords(Buffer.from('# names\nAbe\n\r\nSecret Name\r\n'));
  assert.deepEqual(words, ['abe', 'secret name']);
  assert.deepEqual(parseWords(Buffer.from('\uFEFFabe\n')), ['abe'], 'a UTF-8 BOM');
  assert.deepEqual(parseWords(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('abe\r\nsecret\r\n', 'utf16le')])), ['abe', 'secret'], 'UTF-16 from PowerShell 5.1');
  assert.throws(() => parseWords(Buffer.from('a\0b\0')), /UTF-8/);
  assert.deepEqual(wordsIn(words, 'Hello ABE, and a secret name'), ['abe', 'secret name']);
  assert.deepEqual(wordsIn(words, 'nothing here'), []);
  assert.deepEqual(parseLog('80abe76\x01clean message\n\0\n1234567\x01fix: two\n\nbody\n\0'), [['80abe76', 'clean message'], ['1234567', 'fix: two\n\nbody']]);
});

gitTest('no development folder goes into git', () => {
  assert.deepEqual(repoFiles().filter((f) => DEV_FOLDER.test(f)), []);
});

gitTest('no real home folder or this checkout\'s own path is written in a file', () => {
  const checkout = checkoutForms(ROOT);
  const hits = [];
  for (const [file, text] of repoTexts()) {
    for (const name of realHomeNames(text)) hits.push(`${file}: ${name}`);
    const lower = text.toLowerCase();
    for (const p of checkout) if (lower.includes(p)) hits.push(`${file}: ${p}`);
  }
  assert.deepEqual(hits, []);
});

gitTest('email addresses are only on example domains', () => {
  const hits = [];
  for (const [file, text] of repoTexts()) for (const address of realAddresses(text)) hits.push(`${file}: ${address}`);
  assert.deepEqual(hits, []);
});

gitTest('no private word is in a file, a file name or a commit message of the branch', () => {
  const words = privateWords();
  if (!words.length) return;
  const hits = [];
  for (const [file, text] of repoTexts()) for (const word of wordsIn(words, `${file}\n${text}`)) hits.push(`${file}: ${word}`);
  for (const [hash, message] of branchCommits()) for (const word of wordsIn(words, message)) hits.push(`commit ${hash}: ${word}`);
  assert.deepEqual(hits, []);
});
