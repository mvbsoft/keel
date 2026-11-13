'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { russianIn, decide, RUSSIAN_WORD_LIST } = require('../plugins/keel/hooks/language-guard.js');
const { isUkrainian } = require('../plugins/keel/scripts/lib/i18n.js');

test('language-guard: a Russian word without a Russian-only letter is caught', () => {
  assert.deepEqual(russianIn('Рецензент проверил покриття тестів і знайшов дві проблеми.'), ['проверил']);
  for (const sentence of [
    'Він сделал правку у файлі.',
    'Тепер всё працює, бо скрипт использует новий формат.',
    'Це может бути хибний шлях.',
    'Тут нужно зачекати, поки збірка завершиться.',
    'Ми почему-то отримали порожній звіт.',
    'Показано сегодня й вчера.',
    'Це хорошо, но потрібна перевірка.',
    'Ось ошибка у третьому рядку.',
  ]) assert.ok(russianIn(sentence), sentence);
});

test('language-guard: Ukrainian words that look like Russian ones pass', () => {
  const ukrainian = 'Вона може також зробити це після обіду, потім значить приклад: вони перевірили, зробили, отримали, працює, змінили, '
    + 'додали, виправили, видалили, знайшли, хоче, можу, повинен, буде, є, стоїть, здається, знаходиться, залишається, запустив, '
    + 'теж, тут, сьогодні, тепер, спочатку, потім, чому, навіщо, скільки, кілька, багато, більше, менше, краще, добре, звичайно, '
    + 'разом, замість, між, або, хоча, поки, навіть, саме, ось, треба, час, вчора, усього, усіх, воно, їх, мені, себе, такий, який, '
    + 'інший, інші, не можна, помилка, помилки, помилку, питання, відповідь, зразок, із, але.';
  assert.equal(russianIn(ukrainian), null);
});

test('language-guard: every word of the list is caught on its own', () => {
  assert.ok(RUSSIAN_WORD_LIST.length > 100);
  for (const word of RUSSIAN_WORD_LIST) assert.ok((russianIn(`Тут ${word} далі.`) || []).includes(word), word);
});

test('language-guard: a Russian word that is also a correct Ukrainian form passes', () => {
  for (const sentence of [
    'Готово. Після злиття CI запустить тести, і ви побачите результат.',
    'Агент запустить тести ще раз після зміни.',
    'Скрипт добавить рядок у кінець файлу.',
    'У конфіг добавлено новий ключ.',
  ]) assert.equal(russianIn(sentence), null, sentence);
  for (const word of ['запустить', 'добавить', 'добавлено']) assert.ok(!RUSSIAN_WORD_LIST.includes(word), word);
});

test('language-guard: a reply with a Russian word is sent back for a rewrite when the language is written in any common way', () => {
  const input = { hook_event_name: 'Stop', last_assistant_message: 'Рецензент проверил покриття.' };
  for (const language of ['uk', 'UK', 'uk-UA', 'uk_UA', 'ua', 'UA', 'ukr', 'ukrainian', 'Ukrainian', ' ukrainian ', 'українська', 'Українська', ' українська ']) {
    assert.equal(decide(input, language).decision, 'block', language);
    assert.equal(isUkrainian(language), true, language);
  }
  for (const language of ['en', 'de', 'ru', 'uz', '', undefined, null]) assert.equal(decide(input, language), null, String(language));
});
