'use strict';
// keel's own messages to the user, in the language of the plugin setting conversation_language.
// Catalogs are locales/<code>.json; a language without a catalog, or a key missing from one, falls back
// to English (locales/en.json). A message is a string with {name} placeholders, or plural forms
// ({"one": ..., "few": ..., "many": ..., "other": ...}) chosen by vars.n with the language's plural rules.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', '..', 'locales');
const cache = new Map();
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function catalog(code) {
  if (!cache.has(code)) {
    let messages = null;
    try { messages = JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8')); } catch { /* no such language */ }
    cache.set(code, messages);
  }
  return cache.get(code);
}

// The catalog for a setting such as "uk", "uk-UA" or "Ukrainian" (its first two letters); English otherwise.
// The default is the language that applies in the current project (its own value, else the machine's).
function pickLanguage(setting = require('./options.js').effectiveOptions().conversation_language) {
  const code = String(setting || '').trim().toLowerCase().split(/[-_\s]/)[0];
  for (const c of [code, code.slice(0, 2)]) if (/^[a-z]{2,3}$/.test(c) && catalog(c)) return c;
  return 'en';
}

function translator(code) {
  const own = catalog(code) || {};
  const en = catalog('en') || {};
  const rules = new Intl.PluralRules(code);
  return (key, vars = {}) => {
    let m = has(own, key) ? own[key] : has(en, key) ? en[key] : key;
    if (m && typeof m === 'object') m = has(m, rules.select(vars.n)) ? m[rules.select(vars.n)] : m.other;
    return String(m).replace(/\{(\w+)\}/g, (s, name) => (vars[name] == null ? s : String(vars[name])));
  };
}

module.exports = { pickLanguage, translator, catalog };
