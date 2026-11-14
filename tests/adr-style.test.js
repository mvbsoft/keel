'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { read, shared, skill, part, says } = require('./fixtures/texts.js');

const journal = shared('adr-journal.md');
const living = shared('adr-living.md');

test('ADR skill: follows only the chosen style, journal without the key, the project rule for custom', () => {
  const s = skill('adr-required');
  const style = part(s, "## The project's ADR style decides", '## Format');
  says(style, ['`docs.adr_style`', 'only that style']);
  says(style, ['`journal`', 'no key', 'adr-journal.md']);
  says(style, ['`living`', 'adr-living.md']);
  says(style, ['`custom`', "ADR folder's README", 'ask']);
  says(s.split('\n').find((l) => l.startsWith('description:')), ['writing or changing a decision record'], 'the skill loads before an ADR is written, not only for a new dependency');
  const format = part(s, '## Format');
  says(format, ['**Alternatives considered:**', "required in both of keel's styles"]);
  assert.ok(!s.includes('Superseded by NNNN'), 'the status list comes from the style file');
  assert.ok(!s.includes('A superseded ADR stays'), 'the journal rule lives in adr-journal.md');
});

test('ADR journal: the five rules and what reviewers check', () => {
  says(journal, ['`docs.adr_style: journal`', 'not set']);
  says(journal, ['Proposed / Accepted / Superseded by NNNN']);
  says(journal, ['never edited except its status line']);
  says(journal, ['replaces the old one wholly', 'restates everything']);
  says(journal, ['only "Superseded by NNNN"', 'Partial superseding', 'not allowed']);
  says(journal, ['links', 'move to the new record in the same change']);
  says(journal, ['Never act on a superseded record']);
  says(journal, ['"Alternatives considered" is required']);
  const check = part(journal, '## Reviewers check');
  says(check, ['edited beyond its status line']);
  says(check, ['partial supersede']);
  says(check, ['link', 'superseded record']);
  says(check, ['new record without an "Alternatives considered" section']);
});

test('ADR living: one record per topic, rewritten in place, deleted only on yes, numbers permanent', () => {
  says(living, ['`docs.adr_style: living`']);
  says(living, ['Proposed / Accepted', 'no "Superseded"']);
  says(living, ['search the ADR folder', 'same topic', 'rewrite it']);
  says(living, ['only the current decision', 'no correction notes', 'no "void" parts', 'no "see newer"', 'no ticket ids or dates of changes']);
  says(living, ['rewritten in place', '"Alternatives considered"', 'reason it was dropped']);
  says(living, ["deleted after the user's yes", 'still-valid reasons', 'every link and mention', 'same change']);
  says(living, ['permanent name', 'never reused']);
  says(living, ['"Alternatives considered" is required']);
  const check = part(living, '## Reviewers check');
  says(check, ['"correction"', '"amended"', '"superseded"', '"void"', '"was:"']);
  says(check, ['new record that amends an existing record']);
  says(check, ['deleted record still linked']);
  says(check, ['without its old option in "Alternatives considered"']);
});

test('ADR styles: each file opens with a short version and its cost for the configure question', () => {
  for (const [name, text, who] of [['journal', journal, 'teams of people'], ['living', living, 'one owner']]) {
    const short = part(text, '## In short', '## Status');
    says(short, [who], name);
    says(short, ['Cost:'], name);
  }
});

test('configure: asks the ADR style whenever there are or will be ADRs, says what is there now', () => {
  const flow = shared('configure-flow.md');
  const q = part(flow, '**ADR style** (`docs.adr_style`)', '3. **Pattern**');
  says(q, ['profile is 2 or higher', 'ADR folder']);
  says(q, ['First say what the project has now', '`findings.docs.adr_records`', 'no ADRs yet']);
  says(q, ['**journal**', '**living**', '**my own way**']);
  says(q, ['this is how you keep them now']);
  says(q, ['**keep them as they are**', 'follow neither style', 'describe the current way']);
  says(q, ['history marks', '**living** option also says', 'one-time clean-up', 'before the choice']);
  says(q, ['Recommend `living`', 'one human owner', 'mostly worked on by agents', '`journal` otherwise', 'the recommended option says why']);
  says(q, ['name the records', 'opens the question itself', 'all questions go in one message']);
  says(q, ['describe the current way in a few lines, in the option itself']);
  says(q, ['`custom`', "ADR folder's README", 'How we keep these records']);
  says(q, ['`comments.adr_refs`', '`living`', 'propose `forbidden`']);
  says(q, ['one-time clean-up', "user's yes", 'renumber once', 'never again', 'old commit or note keeps the old numbers']);
  says(q, ['/.keel/local/adr-cleanup.md`', 'first task']);
  const quick = part(flow, '| 8 Documentation |', '\n');
  says(quick, ['ADR style', 'one question']);
  says(part(flow, '## 12. Write and summary'), ['/keel:start-task .keel/local/adr-cleanup.md']);
});

test('migration: an old system\'s ADRs that go on get the same style question', () => {
  const m = part(shared('migrate.md'), '## 11. Advice for what stays', '## 12.');
  says(m, ['ADR', '`docs.adr_style`', 'not set', 'same question', 'configure section 8']);
});

test('docs reviewer: checks a change against the chosen ADR style', () => {
  const p = read('protocols', 'docs.md');
  says(p, ['ADR style', '`docs.adr_style`', 'adr-journal.md', 'adr-living.md', '"Reviewers check"']);
  says(p, ['`custom`', "ADR folder's README"]);
});

test('settings docs: the ADR style key and both styles in plain words', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'docs', 'settings.md'), 'utf8');
  says(s, ['`docs.adr_style`', '`journal` / `living` / `custom`', '`journal`']);
  says(s, ['**journal**', 'new record', 'Superseded by']);
  says(s, ['**living**', 'one record per topic', 'rewritten in place', 'Alternatives considered']);
  says(s, ['**custom**', 'README']);
});
