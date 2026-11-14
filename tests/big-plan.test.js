'use strict';
// A big plan runs in a fresh conversation first: the plan names the choice, the fresh conversation asks
// once how (delegate or here), a resume asks nothing more; a very big plan is planned as a feature.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, shared, order, part, says } = require('./fixtures/texts.js');

const intake = shared('intake.md');
const handoff = shared('handoff-resume.md');
const REMAINING = 'node "<keel>/scripts/plan-steps.js" "<project>"';

test('start-task plan: a very big plan goes to planning; a big one names the choice, a fresh conversation first', () => {
  const plan = part(intake, 'Then, still in Plan Mode, run', '**Branch** (one per task)');
  says(plan, ['Its `very big:` line', '"Task to planning" below', 'before ExitPlanMode', '"do not split" there → go on with this plan']);
  says(plan, ['Execution step 3 names the choice', 'states its `ask:` line']);
  order(plan, '`fresh` (recommended', '`delegate` (implementers', 'the fresh conversation is offered first');
  order(plan, '`delegate` (implementers', '`here`');
  says(plan, ['or what the user says instead', 'approving or changing the plan answers it']);
  says(plan, ['approve with Claude Code\'s "Yes, clear context"', '(when it is shown)', 'or approve as usual', 'then type `/clear`']);
  // After "Yes, clear context" the plan is all that is left: it carries what the discussion settled.
  says(plan, ['its Execution step 4 holds what the discussion settled', "that the plan's sections do not say", '(decisions with why, open questions, a "do not split")']);
  says(intake, ["User's changes", "with the plan's Execution step 4", 'its settled decisions into Decisions and why', 'its open questions into Open questions']);
  says(plan, ['No separate question after ExitPlanMode.']);
});

test('start-task: a fresh conversation keeps the decisions in task.md, the user types the commands, it asks once how', () => {
  says(intake, ['`execution: fresh` → "Fresh conversation" below.']);
  const fresh = part(intake, '**Fresh conversation** (`execution: fresh`)', '## Resume');
  says(fresh, ['began with the plan alone', 'approved with Claude Code\'s "Yes, clear context"', 'nothing before the plan', 'it is the fresh one', 'ask how to run the rest as task-resume.md step 7 says']);
  // The plan discussion is lost after /clear, so what it settled is in the task file first.
  order(fresh, 'check that task.md holds what it settled', 'Type `/clear`', 'decisions are written before the handover');
  says(fresh, ['add what is still missing', 'Decisions and why, with why, and Open questions']);
  says(fresh, ['Type `/clear`, then `/keel:start-task <id>`', 'the work goes on from the plan', 'keel never types it for the user']);
});

test('start-task resume: execution fresh asks delegate or here once; a made choice is not asked again', () => {
  const resume = shared('task-resume.md');
  // The count of the one-line statement comes from the script too, so it runs for every choice.
  order(resume, `${REMAINING} "<plan.md or task.md>" --remaining\``, '`execution: fresh` → this is the fresh conversation');
  says(resume, ['ask its `ask:` line', '(delegate or here; no `ask:` → here)', 'write the answer into `execution:`']);
  says(resume, ['`here` or `delegate` → the choice is made', 'no question', 'say in one line how it goes on, with its count']);
});

test('start-session: a new plan offers the fresh conversation, the note keeps the decisions; a resume asks once', () => {
  const size = part(handoff, '**The plan and its size.**', 'At the end the user runs');
  says(size, ['`execution:` keeps the choice', '(`here`, `delegate`, or `fresh`']);
  says(size, ['**A plan written in this conversation** (a new line)', 'run `node "<keel>/scripts/plan-steps.js" "<project>" "<file with the steps>"`', '`suggest: delegate`']);
  says(size, ['`very big:` is for tasks only', 'a line of work spans sessions']);
  says(size, ["For `fresh` the plan's Execution step 4", 'as intake.md step 6 says', 'the note takes it into Decisions and why and Open questions']);
  order(size, 'check that the note holds what it settled', 'Type `/clear`, then `/keel:start-session`', 'decisions are in the note before the handover');
  says(size, ['keel never types it for the user']);
  const resume = part(size, '**A note read at the start**');
  assert.ok(resume.includes(`${REMAINING} "<file with the steps>" --remaining\``));
  says(resume, ['write the answer into the note\'s `execution:`']);
  says(resume, ['`here` or `delegate` → no question', 'one line with its count']);
});

test('templates: execution has the value fresh; the plan says the choice and where a fresh conversation goes on', () => {
  assert.match(read('templates', 'keel', 'task.md'), /^execution: <here \| delegate \| fresh>$/m);
  assert.match(read('templates', 'keel', 'next-session.md'), /^execution: <here \| delegate \| fresh>$/m);
  const exec = part(read('templates', 'keel', 'plan.md'), '## Execution');
  says(exec, ['the choice in words', 'the `ask:` line of `plan-steps.js`', 'so that approving the plan answers it']);
  says(exec, ['intake.md` "Fresh conversation"', '`<keel>/skills/_shared/handoff.md` "The plan and its size"']);
  says(exec, ['With fresh, say how the user gets there', '<task> approve with "Yes, clear context", or approve as usual', 'then type `/clear` and `/keel:start-task <id>`', '<session> type `/clear`, then `/keel:start-session`']);
  says(exec, ['With Execution fresh also what the discussion settled', 'that the sections above do not say', 'decisions with why, open questions, a "do not split"']);
});
