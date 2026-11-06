'use strict';
// keel's instructions for planned tickets in the task and session lanes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PLUGIN, read, shared, skill, order, part } = require('./fixtures/texts.js');

// --- planned tickets in the task and session lanes (spec: .design/planning-spec.uk.md §2, §11) ---

const planned = () => part(shared('intake.md'), '## Planned ticket', '## Task to planning');

test('start-task: no instruction adds the next planned ticket; "next ticket" and a key read the state after a fetch', () => {
  const intake = shared('intake.md');
  assert.match(intake, /\| empty \| unfinished tasks → show them \(as `\/keel:tasks` does\), then the next planned ticket \("Planned ticket" below: "next planned: <KEY>"\)/);
  assert.match(intake, /\| the next ticket in any words \("next ticket"\) \| "Planned ticket" below \|/);
  assert.match(intake, /Any other `lane: none` for a key → it may be a planned ticket: "Planned ticket" below first/, 'a finished or dropped task keeps its own answer');
  // A key whose earlier task was finished or dropped may still be a planned ticket.
  assert.match(intake, /`lane: none \(task <id> was finished or dropped earlier\)`[\s\S]{0,200}yes for a key → "Planned ticket" below first/);
  const p = planned();
  assert.match(p, /`node "<keel>\/scripts\/plans\.js" "<project>" tickets \.\.\.`/);
  assert.match(p, /No instruction → `tickets`: its `next: <KEY> \(<feature>\)` line becomes "next\s+planned: <KEY>"/);
  assert.match(p, /"next ticket" →\s+`tickets --fetch`, take the key of its `next:` line/);
  order(p, '`tickets --fetch`', '`tickets <KEY>`', 'the next key is found first, then its own view');
  assert.match(p, /A key → `tickets <KEY> --fetch`; `tickets: none \(no ticket or feature <x>\)` → not a\s+planned ticket: step 2's internal search goes on/);
});

test('start-task: each ticket state has its answer; waiting is never free, done starts only on a yes', () => {
  const p = planned();
  assert.match(p, /`duplicate key \(<n> files\)` → warn first: "two tickets with the key <KEY>"/);
  assert.match(p, /`to do` or `next` → read the ticket \(`file:` a path, or `<ref>:<path>`: `git show <ref>:<path>`\),\s+check its Goal, Acceptance criteria and Where to look against the code/);
  assert.match(p, /`in progress` or `waiting for \.\.\.` → say the branch, author and date of its hint and ask: continue\s+it \(on that branch\) \/ start over \/ take another ticket/);
  assert.match(p, /A waiting ticket is never offered as free;\s+with `stale` ask "Nobody touched it for 30 days: treat it as free\?"/);
  assert.match(p, /`reverted` → say "The branch\s+was merged once and that merge was reverted; merging it again brings nothing back: it needs a\s+revert of that revert, or new commits\."/);
  assert.match(p, /a `depends:` ticket of this repository `waiting for merge into the feature branch`, or one of\s+another feature that is not done \(not `not found`\) → its `where:` line says where its code is: say\s+it in plain words\. `\.\.\. or pull it into <b>: git merge <x>` → ask: wait for its merge \/ pull it in\s+\(`git merge <x>` on `<b>`, after step 3's branch\) \/ start anyway; another `where:` → ask: wait for\s+it \/ start anyway\. `\.\.\. is in your feature branch <b>: <KEY> can start` → say so, nothing to ask/);
  assert.match(p, /`done` → say so; start it again only on a yes/);
  assert.match(p, /a `depends:` ticket of the same feature `to do` or `in progress`, or any `not found` → say which,\s+and ask: take the next ticket \/ start anyway/);
  // A squash merge after the tickets were removed leaves no ticket file in merge_into's history.
  assert.match(p, /A `not found` may be a finished feature merged\s+with squash after its tickets were removed \(no ticket file ever reached `merge_into`\): say so;\s+the user checks its code there/);
});

test('start-task: a ticket\'s task id is its key exactly; its feature branch comes first; the task file names the right base', () => {
  const intake = shared('intake.md');
  assert.match(intake, /A planned\s+ticket: the id is its `key` exactly \(`PROJ-104`, no slug\)/);
  assert.match(intake, /a\s+planned ticket: `--source file --link <its file path>`/);
  const p = planned();
  order(p, 'switch --name <branch>', 'start --name <branch> --from <the ref that has the ticket>', 'an existing feature branch is switched to, a missing one created');
  order(p, 'start --name <branch> --from', 'Push `<branch>`', 'a new branch is offered to push at once, so others see the ticket is taken');
  assert.match(p, /ticket is taken\?" \(yes → `git-flow\.js push`\)/);
  // `file: origin/main:path` names a remote ref; git-flow.js start --from takes a branch name.
  assert.match(p, /\(the `file:` ref without the remote prefix: `origin\/x` → `x`; a working-tree `file:`: the current\s+branch\)/);
  assert.match(p, /A ticket branch \(rare: the user asks for one\) →\s+`<KEY>-<short-name>`, always from the feature branch/);
  assert.match(p, /on the feature branch `branch` = `base` = the feature branch and\s+`merge_into` = the ticket's `merge_into`; on a ticket branch `branch` = it and `base` = `merge_into`\s+= the feature branch/);
  assert.match(intake, /A planned ticket: its\s+branch options are in "Planned ticket" below/, 'step 6 hands the branch choice over');
});

test('end-task: a planned ticket is marked done right after the folder deletion, before git, only on a passed verification', () => {
  const text = skill('end-task');
  const done = '`node "<keel>/scripts/plans.js" "<project>" done <id>`';
  order(text, 'task delete <id> --session <sid>', done, 'only a task that really finished marks its ticket');
  order(text, done, '8. Git: read', 'the ticket file goes into the same commit as the code');
  assert.match(text, /Right after `task delete` printed `deleted:`, only when the verification passed \(gates green, no must item left;\s+no verification is not a pass\)/);
  assert.match(read('scripts', 'lib', 'tasks.js'), /`deleted: \$\{/, 'task delete prints that line');
  assert.match(text, /`done: feature <f> complete \(<n> tickets\)` → git\.md "End of\s+feature" after the push/);
  assert.match(text, /`done: none \(no ticket <KEY> here\)` → `plans\.js tickets <id>`:\s+`tickets: none \.\.\.` → not a ticket, go on; else warn[\s\S]{0,120}put the task back[\s\S]{0,80}task restore <id> --session <sid>`\) and stop before git/);
  assert.match(text, /Red verification or a hand off → no\s+`plans\.js done` call/);
  // A slug id is no key: plans.js refuses it, and that only means the task is not a ticket.
  assert.match(text, /`plans: done refused \(invalid key \.\.\.\)` → the id is no key, not a ticket: go\s+on/);
  assert.match(text, /Any other `plans: done refused \(\.\.\.\)` \(e\.g\. two files with the key\) → warn with its reason,\s+put the task back the same way and stop before git/);
  assert.match(read('scripts', 'lib', 'plans-state.js'), /invalid key "/, 'plans.js done refuses a slug with "invalid key"');
});

test('end-task: a task put back puts its ticket back to todo; a hand-made commit is reminded of the ticket file', () => {
  const text = skill('end-task');
  const eight = part(text, '8. Git:', '9. Hand off');
  order(eight, '`restored:` lines', '`node "<keel>/scripts/plans.js" "<project>" done <id> --undo`', 'restored: is the trigger');
  assert.match(eight, /Any `restored:` line, or that manual `task restore`, after step 7 marked a ticket done → also\s+`node "<keel>\/scripts\/plans\.js" "<project>" done <id> --undo`/);
  assert.match(eight, /The user commits by hand \(manual git, or declines keel's commit\) after step 7 marked a ticket\s+done → one line: "The ticket file <path> is marked done: commit it with the code\."/);
  // A ticket on this machine is outside git; End of feature waits for the user's push in manual git.
  assert.match(eight, /\(not for a\s+ticket under `\.keel\/local\/`: it is outside git\)/);
  assert.match(eight, /with `done: feature <f> complete` also "Feature\s+<f> is complete; \/keel:tasks offers its end once you have committed and pushed\."/);
  const git = shared('git.md');
  assert.match(git, /\(`restored:` lines; say so\)\. A ticket\s+the finish marked done goes back with it: `node "<keel>\/scripts\/plans\.js" "<project>" done <id> --undo`/);
  assert.match(part(git, '4. `sync', '5. `push`'), /task restore <id> --session <sid>`\s+\(and its ticket: `plans\.js done <id> --undo`\)/);
});

test('end-task: a ticket on its feature branch is verified from the commit it started at', () => {
  const text = skill('end-task');
  assert.match(text, /a task whose `branch:` equals its `base:` \(a planned ticket on its feature branch\) and\s+that has `started:` \(not a task step 2 created just now: that one uses `session start:` below\) →\s+`--base <started>`: say in one line that teammates' commits pulled into\s+that branch since are covered too/);
  order(text, "`--base <the task's base branch>`", '`--base <started>`');
  order(text, '`--base <started>`', '`--base <that commit>`', 'the session start is the last resort');
});

test('end-session: a passed full verification marks the finished planned tickets done and commits them with --tickets', () => {
  const text = skill('end-session');
  const six = part(text, '6. Git:', '7. Costs');
  assert.match(six, /a passed full verification \(not gates only, not red\) → for each key in the\s+note's `keys:` whose Plan items are all ✅, `node "<keel>\/scripts\/plans\.js" "<project>" done <KEY>`/);
  order(six, 'done <KEY>`', '`--tickets "<those keys>"`', 'the keys marked done are the ones committed');
  assert.match(six, /so their ticket files go into the commit/, 'git-flow.js commit leaves planning files out unless named');
  assert.match(six, /Gates only or red → no `plans\.js done` call/);
  // A session commits without --finish: after its commit HEAD holds done, so only a stop before it undoes.
  assert.match(six, /git stops\s+before the commit holds them \(`commit` stopped or never ran\) → `plans\.js done <KEY> --undo` for\s+each/);
  assert.match(six, /a stop after the commit \(sync, push\) → no undo: the commit\s+holds them, say the push is left/);
  assert.match(six, /Manual git → one line: "The ticket files <paths> are marked\s+done: commit them with the code\." \(not for tickets under `\.keel\/local\/`: they are outside git\)/);
  assert.match(six, /with `done: feature <f> complete` also "Feature <f> is complete; \/keel:tasks offers its end once\s+you have committed and pushed\."/);
  assert.match(six, /`done: feature <f> complete \(<n> tickets\)`\s+→ git\.md "End of feature" after the push/);
  order(text, 'verify.md', 'done <KEY>`', 'done only after the verification');
});

test('start-session: a feature\'s planned tickets become the Plan, their keys the note\'s keys, its branch the line\'s', () => {
  const row = shared('handoff.md').split('\n').find((l) => l.startsWith('| no note (or `status: done`) + a feature'));
  assert.ok(row, 'the Resume table has a row for a feature');
  assert.match(row, /run `node "<keel>\/scripts\/plans\.js" "<project>" tickets <feature>`/);
  assert.match(row, /`tickets: none \(no ticket or feature <x>\)` → not a feature: the rows below/);
  assert.match(row, /the \*\*Plan\*\* is its tickets marked `next` or `to do`, the `next` one first/);
  assert.match(row, /one ⬜ step each \(`<KEY> <title>`\); `keys` = those keys \(each must give `lane: none`\)/);
  assert.match(row, /`branch` and `base` = the feature branch/);
  assert.match(row, /Tickets `in progress` or `waiting for \.\.\.` are listed with their hints and the user decides/);
  assert.match(row, /each after the tickets it depends on \(`plans\.js tickets <KEY>` prints its `depends:` line; the feature view does not\)/);
  // The note is tracked: a switch needs a clean tree, so the branch comes before the note.
  assert.match(row, /on yes the branch first, then write the note \(a switch needs a clean tree\)/);
  assert.match(row, /missing: `start --name <b> --from <the ref that has the tickets>`; refs without the remote prefix: `origin\/x` → `x`\); manual: give `git switch <b>` and wait/);
  const h = shared('handoff.md');
  order(h, '+ a feature\'s name or folder', '| no note (or `status: done`) + a description |', 'a feature name is tried before it is read as a description');
  assert.match(skill('start-session'), /a feature's planned tickets/);
});

test('/keel:tasks: a Planned block after the tasks, the data date, the next key and the end of a complete feature', () => {
  const t = skill('tasks');
  order(t, 'tasks --session <sid>', '`node "<keel>/scripts/plans.js" "<project>" tickets`', 'the tasks first');
  assert.match(t, /Not\s+`tickets: none` → a block "Planned": each feature and its ticket lines as printed/);
  assert.match(t, /the data-date line\s+\(`server data from <date>`, `no remote` or `never fetched`\)/);
  assert.match(t, /"Start the next one with\s+`\/keel:start-task <KEY>`" with the key of its `next:` line \(`next: none` → no such line\)/);
  assert.match(t, /- the branch, only when the task's `branch` differs from its `base` \(a planned ticket's shared\s+feature branch is never offered\) → `node "<keel>\/scripts\/git-flow\.js" "<project>" delete-branch/, 'drop never deletes a shared feature branch');
  assert.match(t, /A\s+feature whose every ticket is `done` or `waiting for the feature merge` \(all done in its feature\s+branch\) → offer its end as `<keel>\/skills\/_shared\/git\.md` "End of feature" says/);
});

test('git.md: a ticket on its feature branch: no start, the shared branch pulled, never merged before the feature is complete', () => {
  const git = shared('git.md');
  // A session over a feature has the same branch = base and no single task id.
  assert.match(git, /\*\*A planned ticket on its feature branch\*\* \(a task or a session over a feature: the task file's or\s+the note's `branch` equals its `base`, and `plans\.js tickets <the task id or a key of the note>`\s+prints `branch: <that branch> -> <merge_into>`\): no `start`, `sync` pulls the shared branch, then\s+`push`/);
  assert.match(git, /feature branch is never merged, also when `git\.ask_before_merge` is false or the instruction asks/, 'overrides ask_before_merge: false');
  assert.match(git, /only "End of feature" below merges\s+it, after `done: feature <f> complete` and a yes/);
  assert.match(git, /A ticket branch\s+\(`base` = `merge_into` = the feature branch\) merges into the feature branch like any task/);
  assert.match(part(git, '1. `status`', '2. Write'), /not for a planned ticket on its feature branch \(no `start`, see above\)/);
  assert.match(part(git, '4. `sync', '5. `push`'), /On the base itself \(a planned ticket on its feature branch\) it merges\s+`<remote>\/<base>`: the teammates' commits of that shared branch/);
  assert.match(git, /A planned ticket works on its feature branch, not from the main branch/);
  // With ask_before_merge true the report would otherwise say "merge it when ready".
  assert.match(git, /Its report says "the feature merges at End of\s+feature, after its last ticket", not "merge it when ready"; manual mode: commit and push, no merge\s+advice/);
  assert.match(part(git, '## Manual mode', '## Autonomous mode'), /then merge as\s+they usually do \(a planned ticket on its feature branch: commit and push only, see above\)/);
});

test('git.md: the hand off of a ticket on a shared feature branch asks three options, a new ticket branch first', () => {
  const git = shared('git.md');
  const q = part(git, 'A planned ticket on its feature branch asks this instead', '**Default steps**');
  assert.match(q, /when the feature has 2 or more tickets\s+\(`plans\.js tickets <feature>`; one ticket → the usual commit and push to its branch\)/);
  const options = q.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(options.length, 3, 'three options');
  assert.match(options[0], /a new ticket branch `<KEY>-<short-name>` from the feature branch \(recommended; later merged back/);
  assert.match(q, /`start --name <it> --from <the feature branch>` carries the changes/);
  assert.match(q, /set the task file's `branch` to it and `base` and\s+`merge_into` to the feature branch before the commit/);
  assert.match(options[1], /commit and push to the feature branch \(you work on it alone\)/);
  assert.match(options[2], /no commit/);
});

test('git.md: the end of a feature says so, then asks one step at a time; the feature branch is the one other branch keel deletes', () => {
  const git = shared('git.md');
  const end = part(git, '## End of feature', '## Never');
  assert.match(end, /After `done: feature <f> complete \(<n> tickets\)` and the push, or offered by `\/keel:tasks` \(both git\s+modes: each step runs only on its own yes/);
  assert.match(end, /say "Feature <f> is complete:\s+all <n> tickets done\."[\s\S]*Then one question\s+at a time/);
  // The branches come from the tickets, not from a ticket branch's task file (base = the feature branch).
  assert.match(end, /`<branch>` and `<merge_into>` come from the `branch: <b> -> <m>` line of\s+`node "<keel>\/scripts\/plans\.js" "<project>" tickets <f>`, never from the task file/);
  const zero = part(end, '0. Onto `<branch>`.', '1. The tickets');
  assert.match(zero, /On the ticket branch the last ticket finished on → first\s+its usual merge into `<branch>` \(step 6; it leaves you on `<branch>`\); declined or refused → say the\s+feature waits for that merge and stop here/);
  assert.match(zero, /Anywhere else \(e\.g\. the main branch\) → "Switch to\s+`<branch>`\?" → `switch --name <branch>`/, 'from /keel:tasks keel is usually on the main branch, where drop refuses');
  order(end, '0. Onto `<branch>`.', 'drop <f>`', 'on the feature branch before anything is dropped or committed');
  // Only a merge that really happened lets the branch go; git-flow.js merge prints that line.
  assert.match(end, /3\. Only after step 2 printed `merge: <branch> -> <merge_into> \(<sha>\)`/);
  assert.match(end, /A declined or refused merge, or a pull request instead →\s+no step 3: say the branch stays/);
  assert.match(read('scripts', 'git-flow.js'), /`merge: \$\{source\} -> \$\{target\} \(\$\{merged\}\)`/);
  assert.match(end, /keep them \(default\) or delete them/);
  order(end, 'plans.js" "<project>" drop <f>`', 'plans.js" "<project>" commit <f>`', 'the folder leaves in its own commit');
  assert.match(end, /`drop: <folder> -> trash <batch>`/);
  assert.match(end, /in its own commit on the feature branch, before the merge\s+\(keel never commits on the main branch\)/);
  order(end, 'commit <f>`', '"Merge `<branch>` into `<merge_into>`?"', 'the tickets leave before the merge');
  order(end, '"Merge `<branch>` into `<merge_into>`?"', 'delete-branch --name <branch>', 'the branch goes last');
  // The merge leaves keel on merge_into (`now on:`), so the feature branch is not the current one.
  assert.match(end, /\(it leaves you on\s+`<merge_into>`\): "Delete the branch `<branch>`\?" →\s+`node "<keel>\/scripts\/git-flow\.js" "<project>" delete-branch --name <branch>`/);
  assert.match(part(git, '## Never'), /which Claude Code confirms\), except the feature branch in "End of\s+feature" above and the task's own branch in intake\.md "Task to planning", each on its yes/);
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /git\.md "End of\s+feature"/, `${name} leads to the end of a feature`);
});

test('git advice: keys are allowed inside ticket files; a planned ticket works on its feature branch', () => {
  const advice = read('skills', 'git', 'SKILL.md');
  assert.match(advice, /Ticket\s+files themselves \(front matter `type: ticket` or `type: feature`\) may hold keys/);
  assert.match(advice, /A planned\s+ticket \(a file with `type: ticket`\) works on its feature branch \(its `branch:` field\), not from the\s+main branch/);
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
