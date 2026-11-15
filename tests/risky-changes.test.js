'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, shared, skill, part, says } = require('./fixtures/texts.js');

const text = shared('risky-changes.md');

test('risky changes: asked only for schema changes on tables with data, lost data and APIs others can call', () => {
  const when = part(text, '## When to ask', '## How to ask');
  says(when, ['rename, drop or retype a column or table', 'new `NOT NULL`', 'mass `UPDATE`']);
  says(when, ['loses data', 'backup question']);
  says(when, ['can be called from outside', 'other than by logging into this same app', 'mobile or desktop app', 'outgoing webhook', 'Unsure who can call it → ask']);
  says(when, ['Do not ask for a new table or index, a new nullable column or one with a default']);
});

test('risky changes: a project rule settles it, a pick is never saved unless the person says so', () => {
  const when = part(text, '## When to ask', '## How to ask');
  says(when, ["project's rules", 'no question', 'name it in one line']);
  says(when, ['ask every time', 'never offer to save it']);
  says(when, ['make it a rule', "write it into the project's rules"]);
});

test('risky changes: variants from the most reliable to the simplest, built as picked', () => {
  const how = part(text, '## How to ask', '## Fool-proof check');
  says(how, ['Recommend one', 'the person picks', 'write migrations, code, commands and deploy steps for the pick']);
  says(how, ['**Three releases**', 'expand → migrate → contract']);
  says(how, ['**Two releases:**']);
  says(how, ['**One release with maintenance mode:**', 'only when the project has a maintenance mode', 'only as extra work']);
  says(how, ['**One release, just apply the migration:**']);
  says(how, ['does not bring the data back']);
  says(how, ['archive table', 'personal data stays in it']);
  says(how, ['one-off export', 'restore command']);
  says(how, ['say exactly what is lost']);
  for (const variant of ['Do not make the change', '`/v2`', 'both fields', '`Deprecation` and `Sunset`', 'tell the clients']) says(how, [variant]);
});

test('risky changes: 17 fool-proof cases get a second question, never a third, and the pick is written down', () => {
  const check = part(text, '## Fool-proof check');
  const items = check.match(/^\d+\. /gm);
  assert.equal(items.length, 17, 'the 17 cases');
  says(check, ['ask a second time, even against a rule']);
  says(check, ['what can break and in which cases', 'what to check before the deploy']);
  says(check, ['"Do as I said, I accept all the risks"', 'never ask a third time']);
  says(check, ['"unknown"', 'only warn in one line']);
  says(check, ['the ticket', 'the commit body', 'the PR description', 'one comment at the risky spot', 'only when it already keeps one']);
});

test('risky changes: each place that meets such a change points to the shared file', () => {
  const file = 'skills/_shared/risky-changes.md';
  says(skill('migration-safety'), [file]);
  says(skill('production-readiness'), ['**Risky changes**', file]);
  says(shared('planning.md'), ['**Risky changes.**', file, 'becomes a Decision']);
  says(read('agents', 'plan-reviewer.md'), [file, 'chosen variant in Decisions']);
  says(read('protocols', 'database.md'), [file, 'follow the variant chosen for it']);
  says(read('protocols', 'api.md'), [file, 'follow the variant chosen for it']);
  says(read('hooks', 'standards.md'), ['A risky change', 'keel:production-readiness', 'the user picks']);
});

test('risky changes: every pick is written where the reviewers look, and they accept it there', () => {
  const text = shared('risky-changes.md');
  says(text, ['**Every pick is written down**', 'a Decision of the plan', "the task's acceptance criteria"]);
  says(read('protocols', 'database.md'), ["the task's acceptance criteria in your prompt"]);
  says(read('protocols', 'api.md'), ["the task's acceptance criteria in your prompt", 'despite the warning']);
});

test('risky changes: the always-loaded trigger names every case of "When to ask"; the implementer stops as Blocked', () => {
  const rule = read('hooks', 'standards.md');
  says(rule, ['A risky change', 'renaming, dropping or retyping', '`NOT NULL`', 'moving data', 'mass `UPDATE` or `DELETE`', 'breaking an API']);
  says(rule, ['implementer cannot ask', 'Blocked']);
  says(skill('migration-safety'), ['"When to ask"']);
});

test('risky changes: no keel text teaches multi-release deploys as the default again', () => {
  const texts = {
    'migration-safety': skill('migration-safety'),
    'production-readiness': skill('production-readiness'),
    'standards.md': read('hooks', 'standards.md'),
    'planning.md': shared('planning.md'),
    'database.md': read('protocols', 'database.md'),
    'api.md': read('protocols', 'api.md'),
  };
  for (const [name, text] of Object.entries(texts)) {
    assert.doesNotMatch(text, /expand\s*(?:→|->|,|\/)\s*migrate/i, `${name} teaches expand/migrate/contract`);
    assert.doesNotMatch(text, /both app versions/i, `${name} requires both app versions`);
  }
});
