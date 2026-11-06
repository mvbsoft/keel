'use strict';
// A big plan runs in a fresh conversation first: the plan names the choice, the fresh conversation asks
// once how (delegate or here), a resume asks nothing more; a very big plan is planned as a feature.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, shared, order, part } = require('./fixtures/texts.js');

const intake = shared('intake.md');
const handoff = shared('handoff.md');
const REMAINING = 'node "<keel>/scripts/plan-steps.js" "<project>"';

test('start-task plan: a very big plan goes to planning; a big one names the choice, a fresh conversation first', () => {
  const plan = part(intake, 'Then, still in Plan Mode, run', '**Branch** (one per task)');
  assert.match(plan, /Its `very big:`\s+line → "Task to planning" below, before ExitPlanMode; "do not split" there → go on with this plan\./);
  assert.match(plan, /Execution step 3 names the choice and states its `ask:` line/);
  order(plan, '`fresh` (recommended', '`delegate` (implementers', 'the fresh conversation is offered first');
  order(plan, '`delegate` (implementers', '`here`');
  assert.match(plan, /or what the user says instead; approving\s+or changing the plan answers it\./);
  assert.match(plan, /approve with Claude\s+Code's "Yes, clear context" \(when it is shown\), or approve as usual, then type `\/clear`/);
  // After "Yes, clear context" the plan is all that is left: it carries what the discussion settled.
  assert.match(plan, /its Execution step 4 holds what the discussion settled that the plan's\s+sections do not say \(decisions with why, open questions, a "do not split"\)/);
  assert.match(intake, /User's changes \(with the plan's Execution step 4: its settled\s+decisions into Decisions and why, its open questions into Open questions\)/);
  assert.match(plan, /No separate question after ExitPlanMode\./);
});

test('start-task: a fresh conversation keeps the decisions in task.md, the user types the commands, it asks once how', () => {
  assert.match(intake, /`execution: fresh` → "Fresh conversation" below\./);
  const fresh = part(intake, '**Fresh conversation** (`execution: fresh`)', '## Resume');
  assert.match(fresh, /began with the plan alone \(approved\s+with Claude Code's "Yes, clear context": nothing before the plan\) → it is the fresh one: ask how to\s+run the rest as Resume step 7 says/);
  // The plan discussion is lost after /clear, so what it settled is in the task file first.
  order(fresh, 'check that task.md holds what it settled', 'Type `/clear`', 'decisions are written before the handover');
  assert.match(fresh, /add what is still missing to Decisions and why, with why, and Open questions/);
  assert.match(fresh, /Type `\/clear`, then `\/keel:start-task <id>`: the work goes on from the plan\." and\s+stop; keel never types it for the user\./);
});

test('start-task resume: execution fresh asks delegate or here once; a made choice is not asked again', () => {
  const resume = part(intake, '## Resume', '## Before any branch change');
  // The count of the one-line statement comes from the script too, so it runs for every choice.
  order(resume, `${REMAINING} "<plan.md or task.md>" --remaining\``, '`execution: fresh` → this is the fresh conversation');
  assert.match(resume, /ask its `ask:` line \(delegate or here; no\s+`ask:` → here\) and write the answer into `execution:`\./);
  assert.match(resume, /`here` or `delegate` → the choice is made:\s+no question; say in one line how it goes on, with its count/);
});

test('start-session: a new plan offers the fresh conversation, the note keeps the decisions; a resume asks once', () => {
  const size = part(handoff, '**The plan and its size.**', 'At the end the user runs');
  assert.match(size, /`execution:` keeps the choice\s+\(`here`, `delegate`, or `fresh`/);
  assert.match(size, /\*\*A plan written in this conversation\*\* \(a new line\): run\s+`node "<keel>\/scripts\/plan-steps\.js" "<project>" "<file with the steps>"`\. `suggest: delegate`/);
  assert.match(size, /`very big:` is for tasks only: a line of work spans sessions\./);
  assert.match(size, /For `fresh` the plan's Execution\s+step 4 holds what the discussion settled, as intake\.md step 6 says; the note takes it into\s+Decisions and why and Open questions\./);
  order(size, 'check that the note holds what it settled', 'Type `/clear`, then `/keel:start-session`', 'decisions are in the note before the handover');
  assert.match(size, /keel never types it for the user/);
  const resume = part(size, '**A note read at the start**');
  assert.ok(resume.includes(`${REMAINING} "<file with the steps>" --remaining\``));
  assert.match(resume, /write the answer into the note's `execution:`/);
  assert.match(resume, /`here`\s+or `delegate` → no question, one line with its count/);
});

test('templates: execution has the value fresh; the plan says the choice and where a fresh conversation goes on', () => {
  assert.match(read('templates', 'keel', 'task.md'), /^execution: <here \| delegate \| fresh>$/m);
  assert.match(read('templates', 'keel', 'next-session.md'), /^execution: <here \| delegate \| fresh>$/m);
  const exec = part(read('templates', 'keel', 'plan.md'), '## Execution');
  assert.match(exec, /the choice in words and the `ask:`\s+line of `plan-steps\.js`, so that approving the plan answers it/);
  assert.match(exec, /intake\.md` "Fresh conversation" \/ <session>\s+`<keel>\/skills\/_shared\/handoff\.md` "The plan and its size"/);
  assert.match(exec, /With fresh, say how the user gets\s+there: <task> approve with "Yes, clear context", or approve as usual, then type `\/clear` and\s+`\/keel:start-task <id>` \/ <session> type `\/clear`, then `\/keel:start-session`/);
  assert.match(exec, /With\s+Execution fresh also what the discussion settled that the sections above do not say: decisions\s+with why, open questions, a "do not split"/);
});
