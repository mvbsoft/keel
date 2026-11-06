'use strict';
// A task that turns out too big becomes planning: start-task's "Task to planning", the brief it writes,
// start-planning taking the brief, and planning going on in a dropped task's branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, shared, order, part } = require('./fixtures/texts.js');
const intake = shared('intake.md');
const section = part(intake, '## Task to planning');
const BRIEF = '.keel/local/plans/briefs/<name>-brief.md';

test('start-task: a task too big asks one question (new chat, here, do not split, or else); asked to split, it does not ask whether', () => {
  assert.match(intake, /Too big for one task \(the user says so or asks to split it, in any words, or `plan-steps\.js` says\s+`very big:` for the Plan Mode plan: 10 steps or 40 files\) → "Task to planning" below, at any step\./);
  // A "do not split" recorded stops keel's offer, not the user's own request.
  assert.match(intake, /When the task's Decisions and why records that the\s+user chose not to split it, keel does not offer it again; the user asking to split it still goes there\./);
  assert.match(section, /Lanes never mix:\s+the task ends completely before planning starts/);
  assert.match(section, /keel cannot type a command for the user: it names\s+the command, the user types it/);
  assert.match(section, /The user asking to split it or to plan it as a feature, in any words,\s+is the yes: do not ask whether, and leave "do not split" out; a place they name \("in a new chat"\)\s+answers the question as well\./);
  const ask = part(section, 'Ask, with the size', '- **New chat**');
  order(ask, '1) A new chat (recommended when this one is long)', '2) Plan here: you type', 'the order of the answers');
  order(ask, '2) Plan here: you type', '3) Do not split: one task. Or say how else.', 'the order of the answers');
  assert.match(ask, /`\/keel:start-planning` in this chat/, 'plan here names the command the user types');
  assert.match(section, /After the user\s+asked to split it, the same question has only 1\), 2\) and "Or say how else\.": no "do not split"\./, 'spelled out at the question too');
});

test('start-task: "do not split" is recorded in task.md and holds for this task only', () => {
  const no = part(section, '- **Do not split**', '- **The task leaves**');
  assert.match(no, /Record it in task\.md, Decisions and why \("Not split into a\s+feature: the user's choice"; before `task new`, when step 7 item 2 writes the file; in Plan Mode\s+also in the plan's Execution step 4, which item 2 copies, so it survives "Yes, clear context"\)/);
  assert.match(no, /neither\s+this conversation nor a resume of the task offers it again/, 'a compacted context or a resume does not ask again');
  assert.match(no, /Only for this task: the\s+next one is asked anew\./);
});

test('start-task: a new chat gets a brief in four handoff sections and the exact command; here plans with no brief', () => {
  order(section, '- **New chat** → write the brief (below), then the task leaves (below)', `Open a new chat in this\n  project and type: \`/keel:start-planning ${BRIEF}\``, 'the brief is written before the command');
  assert.match(section, /Planning starts\s+from the open questions and does not ask again what is settled\./);
  assert.match(section, /- \*\*Here\*\* → the task leaves \(below\), then ask the user to type `\/keel:start-planning`; the plan in\s+this chat is its source\. No brief\./);
  const brief = part(section, '**The brief**');
  assert.ok(brief.startsWith(`**The brief** \`${BRIEF}\` (Write; on this machine only), \`<name>\` the\nfeature name start-planning would propose`), 'one name for the brief and the feature');
  // The name follows start-planning's own rule for feature names (lib/plans-drafts.js FEATURE).
  assert.match(brief, /2-4 English words joined by `-`, `\[a-z0-9-\]`, at most 40\s+characters, starting with a letter, no digit right after a hyphen/);
  assert.match(read('skills', 'start-planning', 'SKILL.md'), /propose 2-4 English words joined by `-`, `\[a-z0-9-\]`, at most 40 characters, starting with\s+a letter, no digit right after a hyphen/);
  assert.match(brief, /In the plan's language \(`planning\.language` of `\.keel\/config\.json`, else\s+`repo_language`\): its text moves into the plan as it is/);
  assert.match(brief, /Four sections of handoff\.md "The handoff\s+format"/);
  assert.match(shared('handoff.md'), /## The handoff format \(the note and a task's task\.md\)/, 'the format the brief names exists');
  for (const s of ['## Goal', '## Files', '## Decisions and why', '## Open questions']) assert.ok(brief.includes(`- \`${s}\``), s);
  order(brief, '- `## Goal`', '- `## Open questions`', 'the handoff order');
});

test('start-task: the task leaves only while no code changed: dropped, its own branch deleted only on its own yes', () => {
  assert.match(section, /\*\*No code changed yet\*\*: no `task new` yet \(step 7 item 2\), or after it `git diff --name-only <started>`\s+\(the task file's `started:`\) and `git ls-files --others --exclude-standard` list nothing outside\s+`\.keel\/`\./);
  const leaves = part(section, '- **The task leaves**', '**Code changed**');
  assert.match(leaves, /After it: say "<id> goes to keel's trash"\s+and run `node "<keel>\/scripts\/notes\.js" "<project>" task drop <id>`/, 'the drop is said, not left implied');
  order(leaves, 'task drop <id>', 'switch --name <base>', 'the task ends first');
  order(leaves, 'switch --name <base>', 'delete-branch --name <branch>', 'git-flow.js refuses to delete the current branch');
  assert.match(leaves, /A branch of\s+its own \(`branch` differs from `base`\) is deleted only on its own yes/, 'a ticket\'s shared feature branch is never deleted here');
});

test('start-task: with code changed keel advises by its state and asks; it never hands the task off for planning', () => {
  const changed = part(section, '**Code changed**', '**The brief**');
  assert.doesNotMatch(section, /hand off first/, 'no two lines of work about one thing');
  assert.match(changed, /say what is done and whether it works on its own, advise by that, and ask one\s+question, which way; the user decides\. Name the commands the user will type in each way\./);
  assert.match(changed, /What the\s+rest still needs to know goes into the brief as an open question, not into a question now\./, 'one question only');
  // Works on its own: the brief comes while this chat lives, end-task ends the lane, then planning.
  const works = part(changed, '- It works on its own', '- Anything else');
  // Its own tests passing tells a finished piece from a half, also when nothing uses it yet.
  assert.match(works, /the work done is a finished piece with tests of its own, and they pass \(run\s+them\)/);
  assert.match(works, /even when nothing uses it\s+yet/);
  assert.match(works, /advise to finish it as a task and plan the rest/);
  assert.match(works, /The brief of the rest is written now,\s+in this chat, before `\/keel:end-task` \(which ends the lane\)/);
  order(works, 'Then the user types `/keel:end-task`', 'then `/keel:start-planning\n  .keel/local/plans/briefs/<name>-brief.md`', 'the task ends before planning starts');
  // Half of something: both ways, their difference said, the user picks.
  const half = part(changed, '- Anything else');
  assert.match(half, /^- Anything else \(no tests of its own yet, or a part it needs is missing\) is half of something →/);
  assert.match(half, /offer both ways and say how they differ/);
  order(half, '(a) **the work goes on in a branch of its own, the feature\'s branch**', '(b) **finish first**');
  const a = part(half, '(a)', '(b)');
  // A half never lands in a shared branch: a task working on one gets a new branch from it.
  assert.match(a, /the task's `branch` when it\s+differs from `base`/);
  assert.match(a, /A task working directly on a shared branch \(`branch` is `base`: the main\s+branch, or a planned ticket's feature branch\) gets a new one from `<base>`, `<KEY>-<short-name>` for\s+a planned ticket, else `<name>`, so a half never lands in a shared branch\./);
  assert.match(a, /The brief says "already\s+done on branch <branch>: \.\.\." and that the feature goes on in `<branch>` and merges into the task's\s+`merge_into` \(a new branch: into `<base>`\)/);
  order(a, 'The brief says', 'Commit the work on <branch> as work in\n  progress and push it, so another machine sees it?', 'the brief first, while the chat still has it all');
  order(a, 'run `task drop <id>`', 'start --name <branch> --from\n  <base>', 'the drop comes before git, so its removal is in the commit');
  order(a, 'start --name <branch> --from\n  <base>` (it carries the changes)', 'commit as `<keel>/skills/_shared/git.md` step 2 does', 'the new branch takes the changes before the commit');
  order(a, 'commit as `<keel>/skills/_shared/git.md` step 2 does', 'then `push`', 'pushed, so another machine sees the work');
  assert.match(a, /"<id> goes to keel's trash\s+\(its code and branch stay\)"/);
  assert.match(a, /\(as above, never the branch\)/, 'the branch is the feature\'s now');
  assert.match(a, /On a no\s+nothing happens in git: the changes stay uncommitted where they are, and a new branch is made when\s+the work goes on; say so\./);
  assert.match(a, /its first ticket goes on in\s+`<branch>`/);
  assert.match(half, /\(b\) \*\*finish first\*\*: bring the half to a working state in\s+this task \(tests pass, a finished piece\), finish it with `\/keel:end-task`, and plan the rest with a\s+brief as above \(`\/keel:start-planning \.keel\/local\/plans\/briefs\/<name>-brief\.md`\)/);
  assert.match(section, /the branch case \(a\): "- The feature goes on\s+in branch <branch> and merges into <merge_into> - already done there: \.\.\."/);
});

test('start-planning: a brief starts from its open questions; its sections go into plan.md and the brief to the trash', () => {
  const skill = read('skills', 'start-planning', 'SKILL.md');
  assert.match(skill, /a brief\s+`\.keel\/local\/plans\/briefs\/<name>-brief\.md`, written by \/keel:start-task for a task too big for\s+one: step 5 "From a brief"/);
  const from = part(skill, '- **From a brief**', '6. **Continue a draft.**');
  assert.match(from, /what it settles is not asked again/);
  assert.match(from, /the name\s+proposed is `<name>`/);
  // The branch sentence intake.md writes into the brief is the one start-planning reads.
  assert.match(from, /a branch its Decisions and why names \("goes on in branch <b> and merges\s+into <m>"\) replaces the main-branch question: after `plans\.js new`, `plans\.js set <f> --branch <b>\s+--merge-into <m>`/);
  order(from, '`plans.js set <f> --branch <b>', '`plans.js brief <f> <the brief>`', 'the branch is set on the new draft first');
  assert.match(from, /Goal →\s+In plain words, Files → What was gathered, Decisions and why → Decisions, Open questions → Open\s+questions\) and the brief to keel's trash/);
  assert.match(skill, /from a brief: first grow In plain words from its Goal into\s+the whole feature, write it, and show its text in the reply, then its first open question/);
  assert.match(shared('planning.md'), /- \*\*A draft continued\*\*, or one made from a brief, reads What was gathered first and never searches\s+for it again \(no gathering offer\)/);
  // planning.md's "never from another task's branch" keeps one exception: the brief's own branch.
  const hints = part(shared('planning.md'), '## Branch hints', '## Commit and push');
  order(hints, 'never from another task\'s branch', 'One exception: a feature whose brief says it goes on in a dropped task\'s branch');
  assert.match(hints, /has that branch as the plan's `branch:` and needs no new one/);
  // cleanup is refused in a planning conversation (lib/lanes.js), so plans.js brief moves the brief.
  assert.match(read('scripts', 'lib', 'lanes.js'), /PLANNING_REFUSES = new Set\(\[[^\]]*'cleanup'/);
  assert.match(read('scripts', 'plans.js'), /^\/\/   brief <feature> <file> {16}a brief of \/keel:start-task/m);
});
