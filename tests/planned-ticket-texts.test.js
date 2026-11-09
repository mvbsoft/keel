'use strict';
// keel's instructions for planned tickets in the task and session lanes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PLUGIN, read, shared, skill, order, part, says } = require('./fixtures/texts.js');

// --- planned tickets in the task and session lanes (spec: .design/planning-spec.uk.md §2, §11) ---

const planned = () => part(shared('intake.md'), '## Planned ticket', '## Task to planning');

test('start-task: no instruction adds the next planned ticket; "next ticket" and a key read the state after a fetch', () => {
  const intake = shared('intake.md');
  says(intake, ['| empty |', 'unfinished tasks', 'then the next planned ticket', '"next planned: <KEY>"']);
  says(intake, ['the next ticket in any words ("next ticket")', '"Planned ticket" below']);
  says(intake, ['Any other `lane: none`', 'may be a planned ticket', '"Planned ticket" below first'], 'a finished or dropped task keeps its own answer');
  // A key whose earlier task was finished or dropped may still be a planned ticket.
  says(intake, ['`lane: none (task <id> was finished or dropped earlier)`', 'yes for a key', '"Planned ticket" below first']);
  const p = planned();
  says(p, ['`node "<keel>/scripts/plans.js" "<project>" tickets ...`']);
  says(p, ['No instruction', '`next: <KEY> (<feature>)` line', '"next planned: <KEY>"']);
  says(p, ['"next ticket" →', '`tickets --fetch`', 'key of its `next:` line']);
  order(p, '`tickets --fetch`', '`tickets <KEY>`', 'the next key is found first, then its own view');
  says(p, ['A key → `tickets <KEY> --fetch`', '`tickets: none (no ticket or feature <x>)`', 'not a planned ticket', "step 2's internal search goes on"]);
});

test('start-task: each ticket state has its answer; waiting is never free, done starts only on a yes', () => {
  const p = planned();
  says(p, ['`duplicate key (<n> files)`', 'warn first', '"two tickets with the key <KEY>"']);
  says(p, ['`to do` or `next`', 'read the ticket', '`git show <ref>:<path>`', 'Goal, Acceptance criteria and Where to look']);
  says(p, ['`in progress` or `waiting for ...`', 'branch, author and date', 'continue it (on that branch) / start over / take another ticket']);
  says(p, ['A waiting ticket is never offered as free', 'with `stale` ask', '"Nobody touched it for 30 days: treat it as free?"']);
  says(p, ['`reverted`', 'merged once and that merge was reverted', 'merging it again brings nothing back', 'revert of that revert, or new commits']);
  says(p, ['a `depends:` ticket of this repository', '`waiting for merge into the feature branch`', 'or one of another feature that is not done (not `not found`)', 'its `where:` line says where its code is']);
  says(p, ['`... or pull it into <b>: git merge <x>`', 'wait for its merge / pull it in', 'start anyway']);
  says(p, ['`... is in your feature branch <b>: <KEY> can start`', 'nothing to ask']);
  says(p, ['`done` → say so', 'start it again only on a yes']);
  says(p, ['a `depends:` ticket of the same feature', '`to do` or `in progress`', 'any `not found`', 'take the next ticket / start anyway']);
  // A squash merge after the tickets were removed leaves no ticket file in merge_into's history.
  says(p, ['A `not found` may be a finished feature', 'merged with squash after its tickets were removed', 'no ticket file ever reached `merge_into`', 'the user checks its code there']);
});

test('start-task: a ticket\'s task id is its key exactly; its feature branch comes first; the task file names the right base', () => {
  const intake = shared('intake.md');
  says(intake, ['A planned ticket: the id is its `key` exactly', '`PROJ-104`, no slug']);
  assert.match(intake, /a\s+planned ticket: `--source file --link <its file path>`/);
  const p = planned();
  order(p, 'switch --name <branch>', 'start --name <branch> --from <the ref that has the ticket>', 'an existing feature branch is switched to, a missing one created');
  order(p, 'start --name <branch> --from', 'Push `<branch>`', 'a new branch is offered to push at once, so others see the ticket is taken');
  says(p, ['ticket is taken?" (yes → `git-flow.js push`)']);
  // `file: origin/main:path` names a remote ref; git-flow.js start --from takes a branch name.
  says(p, ['the `file:` ref without the remote prefix', '`origin/x` → `x`', 'a working-tree `file:`: the current branch']);
  says(p, ['A ticket branch (rare: the user asks for one)', '`<KEY>-<short-name>`', 'always from the feature branch']);
  says(p, ['on the feature branch `branch` = `base`', "the ticket's `merge_into`", 'on a ticket branch `branch` = it and `base` = `merge_into`']);
  says(intake, ['A planned ticket: its branch options', '"Planned ticket" below'], 'step 6 hands the branch choice over');
});

test('end-task: a planned ticket is marked done right after the folder deletion, before git, only on a passed verification', () => {
  const text = skill('end-task');
  const done = '`node "<keel>/scripts/plans.js" "<project>" done <id>`';
  order(text, 'task delete <id> --session <sid>', done, 'only a task that really finished marks its ticket');
  order(text, done, '8. Git: read', 'the ticket file goes into the same commit as the code');
  says(text, ['Right after `task delete` printed `deleted:`', 'only when the verification passed', 'gates green, no must item left', 'no verification is not a pass']);
  assert.match(read('scripts', 'lib', 'tasks.js'), /`deleted: \$\{/, 'task delete prints that line');
  says(text, ['`done: feature <f> complete (<n> tickets)`', 'git.md "End of feature"', 'after the push']);
  says(text, ['`done: none (no ticket <KEY> here)`', '`plans.js tickets <id>`', 'not a ticket, go on', 'put the task back', 'task restore <id> --session <sid>`) and stop before git']);
  says(text, ['Red verification or a hand off', 'no `plans.js done` call']);
  // A slug id is no key: plans.js refuses it, and that only means the task is not a ticket.
  says(text, ['`plans: done refused (invalid key ...)`', 'the id is no key, not a ticket', 'go on']);
  says(text, ['Any other `plans: done refused (...)`', 'two files with the key', 'warn with its reason', 'put the task back the same way and stop before git']);
  assert.match(read('scripts', 'lib', 'plans-state.js'), /invalid key "/, 'plans.js done refuses a slug with "invalid key"');
});

test('end-task: a task put back puts its ticket back to todo; a hand-made commit is reminded of the ticket file', () => {
  const text = skill('end-task');
  const eight = part(text, '8. Git:', '9. Hand off');
  order(eight, '`restored:` lines', '`node "<keel>/scripts/plans.js" "<project>" done <id> --undo`', 'restored: is the trigger');
  says(eight, ['Any `restored:` line', 'manual `task restore`', 'after step 7 marked a ticket done', '`node "<keel>/scripts/plans.js" "<project>" done <id> --undo`']);
  says(eight, ['The user commits by hand', "declines keel's commit", 'after step 7 marked a ticket done', '→ one line: "The ticket file <path> is marked done: commit it with the code."']);
  // A ticket on this machine is outside git; End of feature waits for the user's push in manual git.
  says(eight, ['not for a ticket under `.keel/local/`', 'it is outside git']);
  says(eight, ['`done: feature <f> complete`', 'is complete; /keel:tasks offers its end', 'once you have committed and pushed']);
  const git = shared('git.md');
  says(git, ['`restored:` lines; say so', 'A ticket the finish marked done goes back with it', '`node "<keel>/scripts/plans.js" "<project>" done <id> --undo`']);
  says(part(git, '4. `sync', '5. `push`'), ['task restore <id> --session <sid>', 'and its ticket: `plans.js done <id> --undo`']);
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
  says(six, ['a passed full verification', 'not gates only, not red', "for each key in the note's `keys:`", 'whose Plan items are all ✅', '`node "<keel>/scripts/plans.js" "<project>" done <KEY>`']);
  order(six, 'done <KEY>`', '`--tickets "<those keys>"`', 'the keys marked done are the ones committed');
  says(six, ['so their ticket files go into the commit'], 'git-flow.js commit leaves planning files out unless named');
  says(six, ['Gates only or red → no `plans.js done` call']);
  // A session commits without --finish: after its commit HEAD holds done, so only a stop before it undoes.
  says(six, ['git stops before the commit holds them', '`commit` stopped or never ran', '`plans.js done <KEY> --undo` for each']);
  says(six, ['a stop after the commit (sync, push)', 'no undo', 'the commit holds them', 'say the push is left']);
  says(six, ['Manual git → one line', 'The ticket files <paths> are marked done', 'commit them with the code', 'not for tickets under `.keel/local/`']);
  says(six, ['with `done: feature <f> complete`', 'is complete; /keel:tasks offers its end', 'once you have committed and pushed']);
  says(six, ['`done: feature <f> complete (<n> tickets)`', 'git.md "End of feature"', 'after the push']);
  order(text, 'verify.md', 'done <KEY>`', 'done only after the verification');
});

test('start-session: a feature\'s planned tickets become the Plan, their keys the note\'s keys, its branch the line\'s', () => {
  const row = shared('handoff.md').split('\n').find((l) => l.startsWith('| no note (or `status: done`) + a feature'));
  assert.ok(row, 'the Resume table has a row for a feature');
  says(row, ['run `node "<keel>/scripts/plans.js" "<project>" tickets <feature>`']);
  says(row, ['`tickets: none (no ticket or feature <x>)`', 'not a feature', 'the rows below']);
  says(row, ['the **Plan** is its tickets marked `next` or `to do`', 'the `next` one first']);
  says(row, ['one ⬜ step each (`<KEY> <title>`)', '`keys` = those keys', '(each must give `lane: none`)']);
  says(row, ['`branch` and `base` = the feature branch']);
  says(row, ['Tickets `in progress` or `waiting for ...`', 'listed with their hints', 'the user decides']);
  says(row, ['each after the tickets it depends on', '`plans.js tickets <KEY>` prints its `depends:` line', 'the feature view does not']);
  // The note is tracked: a switch needs a clean tree, so the branch comes before the note.
  says(row, ['on yes the branch first', 'then write the note', 'a switch needs a clean tree']);
  says(row, ['`start --name <b> --from <the ref that has the tickets>`', 'refs without the remote prefix', '`origin/x` → `x`', 'manual: give `git switch <b>` and wait']);
  const h = shared('handoff.md');
  order(h, '+ a feature\'s name or folder', '| no note (or `status: done`) + a description |', 'a feature name is tried before it is read as a description');
  assert.match(skill('start-session'), /a feature's planned tickets/);
});

test('/keel:tasks: a Planned block after the tasks, the data date, the next key and the end of a complete feature', () => {
  const t = skill('tasks');
  order(t, 'tasks --session <sid>', '`node "<keel>/scripts/plans.js" "<project>" tickets`', 'the tasks first');
  says(t, ['Not `tickets: none`', 'a block "Planned"', 'each feature and its ticket lines as printed']);
  says(t, ['the data-date line', '`server data from <date>`', '`no remote` or `never fetched`']);
  says(t, ['"Start the next one with `/keel:start-task <KEY>`"', 'the key of its `next:` line', '`next: none` → no such line']);
  says(t, ['the branch, only when', "the task's `branch` differs from its `base`", "a planned ticket's shared feature branch is never offered", '`node "<keel>/scripts/git-flow.js" "<project>" delete-branch'], 'drop never deletes a shared feature branch');
  says(t, ['A feature whose every ticket is `done`', '`waiting for the feature merge`', 'offer its end', '"End of feature"']);
});

test('git.md: a ticket on its feature branch: no start, the shared branch pulled, never merged before the feature is complete', () => {
  const git = shared('git.md');
  // A session over a feature has the same branch = base and no single task id.
  says(git, ['**A planned ticket on its feature branch**', 'equals its `base`', '`plans.js tickets <the task id or a key of the note>`', 'prints `branch: <that branch> -> <merge_into>`', 'no `start`, `sync` pulls the shared branch, then `push`']);
  says(git, ['feature branch is never merged', 'also when `git.ask_before_merge` is false or the instruction asks'], 'overrides ask_before_merge: false');
  says(git, ['only "End of feature" below merges it', 'after `done: feature <f> complete` and a yes']);
  says(git, ['A ticket branch', '(`base` = `merge_into` = the feature branch)', 'merges into the feature branch like any task']);
  says(part(git, '1. `status`', '2. Write'), ['not for a planned ticket on its feature branch', 'no `start`, see above']);
  // A handoff of a ticket of a feature with 2 or more tickets still makes its ticket branch.
  says(part(git, '1. `status`', '2. Write'), ['except its task handoff when the feature has 2 or more tickets', 'a new ticket branch, above']);
  says(part(git, '4. `sync', '5. `push`'), ['On the base itself', 'a planned ticket on its feature branch', 'it merges `<remote>/<base>`', "the teammates' commits of that shared branch"]);
  says(git, ['A planned ticket works on its feature branch', 'not from the main branch']);
  // With ask_before_merge true the report would otherwise say "merge it when ready".
  says(git, ['"the feature merges at End of feature, after its last ticket"', 'not "merge it when ready"', 'manual mode: commit and push, no merge advice']);
  says(part(git, '## Manual mode', '## Autonomous mode'), ['then merge as they usually do', 'a planned ticket on its feature branch: commit and push only, see above']);
});

test('git.md: the hand off of a ticket on a shared feature branch goes to a new ticket branch, no question', () => {
  const git = shared('git.md');
  const q = part(git, 'A planned ticket on its feature branch, when the feature has', '**Default steps**');
  says(q, ['when the feature has 2 or more tickets', '`plans.js tickets <feature>`', 'one ticket → the usual commit and push to its branch']);
  says(q, ['also no question', 'a new ticket branch `<KEY>-<short-name>` from the feature branch', 'later merged back into it']);
  says(q, ['`start --name <it> --from <the feature branch>`', 'carries the changes']);
  says(q, ["set the task file's `branch` to it", '`base` and `merge_into` to the feature branch', 'before the commit']);
  assert.equal(q.split('\n').filter((l) => l.startsWith('- ')).length, 0, 'no options to choose from');
});

test('git.md: the end of a feature says so, then asks one step at a time; the feature branch is the one other branch keel deletes', () => {
  const git = shared('git.md');
  const end = part(git, '## End of feature', '## Never');
  says(end, ['After `done: feature <f> complete (<n> tickets)` and the push', 'offered by `/keel:tasks`', 'both git modes', 'each step runs only on its own yes']);
  assert.match(end, /say "Feature <f> is complete:\s+all <n> tickets done\."[\s\S]*Then one question\s+at a time/);
  // The branches come from the tickets, not from a ticket branch's task file (base = the feature branch).
  says(end, ['`<branch>` and `<merge_into>` come from the `branch: <b> -> <m>` line', '`node "<keel>/scripts/plans.js" "<project>" tickets <f>`', 'never from the task file']);
  const zero = part(end, '0. Onto `<branch>`.', '1. The tickets');
  says(zero, ['On the ticket branch the last ticket finished on', 'first its usual merge into `<branch>`', '(step 6; it leaves you on `<branch>`)', 'declined or refused', 'the feature waits for that merge and stop here']);
  says(zero, ['Anywhere else (e.g. the main branch)', '"Switch to `<branch>`?"', '`switch --name <branch>`'], 'from /keel:tasks keel is usually on the main branch, where drop refuses');
  order(end, '0. Onto `<branch>`.', 'drop <f>`', 'on the feature branch before anything is dropped or committed');
  // Only a merge that really happened lets the branch go; git-flow.js merge prints that line.
  says(end, ['3. Only after step 2 printed', '`merge: <branch> -> <merge_into> (<sha>)`']);
  says(end, ['A declined or refused merge, or a pull request instead', 'no step 3', 'say the branch stays']);
  assert.match(read('scripts', 'git-flow.js'), /`merge: \$\{source\} -> \$\{target\} \(\$\{merged\}\)`/);
  says(end, ['keep them (default) or delete them']);
  order(end, 'plans.js" "<project>" drop <f>`', 'plans.js" "<project>" commit <f>`', 'the folder leaves in its own commit');
  says(end, ['`drop: <folder> -> trash <batch>`']);
  says(end, ['in its own commit on the feature branch', 'before the merge', 'keel never commits on the main branch']);
  order(end, 'commit <f>`', '"Merge `<branch>` into `<merge_into>`?"', 'the tickets leave before the merge');
  order(end, '"Merge `<branch>` into `<merge_into>`?"', 'delete-branch --name <branch>', 'the branch goes last');
  // The merge leaves keel on merge_into (`now on:`), so the feature branch is not the current one.
  says(end, ['it leaves you on `<merge_into>`', '"Delete the branch `<branch>`?"', '`node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>`']);
  says(part(git, '## Never'), ['which Claude Code confirms', 'except the feature branch in "End of feature" above', 'the task\'s own branch in intake.md "Task to planning"', 'each on its yes']);
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /git\.md "End of\s+feature"/, `${name} leads to the end of a feature`);
});

test('git advice: keys are allowed inside ticket files; a planned ticket works on its feature branch', () => {
  const advice = read('skills', 'git', 'SKILL.md');
  says(advice, ['Ticket files themselves', '(front matter `type: ticket` or `type: feature`)', 'may hold keys']);
  says(advice, ['A planned ticket (a file with `type: ticket`)', 'works on its feature branch', '(its `branch:` field)', 'not from the main branch']);
  // A rule about what files may hold, not about commit messages: it lives with the comment rule only.
  assert.doesNotMatch(shared('git.md'), /Keys inside ticket files/);
});

test('every plans.js output line the task and session instructions quote is printed by the scripts', () => {
  const file = (...p) => path.join(PLUGIN, 'scripts', ...p);
  const source = [['plans.js'], ['lib', 'plans-state.js'], ['lib', 'plans-state-read.js'], ['lib', 'plans-state-rules.js']].map((p) => (fs.existsSync(file(...p)) ? fs.readFileSync(file(...p), 'utf8') : '')).join('\n');
  const text = [shared('intake.md'), shared('handoff.md'), shared('git.md'), skill('end-task'), skill('end-session'), skill('tasks')].join('\n');
  // Quoted as `<line start>...` in the instructions; printed from a template literal in the scripts.
  const lines = [['`next:', 'next: '], ['`next: none`', "'next: none'"], ['`tickets: none`', "'tickets: none'"], ['`tickets: none (no ticket or feature <x>)`', '`tickets: none (no ticket or feature '],
    ['`done: <KEY> (<path>)`', '`done: ${'], ['`done: <KEY> (already)`', ' (already)`'], ['`done: none (no ticket <KEY> here)`', '`done: none (no ticket '], ['`done: feature <f> complete (<n> tickets)`', '`done: feature '],
    ['`drop: <folder> -> trash <batch>`', '`drop: '], ['`duplicate key (<n> files)`', '`duplicate key ('], ['`stale`', "'stale'"], ['`reverted`', "'reverted'"],
    ['`waiting for the feature merge`', "'waiting for the feature merge'"], ['`done`', "'done'"],
    ['`waiting for merge into the feature branch`', "'waiting for merge into the feature branch'"], ['`in progress`', "'in progress'"], ['`to do`', "'to do'"],
    ['`no remote`', "'no remote'"], ['`never fetched`', "'never fetched'"], ['`server data from <date>`', '`server data from '], ['`file:`', '`  file: '], ['`depends:`', '`  depends: ']];
  for (const [quoted, printed] of lines) {
    assert.ok(text.includes(quoted), `the instructions do not quote ${quoted}`);
    assert.ok(source.includes(printed), `plans.js does not print ${printed}`);
  }
  const header = read('scripts', 'plans.js').split('\n').filter((l) => l.startsWith('//')).join('\n');
  const named = new Set([...text.matchAll(/plans\.js" "<project>" ([a-z]+)/g)].map((m) => m[1]));
  for (const cmd of ['tickets', 'done', 'drop', 'commit']) assert.ok(named.has(cmd), `the instructions never call ${cmd}`);
  for (const cmd of named) assert.match(header, new RegExp(`^//   ${cmd}\\b`, 'm'), `plans.js documents no ${cmd}`);
  assert.match(read('scripts', 'git-flow.js'), /^\/\/   commit --message-file <f> \[--tickets "<K1,K2>"\]/m, 'end-session commits the tickets it marked done');
});
