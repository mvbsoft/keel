'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const catalog = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'locales', 'uk.json'), 'utf8'));
const page = require(path.join(PLUGIN, 'templates', 'usage', 'i18n.uk.js'));
const all = [...Object.entries(catalog), ...Object.entries(page)].map(([k, v]) => [k, typeof v === 'string' ? v : Object.values(v).join(' ')]);
const word = (w) => new RegExp(`(?<![а-яіїєґʼ'’])(${w})(?![а-яіїєґʼ'’])`, 'i');
const offenders = (re) => all.filter(([, v]) => re.test(v)).map(([k]) => k);

test('uk texts: the user is addressed as "ви" everywhere, never "ти"', () => {
  assert.deepEqual(offenders(word('заверши|почни|запусти|зроби|відкрий|скористайся|переконайся')), []);
  assert.match(catalog['lane.planning'], /Завершіть .* почніть/);
  assert.match(catalog['lane.unattended'], /Запустіть/);
});

test('uk texts: no "по" calques; the page says "за днями", "за проєктами"', () => {
  assert.deepEqual(offenders(word('по')), []);
  assert.equal(page['group.by'], 'Групувати за');
  assert.equal(page['group.project'], 'проєктами');
});

test('uk texts: one word per term (hours "год", a calibration reading "замір", gates "Перевірки")', () => {
  assert.deepEqual(offenders(word('г')), []);
  assert.equal(page['common.hours_short'], catalog['report.hours']);
  assert.deepEqual(offenders(word('точк[а-яіїє]*|точок')).filter((k) => k !== 'sp.entrypoint'), []);
  assert.equal(page['keel.gates'], 'Перевірки');
});
