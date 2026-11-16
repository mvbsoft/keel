'use strict';
// keel's instructions for planned tickets in the task and session lanes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PLUGIN, read, shared, skill, order, part, says } = require('./fixtures/texts.js');

// --- planned tickets in the task and session lanes ---

const planned = () => part(shared('intake.md'), '## Planned ticket', '## Task to planning');

test('start-task: no instruction adds the next planned ticket; "next ticket" and <feature>/T<n> read the state after a fetch', () => {
  const intake = shared('intake.md');
  says(intake, ['| empty |', 'unfinished tasks', 'then the next planned ticket', '"next planned: <feature>/T<n>"']);
  says(intake, ['the next ticket in any words ("next ticket")', 'a planned ticket `<feature>/T<n>`', '"Planned ticket" below']);
  says(intake, ['For a key, task id, `<feature>/T<n>` or link run', 'lane <key or link>']);
  says(intake, ['`lane: none (task <id> was finished or dropped earlier)`', 'yes for a `<feature>/T<n>`', '"Planned ticket" below first']);
  const p = planned();
  says(p, ['`node "<keel>/scripts/plans.js" "<project>" <command> ...`']);
  says(p, ['No instruction', '`next: <feature>/T<n>` line', '"next planned:']);
  says(p, ['"next ticket" →', '`tickets --fetch`', 'its `next:` line']);
  order(p, '`tickets --fetch`', '`tickets <feature>/T<n> --fetch`', 'the next ticket is found first, then its own view');
  says(p, ['`tickets: none (...)`', 'say so and stop']);
});

test('start-task: each ticket state has its answer; a draft stops, a changed ticket and a taken one ask', () => {
  const p = planned();
  says(p, ['`draft`', 'still being planned', '`/keel:start-planning <feature>`', 'stop']);
  says(p, ['`needs review`', 'show it and ask', 'start anyway / review it first']);
  says(p, ['`in-progress` here', '`remote: in-progress on <branch>`', 'who took it and where', 'continue it / start over / take another ticket']);
  says(p, ['`done` or `abandoned`', 'start it again only on a yes']);
  says(p, ['`in <name>`', 'another repository', '"start it in <name>"', 'stop']);
  says(p, ['a `depends:` ticket not `done`', '`note:` line', 'take the next ticket /', 'start anyway']);
  says(p, ['`next` or `ready`', 'read the ticket (`file:`)', 'Goal, Acceptance criteria and Where to', 'steps 3-6 as for any task']);
});

test('start-task: a ticket of another repository asks once where it runs; a separate session gets the exact command', () => {
  const p = planned();
  says(p, ['`repo: <name>`', 'ask once where it runs', 'here / a subagent in that repository / a separate session there', '`plans.js repos`']);
  says(p, ['Here or a subagent', 'on that folder in place of', '`<project>`', 'its own rules', 'without keel there git', 'is manual', '`package.json` / `composer.json`', 'the user', 'confirms', 'returns it as a question']);
  says(p, ['A separate session', 'print exactly', '`cd <its folder> && claude --add-dir <project> "<prompt>"`', "the ticket file's", 'absolute path', '`node <keel>/scripts/plans.js <its folder> status <feature> T<n> done --project <project>`', 'stop here']);
  assert.match(read('scripts', 'plans.js'), /^\/\/   status <feature> <T<n>> .*\[--project <path>\]/m, 'plans.js status takes --project');
});

test('start-task: a ticket works on its feature branch by default; a ticket branch <b>-T<n> only on request; its status is committed and pushed', () => {
  const intake = shared('intake.md');
  says(intake, ['A planned', 'ticket: the id is `<feature>-T<n>` exactly', 'no slug', 'the title is its title']);
  says(intake, ['planned ticket: `--source file --link <its file path> --ticket <feature>/T<n>`']);
  const p = planned();
  says(p, ['**Branch**', '"Before any branch change" first', '`<b>` (its feature branch) is offered first', '`git-flow.js switch --name <b>`', '`start --name <b> --from <current>`']);
  says(p, ['A ticket branch', '(rare: the user asks for one)', '`<b>-T<n>`', 'always from `<b>`']);
  order(p, 'git-flow.js switch --name <b>', '`plans.js status <feature> T<n> in-progress --branch <the branch it works on>`', 'onto the feature branch first, so the status lands there');
  order(p, 'in-progress --branch <the branch it works on>', '`plans.js commit <feature> --tickets T<n>`', 'the status is committed');
  says(p, ['`plans.js commit <feature> --tickets T<n>`', 'only the ticket file and', '`plan.md`']);
  order(p, '`plans.js commit <feature> --tickets T<n>`', '`plans.js push <feature>`', 'then pushed, so others see it');
  says(p, ['autonomous git runs them', 'manual git offers them', 'so others see the ticket is', 'taken']);
  says(p, ['A feature on this machine: only that call']);
  says(p, ['**Task file**', 'id `<feature>-T<n>`', '`--ticket <feature>/T<n>`', 'on the feature', 'branch `--branch` = `--base` = `<b>`', '`--merge-into` = its `merge_into`', 'on a ticket branch', '`--branch <b>-T<n>`', '`--base` = `--merge-into` = `<b>`']);
  assert.match(read('scripts', 'notes.js'), /\[--ticket <feature>\/T<n>\]/, 'notes.js task new takes --ticket');
});

test('end-task: a planned ticket is marked done right after the folder deletion, before git, only on a passed verification', () => {
  const text = skill('end-task');
  const done = '`node "<keel>/scripts/plans.js" "<project>" status <f> <t> done`';
  const reviewed = '`node "<keel>/scripts/plans.js" "<project>" reviewed <f> <t>`';
  says(text, ['`ticket: <f>/<t>`', 'a planned ticket']);
  order(text, 'task delete <id> --session <sid>', done, 'only a task that really finished marks its ticket');
  order(text, done, reviewed, 'the review hash follows the code it was verified with');
  order(text, reviewed, '8. Git: read', 'the ticket file goes into the same commit as the code');
  says(text, ['Right after `task delete` printed `deleted:`', 'only when the verification passed', 'gates green, no', 'must item left', 'no verification is not a pass']);
  assert.match(read('scripts', 'lib', 'tasks.js'), /`deleted: \$\{/, 'task delete prints that line');
  says(text, ['`plan: every ticket is done or abandoned: plans.js state <f> done`', 'Mark the plan <f>', 'done?', 'git-end-of-feature.md after the push']);
  says(text, ['`plans: status refused (...)`', 'warn with its reason', 'put the task back', 'task restore <id> --session <sid>`', 'stop before', 'git']);
  says(text, ['Red verification or a hand off', 'no `plans.js status` call', 'a hand off', "never changes a ticket's state"]);
  // An in-progress ticket whose text changed is reviewed with the code, never on its own.
  says(text, ['`needs review`', 'the verification', "also checks the ticket's changed text against the code", 'no separate review']);
});

test('end-task: the ticket file goes into the commit; a task put back puts its ticket back in progress; a hand-made commit is reminded', () => {
  const text = skill('end-task');
  const eight = part(text, '8. Git:', '9. Hand off');
  says(eight, ['A planned ticket, finish and hand off alike', '`--tickets "<f>/<t>"`', 'its ticket', 'file and `plan.md` go into the commit']);
  order(eight, '`restored:` lines', '`node "<keel>/scripts/plans.js" "<project>" status <f> <t> in-progress`', 'restored: is the trigger');
  says(eight, ['Any `restored:` line', 'manual `task restore`', 'after step 7 marked a ticket done', '`node "<keel>/scripts/plans.js" "<project>" status <f> <t> in-progress`']);
  says(eight, ['The user commits by hand', "declines keel's commit", 'after step 7 marked a ticket', '"The ticket file <path> is marked done: commit it with the code."']);
  // A ticket on this machine is outside git; End of feature waits for the user's push in manual git.
  says(eight, ['not for a', 'ticket under `.keel/local/`', 'it is outside git']);
  says(eight, ['with the plan marked done', 'complete; /keel:tasks offers its end once you have committed and pushed']);
  says(text, ['its `repo:`', 'another repository', "steps 4 and 8 run on that repository's folder", '`plans.js repos`']);
  const git = shared('git.md');
  says(git, ['`restored:` lines; say so', 'A ticket', 'the finish marked done goes back with it', '`node "<keel>/scripts/plans.js" "<project>" status <f> <t> in-progress`']);
  says(part(git, '2. Write', '3. **Merge**'), ['task restore <id> --session <sid>', 'and its ticket: `plans.js status <f> <t> in-progress`']);
});

test('end-task: a ticket on its feature branch is verified from the commit it started at', () => {
  const text = skill('end-task');
  says(text, ['a task whose `branch:` equals its `base:`', 'a planned ticket on its feature branch', 'that has `started:`', 'not a task step 2 created just now: that one uses `session start:` below', '`--base <started>`', "say in one line that teammates' commits pulled into that branch since are covered too"]);
  order(text, "`--base <the task's base branch>`", '`--base <started>`');
  order(text, '`--base <started>`', '`--base <that commit>`', 'the session start is the last resort');
});

test('end-session: a passed full verification marks the finished planned tickets done and commits them with --tickets', () => {
  const text = skill('end-session');
  const six = part(text, '6. Git:', '7. Costs');
  says(six, ['a passed full verification', 'not gates only, not red', "`<f>/<t>` in the note's `keys:`", 'whose Plan items are all ✅', '`node "<keel>/scripts/plans.js" "<project>" status <f> <t> done`', '`node "<keel>/scripts/plans.js" "<project>" reviewed <f> <t>`']);
  order(six, 'status <f> <t> done`', '`--tickets "<those f/t>"`', 'the tickets marked done are the ones committed');
  says(six, ['so their ticket files go into the commit'], 'git-flow.js commit leaves planning files out unless named');
  says(six, ['Gates only or', 'red → no `plans.js status` call']);
  // A session commits without --finish: after its commit HEAD holds done, so only a stop before it undoes.
  says(six, ['git stops before the commit holds them', '`save` stopped with', '`commit` not in its `done:` line', '`plans.js status <f> <t> in-progress` for each']);
  says(six, ['stop after the commit', '`commit` in `done:`', 'no undo', 'the commit holds them', 'push is left']);
  says(six, ['Manual git → one line', 'The ticket files <paths> are marked done', 'commit them with', 'the code', 'not for tickets under `.keel/local/`']);
  says(six, ['`plan: every ticket is done or abandoned: plans.js state <f> done`', 'Mark the plan <f>', 'git-end-of-feature.md after the push']);
  order(text, 'verify.md', 'status <f> <t> done`', 'done only after the verification');
});

test('start-session: a feature\'s planned tickets become the Plan, their references the note\'s keys, its plan branch the line\'s', () => {
  const row = shared('handoff-resume.md').split('\n').find((l) => l.startsWith('| no note (or `status: done`) + a feature'));
  assert.ok(row, 'the Resume table has a row for a feature');
  says(row, ['run `node "<keel>/scripts/plans.js" "<project>" tickets <feature>`']);
  says(row, ['`tickets: none (no feature <x>)`', 'not a feature', 'the rows below']);
  says(row, ['the **Plan** is its tickets marked `next` or `ready`', 'the `next` one first']);
  says(row, ['one ⬜ step each (`<feature>/T<n> <title>`)', '`keys` = those `<feature>/T<n>`', '(each must give `lane: none`)']);
  says(row, ['`branch` and `base` = the feature branch', '`merge_into` = its `merge_into`', 'only End of feature merges it']);
  says(row, ['Tickets `in-progress`, `draft` or `needs review`', 'listed with their marks', 'the user decides']);
  says(row, ['each after the tickets it depends on', '`plans.js tickets <feature>/T<n>` prints its `depends:` line', 'the feature view does not']);
  // The note is tracked: a switch needs a clean tree, so the branch comes before the note.
  says(row, ['on yes the branch first', 'then write the note', 'a switch needs a clean tree']);
  says(row, ['`start --name <b> --from <current>`', 'manual: give `git switch <b>` and wait', '`plans.js status <feature> T<n> in-progress --branch <b>` for each ticket of the Plan']);
  // The taken tickets reach the remote at once, only their files and plan.md.
  order(row, 'in-progress --branch <b>` for each ticket', '`plans.js commit <feature> --tickets <its T<n>s, comma-separated>`', 'the statuses are committed after they are set');
  says(row, ['a feature in the repository', 'not under `.keel/local/`', '`plans.js push <feature>`', 'Claude Code asks each', 'the remote shows the tickets taken']);
  const h = shared('handoff-resume.md');
  order(h, '+ a feature\'s name or folder', '| no note (or `status: done`) + a description |', 'a feature name is tried before it is read as a description');
  assert.match(skill('start-session'), /a feature's planned tickets/);
});

test('/keel:tasks: a Planned block after the tasks, the next ticket and the end of a done feature', () => {
  const t = skill('tasks');
  order(t, 'tasks --session <sid>', '`node "<keel>/scripts/plans.js" "<project>" tickets`', 'the tasks first');
  says(t, ['Not', '`tickets: none`', 'a block "Planned"', 'each feature and its ticket lines as printed']);
  says(t, ['"Start the next one with `/keel:start-task <feature>/T<n>`"', 'its `next:` line', '`next: none` → no such line']);
  says(t, ['`node "<keel>/scripts/plans.js" "<project>" list`', '`- <f>: done` line', 'offer its end', '`<keel>/skills/_shared/git-end-of-feature.md`']);
  says(t, ['the branch, only when', "the task's `branch` differs from its `base`", "a planned ticket's shared", 'feature branch is never offered', '`node "<keel>/scripts/git-flow.js" "<project>" delete-branch'], 'drop never deletes a shared feature branch');
});

test('git.md: a ticket on its feature branch: no start, the shared branch pulled, never merged before the feature is complete', () => {
  const git = shared('git.md');
  // A session over a feature has the same branch = base and no single task id.
  says(git, ['**A planned ticket on its feature branch**', 'equals its `base`', '`plans.js tickets <f>/<t>`', 'prints `branch: <that branch> -> <merge_into>`', 'no `start`, `sync`', 'pulls the shared branch, then `push`']);
  says(git, ['feature branch is never merged', 'also when', '`git.ask_before_merge` is false or the instruction asks'], 'overrides ask_before_merge: false');
  says(git, ['only "End of feature" below merges it', 'after the plan is marked done and a', 'yes']);
  says(git, ['A ticket branch `<feature branch>-<t>`', '(`base` = `merge_into` = the feature branch)', 'merges into the feature branch like any task']);
  says(part(git, '1. `status`', '2. Write'), ['not for a planned ticket on its feature branch', 'no `start`, see above']);
  // A handoff of a ticket of a feature with 2 or more tickets still makes its ticket branch.
  says(part(git, '1. `status`', '2. Write'), ['except its', 'task handoff when the feature has 2 or more tickets', 'a new ticket branch, above']);
  says(part(git, '2. Write', '3. **Merge**'), ['On the base itself', 'a planned ticket on its feature branch', 'merges `<remote>/<base>`', "the teammates'", 'commits of that shared branch']);
  says(git, ['A planned ticket works on its feature branch', 'not from the main branch']);
  // With ask_before_merge true the report would otherwise say "merge it when ready".
  says(git, ['"the feature merges at End of feature, after its last ticket"', 'not "merge it', 'when ready"', 'manual mode: commit and push, no merge advice']);
  says(git, ['**A planned ticket**', '`ticket: <f>/<t>`', '`save` adds `--tickets "<f>/<t>"`', 'finish and handoff alike', 'the ticket file and `plan.md` go into the commit']);
  says(git, ['**A ticket of another repository**', "the task's `repo:`", 'every `git-flow.js` step runs on that', "repository's folder in place of `<project>`", 'manual mode', '`node "<keel>/scripts/plans.js" "<project>" commit <f>`', '`push <f>`']);
  says(part(git, '2. Write', '3. **Merge**'), ['**finish**', '`--sync <base>`', '`--tickets` for a planned ticket']);
  says(shared('git-manual.md'), ['then merge as', 'they usually do', 'a planned ticket on its feature branch: commit and push only, see git.md above', '`plan.md` go into that commit']);
  says(shared('git-manual.md'), ['a planned ticket: `<feature branch>-<t>`', 'a planned ticket: `base` and `merge_into` to the feature branch']);
  assert.match(read('scripts', 'git-flow.js'), /^\/\/   commit --message-file <f> \[--tickets "<feature>\/T<n>,\.\.\."\]/m, 'git-flow.js commit takes the tickets as references');
});

test('git.md: the hand off of a ticket on a shared feature branch goes to a new ticket branch, no question', () => {
  const git = shared('git.md');
  const q = part(git, 'A planned ticket on its feature branch, when the feature has', '**Default steps**');
  says(q, ['when the feature has 2 or more tickets', '`plans.js tickets <f>`', 'one ticket → the usual commit and push to its branch']);
  says(q, ['also no', 'question', 'a new ticket branch `<feature branch>-<t>` from the feature branch', 'later merged back', 'into it']);
  says(q, ['`start --name <it> --from <the feature branch>`', 'carries the changes']);
  says(q, ["set the task file's", '`branch` to it', '`base` and `merge_into` to the feature branch', '`plans.js status <f> <t> in-progress --branch <it>`', 'before the commit']);
  assert.equal(q.split('\n').filter((l) => l.startsWith('- ')).length, 0, 'no options to choose from');
});

test('git.md: the end of a feature says so, then asks one step at a time; the feature branch is the one other branch keel deletes', () => {
  const git = shared('git.md');
  const end = shared('git-end-of-feature.md');
  says(part(git, '## End of feature', '## Never'), ['**End of feature**', 'the plan marked `done`', '`<keel>/skills/_shared/git-end-of-feature.md`', 'read', 'follow it']);
  says(end, ['After the plan is marked done', '`plans.js state <f> done` printed `status: done`', 'and the push', 'offered by `/keel:tasks`', 'both git modes', 'each step runs only on its own yes']);
  assert.match(end, /say "Feature <f> is complete:\s+all its tickets are done or abandoned\."[\s\S]*Then one question\s+at a time/);
  // The branches come from the plan, not from a ticket's task file (base = the plan's branch).
  says(end, ['`<branch>` and', '`<merge_into>` come from the `branch: <b> -> <m>` line', '`node "<keel>/scripts/plans.js" "<project>" tickets <f>`', 'never from the task file']);
  const zero = part(end, '0. Onto `<branch>`.', '1. The tickets');
  says(zero, ['On the ticket branch the last ticket finished on', '(`<branch>-<t>`)', 'first its usual merge into `<branch>`', '(step 3; it leaves you on `<branch>`)', 'declined or refused', 'the feature waits for that merge and stop here']);
  says(zero, ['Anywhere else (e.g. the main branch)', '"Switch to', '`<branch>`?"', '`switch --name <branch>`'], 'from /keel:tasks keel is usually on the main branch, where drop refuses');
  order(end, '0. Onto `<branch>`.', 'drop <f>`', 'on the feature branch before anything is dropped or committed');
  // Only a merge that really happened lets the branch go; git-flow.js merge prints that line.
  says(end, ['3. Only after step 2 printed', '`merge: <branch> -> <merge_into> (<sha>)`']);
  says(end, ['A declined or refused merge, or a pull request instead', 'no step 3', 'say the branch stays']);
  assert.match(read('scripts', 'git-flow.js'), /`merge: \$\{source\} -> \$\{target\} \(\$\{merged\}\)`/);
  says(end, ['keep them (default) or delete them']);
  says(end, ['`plans: drop refused (...)`', 'say why', 'tickets stay']);
  order(end, 'plans.js" "<project>" drop <f>`', 'plans.js" "<project>" commit <f>`', 'the folder leaves in its own commit');
  says(end, ['`drop: <folder> -> trash <batch>`']);
  says(end, ['in its own commit on the feature branch', 'before the merge', 'keel never commits on the main branch']);
  order(end, 'commit <f>`', '"Merge `<branch>` into `<merge_into>`?"', 'the tickets leave before the merge');
  order(end, '"Merge `<branch>` into `<merge_into>`?"', 'delete-branch --name <branch>', 'the branch goes last');
  // The merge leaves keel on merge_into (`now on:`), so the plan's branch is not the current one.
  says(end, ['it leaves you on', '`<merge_into>`', '"Delete the branch `<branch>`?"', '`node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>`']);
  says(part(git, '## Never'), ['which Claude Code confirms', 'except the feature branch in "End of', 'feature" above', "the task's own branch in task-to-planning.md", 'each on its yes']);
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /git-end-of-feature\.md/, `${name} leads to the end of a feature`);
});

test('git advice: keys are allowed inside planning files; a planned ticket works on its feature branch', () => {
  const advice = read('skills', 'git', 'SKILL.md');
  says(advice, ['planning files themselves', 'a feature folder: plan.md and its tickets', 'may hold keys']);
  says(advice, ['A planned', 'ticket (`<feature>/T<n>`)', 'works on its feature branch', '(plan.md `branch:`)', 'not from the main branch', 'a ticket branch, when one is needed, is `<feature branch>-T<n>` from the feature branch']);
  // A rule about what files may hold, not about commit messages: it lives with the comment rule only.
  assert.doesNotMatch(shared('git.md'), /Keys inside ticket files/);
});

test('no task or session instruction names a tracker key, a stub key or a git-derived state of a planned ticket', () => {
  const text = [shared('intake.md'), shared('handoff.md'), shared('handoff-resume.md'), shared('task-resume.md'), shared('git.md'), shared('git-manual.md'), shared('git-end-of-feature.md'), shared('final-report.md'), skill('end-task'), skill('end-session'), skill('tasks'), skill('start-task')].join('\n');
  for (const old of ['done <KEY>', 'done <id>', '--undo', '<PREFIX>', '-S<n>', 'waiting for the feature merge', 'waiting for merge into the feature branch', 'duplicate key', 'next: <KEY>', 'linked:', 'plans.js align', 'stubs left']) {
    assert.ok(!text.includes(old), `an instruction still says ${old}`);
  }
});

test('every plans.js output line the task and session instructions quote is printed by the scripts', () => {
  const file = (...p) => path.join(PLUGIN, 'scripts', ...p);
  const source = [['plans.js'], ['lib', 'plans.js'], ['lib', 'plans-state.js'], ['lib', 'plans-check.js']].map((p) => fs.readFileSync(file(...p), 'utf8')).join('\n');
  const text = [shared('intake.md'), shared('handoff.md'), shared('handoff-resume.md'), shared('git.md'), shared('git-end-of-feature.md'), skill('end-task'), skill('end-session'), skill('tasks')].join('\n');
  // Quoted as `<line start>...` in the instructions; printed from a template literal in the scripts.
  const lines = [['`next:', 'next: '], ['`next: none`', "'next: none'"], ['`tickets: none`', "'tickets: none'"], ['`tickets: none (no feature <x>)`', '`tickets: none (no feature '],
    ['`status: <t> done`', '`status: ${t.id} ${to}'], ['`status: done`', '[`status: ${to}`]'], ['`plans: status refused (...)`', '`plans: ${what} refused ('],
    ['`plan: every ticket is done or abandoned: plans.js state <f> done`', '`plan: every ticket is done or abandoned: plans.js state ${d.feature} done`'],
    ['`drop: <folder> -> trash <batch>`', '`drop: '], ['`remote: in-progress on <branch>`', '`  remote: '], ['`needs review`', "'needs review'"],
    ['`file:`', '`  file: '], ['`depends:`', '`  depends: '], ['`note:`', '`note: ']];
  for (const [quoted, printed] of lines) {
    assert.ok(text.includes(quoted), `the instructions do not quote ${quoted}`);
    assert.ok(source.includes(printed), `plans.js does not print ${printed}`);
  }
  const header = read('scripts', 'plans.js').split('\n').filter((l) => l.startsWith('//')).join('\n');
  const named = new Set([...text.matchAll(/plans\.js" "<project>" ([a-z]+)/g), ...text.matchAll(/`plans\.js ([a-z]+)/g)].map((m) => m[1]));
  for (const cmd of ['tickets', 'status', 'reviewed', 'state', 'drop', 'commit', 'push', 'list', 'repos']) assert.ok(named.has(cmd), `the instructions never call ${cmd}`);
  for (const cmd of named) assert.match(header, new RegExp(`^//   ${cmd}\\b`, 'm'), `plans.js documents no ${cmd}`);
});
