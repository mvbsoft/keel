'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pickLanguage, translator, catalog } = require('../plugins/keel/scripts/lib/i18n.js');

const LOCALES = path.join(__dirname, '..', 'plugins', 'keel', 'locales');

test('i18n: the language comes from the setting; unknown or empty falls back to English', () => {
  assert.equal(pickLanguage('uk'), 'uk');
  assert.equal(pickLanguage('uk-UA'), 'uk');
  assert.equal(pickLanguage('Ukrainian'), 'uk');
  assert.equal(pickLanguage('de'), 'en');
  assert.equal(pickLanguage(''), 'en');
  assert.equal(pickLanguage('../en'), 'en', 'a setting is never a path');
});

test('i18n: placeholders, plural forms by the language rules, fallback to English and to the key', () => {
  const uk = translator('uk');
  const en = translator('en');
  assert.equal(en('report.turns', { n: 3 }), 'user turns: 3');
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => uk('report.requests', { n })), ['запит', 'запити', 'запитів', 'запитів', 'запит', 'запити', 'запитів']);
  assert.deepEqual([1, 2].map((n) => en('report.requests', { n })), ['request', 'requests']);
  assert.equal(en('report.share_week', { pct: '0.5', rate: '18.00', n: 1 }), 'week: about 0.5 % of the weekly limit (1 % = about $18.00, 1 point)');
  assert.equal(translator('de')('report.total'), 'total');
  assert.equal(uk('no.such.key'), 'no.such.key');
  assert.equal(en('report.turns'), 'user turns: {n}', 'a missing variable stays visible');
});

test('i18n: every catalog has the English keys, the same placeholders and only known plural forms', () => {
  const en = catalog('en');
  const vars = (m) => [...new Set((typeof m === 'string' ? m : Object.values(m).join(' ')).match(/\{\w+\}/g) || [])].sort().join();
  for (const file of fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
    const code = file.slice(0, -5);
    const other = catalog(code);
    assert.deepEqual(Object.keys(en).filter((k) => !(k in other)), [], `${code}: missing keys`);
    assert.deepEqual(Object.keys(other).filter((k) => !(k in en)), [], `${code}: unknown keys`);
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [k, m] of Object.entries(other)) {
      assert.equal(vars(m), vars(en[k]), `${code} ${k}: placeholders`);
      if (typeof m === 'object') for (const f of forms) assert.ok(f in m || 'other' in m, `${code} ${k}: plural form ${f}`);
    }
  }
});
