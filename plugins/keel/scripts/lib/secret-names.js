'use strict';
// The secret-file rule: whether a project-relative path is a secret file, by its name (catalog.secrets).
const catalog = require('../../data/catalog.json');
const { matchesAny } = require('./patterns.js');

const cache = { loose: new Map(), strict: new Map() };

// A source file named like a secret (secrets.py, credentials.ts) is code, not a secret, except a .env.* name,
// which holds secrets whatever its extension. { strict: true } drops that exemption: for a file that is not
// tracked yet, where a name like credentials.js may hold keys.
function isSecretName(rel, { strict = false } = {}) {
  const memo = strict ? cache.strict : cache.loose;
  let hit = memo.get(rel);
  if (hit === undefined) {
    const { patterns, allowed, code_extensions: code, hidden_as_code: hidden } = catalog.secrets;
    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
    const isCode = !strict && code.includes(ext) && !matchesAny(rel, hidden);
    hit = matchesAny(rel, patterns) && !matchesAny(rel, allowed) && !isCode;
    memo.set(rel, hit);
  }
  return hit;
}

module.exports = { isSecretName };
