'use strict';
// How the planning instructions keep a reviewer's findings, hand earlier decisions to the next review and
// tell what to do with a rejected reply.
const test = require('node:test');
const { says, shared, skill, read } = require('./fixtures/texts.js');

const reviews = () => {
  const text = shared('planning.md');
  const from = text.indexOf('## Reviews');
  return text.slice(from, text.indexOf('\n## ', from + 3));
};

test('findings are written as undecided before the user is asked, and a new chat asks about them', () => {
  const r = reviews();
  says(r, ['Before the question', '`reviews/<ticket>.md`', '→ undecided']);
  says(r, ['the decision replaces `undecided`']);
  says(skill('start-planning'), ['`undecided`', 'show them and ask']);
  says(skill('end-planning'), ['`undecided`', 'has a decision']);
});

test('a reviewer gets the exact paths of the review files, never a search', () => {
  const r = reviews();
  says(r, ['the paths of the `reviews/*.md` files', 'list the folder yourself', 'never sent to search']);
  says(r, ['plan-reviewer', 'the paths of the `reviews/*.md` files']);
  says(read('agents', 'ticket-reviewer.md'), ['read the files at the paths']);
  says(read('agents', 'plan-reviewer.md'), ['read the files at the paths']);
});

test('`other` goes only into findings, and a rejected reply is answered by a new reviewer run', () => {
  says(read('agents', 'ticket-reviewer.md'), ['`other`', 'only as the `check` of a finding', 'never in `checks`']);
  says(read('agents', 'plan-reviewer.md'), ['`other`', 'only as the `check` of a finding', 'never in `checks`']);
  says(reviews(), ['`report: failed`', 'a new reviewer run', 'never the same reviewer again']);
});

test('feature-page: features that exist only on another branch are not offered', () => {
  says(skill('feature-page'), ['`other branches:`', 'not offered', 'switches to that branch first']);
});

test('an exported feature: removing a ticket has no command, and a page is offered after the export', () => {
  const planning = shared('planning-exported.md');
  says(planning, ['No command removes a ticket or cancels the feature', '`plans.js drop`', 'after a yes', '`plans.js check <f>`', '`plans.js tickets <f> --fetch` again', 'started on another machine']);
  says(skill('end-planning'), ['`/keel:feature-page <f>`', 'the user types it']);
});
