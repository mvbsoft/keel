'use strict';
// Ukrainian conversations never slip into Russian. Models do slip in long conversations full of English
// tool output (seen after English agent reports in planning), and a request at session start alone
// does not stop it, so two hooks check:
// - Stop: the last reply, outside code, has a Russian letter or word → the turn does not end and the
//   reply is written again without Russian. The rewrite after its own block is not checked again
//   (a marker in .keel/local/tmp), so a reply never loops; one after another hook's block is.
// - PostToolUse on Agent: after an agent's report, one line reminds of the conversation language.
// Runs only in projects keel is set up in. Fails soft: any error lets the turn go on.
const fs = require('node:fs');
const path = require('node:path');
const { isUkrainian } = require('../scripts/lib/i18n.js');

// Letters Ukrainian never uses, and common Russian words whose Ukrainian form differs. A Russian word
// that is also a correct Ukrainian form stays out of the list ("запустить": he will start).
const RUSSIAN_LETTERS = /[ыэёъ]/gi;
const RUSSIAN_WORD_LIST = [
  'и', 'что', 'это', 'если', 'или', 'нужно', 'также', 'которые', 'чтобы', 'потому', 'сейчас', 'только',
  'будет', 'можно', 'ни', 'нет', 'ещё', 'еще', 'как', 'был', 'была', 'было', 'были', 'очень', 'когда',
  'где', 'они', 'его', 'меня', 'тебя', 'после', 'проверил', 'проверила', 'проверили', 'проверить',
  'проверка', 'проверки', 'проверено', 'сделал', 'сделала', 'сделали', 'сделать', 'сделано', 'получил',
  'получила', 'получили', 'получить', 'получается', 'работает', 'работают', 'работать', 'делает',
  'делают', 'делать', 'использует', 'используется', 'использовать', 'изменил', 'изменить', 'изменение',
  'изменения', 'добавил','исправил', 'исправить', 'исправлено', 'удалить', 'удалил',
  'нашел', 'нашла', 'нашли', 'хочет', 'могу', 'может', 'могут', 'должен', 'должна', 'должно', 'нужен',
  'нужна', 'будут', 'есть', 'стоит', 'значит', 'кажется', 'находится', 'остается', 'запустил', 'тоже',
  'здесь', 'сегодня', 'теперь', 'сначала', 'потом', 'затем', 'почему', 'зачем', 'сколько', 'несколько',
  'много', 'больше', 'меньше', 'лучше', 'хорошо', 'конечно', 'вместе', 'вместо', 'между', 'либо', 'хотя',
  'пока', 'даже', 'именно', 'вот', 'надо', 'время', 'вчера', 'всего', 'всех', 'она', 'оно', 'их', 'мне',
  'себя', 'такой', 'какой', 'какая', 'какие', 'другой', 'другие', 'нельзя', 'ошибка', 'ошибки', 'ошибку',
  'вопрос', 'ответ', 'пример', 'из', 'но',
];
// No \b: in JavaScript it knows only ASCII letters, so the lookarounds mark a Cyrillic word's edges
// (an apostrophe belongs to the word, and so does a hyphen before it: Ukrainian writes "eval-и",
// "PR-и"; Russian "что-то" still counts).
const RUSSIAN_WORDS = new RegExp(`(?<![а-яіїєґʼ'-])(${RUSSIAN_WORD_LIST.join('|')})(?![а-яіїєґʼ'])`, 'gi');

// What is left of a reply for the check: fenced and inline code go (logs, data). A fence closes with
// the same run of ``` or ~~~ it opened with (a longer one holds a shorter one); an inline span with
// the same number of backticks. Quotes stay: a Russian quote is still Russian for the person reading it.
function prose(text) {
  return String(text)
    .replace(/^[ \t]*(`{3,}(?=[^`\n]*$)|~{3,})[^\n]*\n[\s\S]*?(^[ \t]*\1[`~]*[ \t]*$|(?![\s\S]))/gm, ' ')
    .replace(/(?<!`)(`+)[^`\n][^\n]*?(?<!`)\1(?!`)/g, ' ');
}

function russianIn(text) {
  const t = prose(text);
  const found = [...(t.match(RUSSIAN_LETTERS) || []), ...(t.match(RUSSIAN_WORDS) || [])];
  return found.length ? [...new Set(found.map((s) => s.toLowerCase()))].slice(0, 5) : null;
}

// ownBlock: this hook blocked the stop the current reply continues from.
function decide(input, language, { ownBlock = false } = {}) {
  if (!input || !isUkrainian(language)) return null;
  if (input.hook_event_name === 'PostToolUse') {
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: "keel: the report above may be in English; reply in the conversation's language (Ukrainian unless the user asked for another one), never Russian (not one word)." } };
  }
  if (input.hook_event_name !== 'Stop' || (input.stop_hook_active === true && ownBlock)) return null;
  const found = typeof input.last_assistant_message === 'string' && russianIn(input.last_assistant_message);
  if (!found) return null;
  return {
    decision: 'block',
    reason: `keel: your last reply has Russian in it (${found.join(', ')}), but this conversation is in Ukrainian. `
      + 'Rewrite the whole reply without Russian: in Ukrainian, or in the language the user asked for if it is not Russian. '
      + 'Not one Russian word, also not in a quote and not when the user asked for Russian; only code blocks and paths stay as they are.',
  };
}

if (require.main === module) {
  let out = null;
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const project = require('../scripts/lib/project-dir.js').hookProject(input);
    if (project && require('../scripts/lib/active.js').configured(project)) {
      const language = require('../scripts/lib/options.js').effectiveOptions(project).conversation_language;
      const sid = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.session_id) ? input.session_id : 'unknown';
      const marker = path.join(project, '.keel', 'local', 'tmp', `language-guard-${sid}`);
      const isStop = input.hook_event_name === 'Stop';
      const ownBlock = isStop && fs.existsSync(marker);
      out = decide(input, language, { ownBlock });
      if (isStop) {
        if (out) {
          fs.mkdirSync(path.dirname(marker), { recursive: true });
          fs.writeFileSync(marker, '');
        } else if (ownBlock) fs.rmSync(marker, { force: true });
      }
    }
  } catch { out = null; }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

module.exports = { russianIn, decide, RUSSIAN_WORD_LIST };
