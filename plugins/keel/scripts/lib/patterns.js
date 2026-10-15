'use strict';
// Matching of catalog patterns against project-relative paths (always with forward slashes).
// A pattern without '/' matches the file name anywhere; with '/' it matches the whole path.
// '*' matches within one path segment, '**/' any number of folders, a trailing '**' everything below.
// A '#' suffix (e.g. 'pyproject.toml#[tool.ruff') is a content marker: the part before '#' is the path.
// Case is ignored: the globs are lowercase (*payment*, *.env) and names are not (PaymentService.java, .ENV),
// and Windows and macOS file systems ignore case anyway.

const cache = new Map();

function toRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
    else if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i += 1; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function matcher(pattern) {
  let m = cache.get(pattern);
  if (!m) {
    const filePart = pattern.split('#')[0];
    const re = toRegExp(filePart);
    m = filePart.includes('/') ? (p) => re.test(p) : (p) => re.test(p.slice(p.lastIndexOf('/') + 1));
    cache.set(pattern, m);
  }
  return m;
}

const matches = (path, pattern) => matcher(pattern)(path);
const matchesAny = (path, patterns) => patterns.some((p) => matcher(p)(path));

module.exports = { matches, matchesAny };
