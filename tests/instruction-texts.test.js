'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { PLUGIN, read, shared, skill, part, says } = require('./fixtures/texts.js');
const frontmatter = (text) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';

test('end-session is the long-work lane only: the note, never the task files', () => {
  const text = read('skills', 'end-session', 'SKILL.md');
  assert.doesNotMatch(text, /current-task|clear-task|task finish|\.keel\/tasks/);
  says(text, ['Task files are not part of this lane']);
  assert.match(text, /\*\*Later\*\*/);
  const handoff = read('skills', '_shared', 'handoff.md');
  assert.doesNotMatch(handoff, /current-task|\.keel\/tasks\/|task finish/);
  says(handoff, ['never the task files']);
  says(handoff, ['Tasks use /keel:start-task'], 'a task id or ticket as the argument points to the other lane');
  assert.match(handoff, /\*\*Later\*\*[\s\S]*propose the next 1-3/, 'a finished Plan proposes the next items from Later');
});

test('the note carries merge_into and execution, handoff and git read them from the note or the task file', () => {
  const note = frontmatter(read('templates', 'keel', 'next-session.md'));
  for (const key of ['base', 'merge_into', 'execution']) assert.match(note, new RegExp(`^${key}:`, 'm'), key);
  assert.match(read('skills', '_shared', 'handoff.md'), /`branch`, `base`, `merge_into` and `execution`/);
  says(read('skills', '_shared', 'git.md'), ['`base` and `merge_into`', 'task file (end-task)', 'note (end-session)']);
});

test('there is one word for parking a task: handoff (no pause, status handed-off)', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : files.push(path.join(dir, e.name))));
  walk(path.join(PLUGIN, 'skills'));
  walk(path.join(PLUGIN, 'templates', 'keel'));
  files.push(path.join(PLUGIN, 'scripts', 'notes.js'), path.join(PLUGIN, 'scripts', 'lib', 'tasks.js'));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /paus(e|ed|ing)/i, path.relative(PLUGIN, file));
  assert.match(read('templates', 'keel', 'task.md'), /^status: <active \| handed-off>$/m);
});

test('start-task: one lane per conversation, uncommitted changes stop a task switch, resume re-reads the source', () => {
  const intake = read('skills', '_shared', 'intake.md');
  says(intake, ['A long-work line is open here'], 'start-task while a session line is open');
  assert.match(read('skills', '_shared', 'handoff.md'), /A task is active in this session/, 'start-session while a task is active');
  const before = intake.slice(intake.indexOf('## Before any branch change'));
  says(before, ['git-flow.js" "<project>" status']);
  says(before, ['`changed files:` not 0 → stop and offer']);
  // A stash stays on this machine only: the offer is a handoff, which commits and pushes.
  says(before, ['hand off the current task first', '`/keel:end-task hand off`', 'a work-in-progress commit on its own branch, pushed']);
  assert.doesNotMatch(before, /stash/);
  says(before, ['Never carry changes into another task']);
  const resume = intake.slice(intake.indexOf('## Resume'), intake.indexOf('## Before any branch change'));
  assert.ok(resume.indexOf('Uncommitted changes') < resume.indexOf('switch --name'), 'changes are dealt with before the switch');
  says(resume, ['`Base moved:`']);
  says(resume, ['git-flow.js sync --from <base>']);
  says(resume, ['read the source again', 'Do not overwrite them', 'without a yes']);
  assert.ok(intake.indexOf('git-flow.js" "<project>" start --name') < intake.indexOf('task new <id>'), 'the branch is made first, then the task file is written');
});

test('end-task verifies a resumed task as a whole: the base is its base branch, the session start only without a task branch', () => {
  const text = read('skills', 'end-task', 'SKILL.md');
  says(text, ['when it has its own branch', "`--base <the task's base branch>`", 'earlier sessions are covered']);
  assert.ok(text.indexOf("`--base <the task's base branch>`") < text.indexOf('`--base <that commit>`'));
  says(text, ['only without a task branch', 'manual git on the main branch']);
  says(read('skills', '_shared', 'verify.md'), ['git takes the merge base', 'branch name covers its whole work']);
});

test('end-task: a handoff never stops on red gates and records them in the task file', () => {
  const text = read('skills', 'end-task', 'SKILL.md');
  // The section is "Open questions" now: one handoff format for tasks and sessions.
  says(text, ['A handoff never stops on red gates', '`gates failing: <which>`', 'Open questions']);
});

test('verify.md: comments are settled before the overview, one base, level list and step numbers are right', () => {
  const text = read('skills', '_shared', 'verify.md');
  assert.ok(text.indexOf('comments.js') < text.indexOf('changes.js" "<project>" --start'), 'the diff is written after the comment edits');
  assert.equal((text.match(/comments\.js/g) || []).length, 1);
  assert.doesNotMatch(text, /--base <main branch>/);
  says(text, ['Maximum / No verification']);
  assert.doesNotMatch(text, /step 13/);
  says(text, ['for `qa-break`', 'test commands', "path of QA's saved reply"]);
  says(text, ['for `test-reviewer`: the test commands']);
  says(text, ['for topic `comments`', 'long comments you kept in step 1']);
});

test('test-reviewer reverts with plain git commands only, no copying or redirection', () => {
  const text = read('agents', 'test-reviewer.md');
  says(text, ['git diff --binary <base> --output=']);
  says(text, ['git apply -R']);
  assert.doesNotMatch(text, /`cp`|git show <base>:<path> >|cmd \/c/);
});

test('qa claims no browser tool it does not have', () => {
  const text = read('agents', 'qa.md');
  assert.doesNotMatch(text, /Playwright|browser/i);
  assert.doesNotMatch(frontmatter(text), /mcp__/);
});

test('git advice agrees: keel never force-pushes, comments follow the project level, git-flow can be unavailable', () => {
  assert.match(read('skills', 'git', 'SKILL.md'), /keel's own flows never force-push/);
  assert.doesNotMatch(read('skills', 'git', 'SKILL.md'), /states only the non-obvious why/);
  assert.doesNotMatch(read('skills', 'documentation-philosophy', 'SKILL.md'), /only the non-obvious why/);
  assert.doesNotMatch(read('skills', 'documentation-philosophy', 'SKILL.md'), /\*\*Heavy:\*\*/, 'profiles live in docs-profiles.md only');
  assert.match(read('hooks', 'standards.md'), /ask_before_merge: false/);
  assert.match(read('skills', '_shared', 'git.md'), /`stopped` or `unavailable`/);
  assert.match(read('skills', '_shared', 'intake.md'), /`stopped` or `unavailable`/);
});

test('the secret-file list lives in _search.md only', () => {
  assert.match(read('protocols', '_search.md'), /\*\.tfstate/);
  assert.doesNotMatch(read('agents', 'context.md'), /\*\.tfstate/);
  assert.match(read('agents', 'context.md'), /_search\.md/);
});

test('agent and protocol prompts carry no project history', () => {
  for (const [dir, file] of [['agents', 'reviewer.md'], ['protocols', 'architecture.md']]) {
    assert.doesNotMatch(read(dir, file), /D38|phase 8|7 of 7 runs/, file);
  }
});

// --- the two lanes: free-text instructions, sources, lanes, endings, one report and one handoff format ---

test('no keyword arguments: the four lane commands take a free-text instruction', () => {
  for (const name of ['start-task', 'end-task', 'start-session', 'end-session']) {
    const text = skill(name);
    says(text, ['The user\'s instruction (arguments, free text): `$ARGUMENTS`'], name);
    assert.doesNotMatch(frontmatter(text), /\[handoff\]|\[done\]|\| continue>/, `${name}: no keyword in the argument hint`);
  }
  assert.doesNotMatch(skill('end-session'), /`done`/, 'end-session has no done word');
  assert.doesNotMatch(skill('end-task'), /`handoff`/, 'end-task has no handoff word');
  says(shared('preflight.md'), ['Before each action', 'say in one short line', 'what it will do']);
  says(shared('preflight.md'), ['ask, never guess']);
});

test('start-task: a link is read from outside, anything else is searched inside; #123 reads nothing by itself', () => {
  const intake = shared('intake.md');
  const source = intake.slice(intake.indexOf('## 2. Source'), intake.indexOf('## 3.'));
  says(source, ['a link (any URL', '**external**', 'matching connector tool', '`gh issue view', 'WebFetch']);
  says(source, ['**internal search**', "keel's tasks first", 'then the repository']);
  says(source, ['"Is this it?"']);
  says(source, ['`#123` alone never reads a GitHub issue']);
  says(source, ['ask the user to paste the text']);
  says(source, ['notes.js" "<project>" lane <key or link>`', '`lane: session`', 'This is led by /keel:start-session']);
  assert.doesNotMatch(intake, /screenshot/i, 'screenshots are not promised');
});

test('start-task: retell, always "new or continuation", the system proposes id, title and description', () => {
  const intake = shared('intake.md');
  const retell = intake.slice(intake.indexOf('## 3. Retell'), intake.indexOf('## 4.'));
  says(retell, ['Always settle "new or continuation"']);
  says(retell, ['"Is this a continuation of <id>, or a new task?"']);
  says(retell, ['"No unfinished tasks, so this is a new one. Right?"']);
  says(retell, ['**Check the premise**']);
  const name = intake.slice(intake.indexOf('## 4. Name'), intake.indexOf('## 5.'));
  says(name, ['`fix-reset-500`']);
  // The name is asked inside the one "new?" question (a live eval run stated it without asking).
  says(name, ['**title**', '**one-line description**', 'step 3 question']);
  const resume = intake.slice(intake.indexOf('## Resume'));
  says(resume, ['7 days ago or more']);
  says(resume, ['Run the "How to check" command once']);
  says(resume, ['Summary in 3-6 lines']);
  assert.ok(resume.indexOf('switch --name') < resume.indexOf('task activate') && resume.indexOf('task activate') < resume.indexOf('How to check'), 'switch, read, staleness, check, summary');
});

test('brainstorm only with a yes: why and how, options, 2-3 approaches, plan in parts, no code before approval', () => {
  const intake = shared('intake.md');
  const b = intake.slice(intake.indexOf('**Brainstorm, only with a yes.**'), intake.indexOf('**Questions**'));
  for (const key of ['AskUserQuestion', '1-3 per message', '2-3 approaches with your recommendation', 'the plan in parts, each approved', 'no code before the plan is approved', 'contradictions', 'split first', '"Turn it on?". No → the ordinary path']) says(b, [key], key);
  says(shared('handoff.md'), ['intake.md` steps 3, 5 and 6', 'retell', 'brainstorm offer'], 'start-session offers it for a description too');
});

test('end-task: a menu without an instruction; finish asks before the script deletes the folder; hand off runs gates only', () => {
  const text = skill('end-task');
  says(text, ['No instruction → ask', '1) finish fully', '2) hand off', '3) your own instruction']);
  says(text, ['Ambiguous', 'only "push"', 'ask, never guess']);
  // Claude Code itself confirms the folder (keel's hook asks), so the chat does not ask it again.
  says(text, ['do not ask "fully done?" in the chat', 'Claude Code itself asks it', 'step 7', '`task delete`']);
  says(text, ['Claude Code will now ask you to confirm', 'the task is done', "goes to keel's trash"]);
  says(text, ['A clear instruction does not ask WHAT to do', 'asks the level when none is given', 'confirms the folder in step 7']);
  says(text, ['verify without a task file', 'a hand off needs the file', 'without one, skip the step 7 deletion']);
  says(text, ['none (no verification)']);
  says(text, ['Manual: keel runs no git', 'commit command that includes the deletion', 'did not commit (or will not)', 'node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>']);
  says(text, ['The user declines', 'non-interactive run denies it', 'Never run it again', 'The task stays as it is', 'skip steps 8 and 9'], 'no: no git, no deactivate');
  says(text, ['**Hand off**', 'gates only, no agents', 'read only the sections', '"1. Overview of the change"', '"2. Gates"', '"12. Result"']);
  for (const h of ['## 1. Overview of the change', '## 2. Gates', '## 12. Result']) assert.ok(shared('verify.md').includes(h), h);
  says(text, ['create branch bug/FIX-123, push, merge into main', 'run in step 8', 'after verification']);
  assert.doesNotMatch(text, /archive/);
  const git = shared('git.md');
  says(git, ['**Merging**', 'only when the instruction asks for it', 'a **finish**', '`git.ask_before_merge` is false']);
  says(git, ['Red verification', 'instruction to push or merge', 'stop and ask before any git step']);
  says(git, ['**task handoff**', 'asks to merge', 'Finish the task instead, or merge anyway?'], 'an unfinished task is not merged into the target without asking');
});

test('start-session: without an instruction it finds work or points to tasks, never starts one; lanes never mix', () => {
  const h = shared('handoff.md');
  says(h, ['"There is no work for a session; tell me what to do."']);
  says(h, ['There are unfinished tasks', '/keel:tasks shows them', '/keel:start-task continues one', 'Never start a task yourself']);
  says(h, ['`lane: task`', 'Tasks use /keel:start-task', 'better continue it there', 'and stop']);
  says(h, ['put the key', '`key from the link:`', "note's `keys`"]);
  assert.match(read('templates', 'keel', 'next-session.md'), /^keys: /m);
});

test('end-session: the instruction picks verification, prepare only, or an action after preparing', () => {
  const text = skill('end-session');
  says(text, ['none → verification', 'prepare the next session', '"Next time: ..."']);
  says(text, ['prepare only', 'gates only, then prepare']);
  says(text, ['an action', 'verification, prepare, then the action']);
  says(text, ['update, do not rewrite']);
});

test('one final report for both lanes: done, verification table, git, what next, costs', () => {
  const r = shared('final-report.md');
  const order = ['**Done**', '**Verification**', '**Git**', '**What next**', '**Costs**'].map((b) => r.indexOf(b));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `blocks in order: ${order}`);
  says(r, ['| severity | found | fixed | left |']);
  says(r, ['Only gates ran (or no verification) → no table']);
  says(r, ['"Next time: <the note\'s next action>"', '"Agree, or change it?"']);
  for (const name of ['end-task', 'end-session']) says(skill(name), ['_shared/final-report.md'], name);
});

test('one handoff format: sections, update not rewrite, the selection rule, 150 lines and how to compress', () => {
  const h = shared('handoff.md');
  const f = h.slice(h.indexOf('## The handoff format'), h.indexOf('## Write the note'));
  assert.match(f, /\*\*Goal\*\*, \*\*Next action\*\*[\s\S]*\*\*State\*\* \(✅ done and\s+verified \/ ◐ in progress \/ ⚠ broken \/ ⬜ not started[\s\S]*\*\*Files\*\* \(changed \/ important\s+read \/ next\)/);
  says(f, ['**Update, do not rewrite**']);
  says(f, ['Keep a sentence only if without it', 'next session would act differently']);
  says(f, ['At most 150 lines', 'done steps one line each', 'resolved questions out', 'from "Tried and did not work" only what could tempt a retry']);
  assert.doesNotMatch(h, /rewrite it;/);
  const sections = (f2) => [...read('templates', 'keel', f2).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const common = ['Goal', 'Next action', 'State', 'Files', 'Decisions and why', 'Tried and did not work', 'Open questions', 'How to check'];
  for (const f2 of ['task.md', 'next-session.md']) assert.deepEqual(sections(f2).filter((x) => common.includes(x)), common, f2);
  assert.ok(sections('next-session.md').includes('Plan') && sections('next-session.md').includes('Later'));
});

test('/keel:tasks: the approved list, and drop explains what the task left and confirms each removal', () => {
  const text = skill('tasks');
  says(text, ['`<id> · <title>`, then Source, State, Next, Files']);
  says(text, ['conversation language']);
  says(text, ['task inventory <id>`']);
  says(text, ['Ask what to remove', 'each destructive action on its own', 'the folder first', 'Claude Code itself asks the user to confirm']);
  assert.match(text, /delete-branch --name <branch>`, with\s+`--remote` when it was pushed/);
});

// --- review fixes: lane guards, endings, git defaults, one wording per rule ---

test('lane guards: end-task sends a session conversation to end-session and back', () => {
  says(skill('end-task'), ['ran `/keel:start-session`', 'the note is not `done`', 'This conversation leads a long-work line', 'end it with /keel:end-session']);
  says(skill('end-session'), ['`active task:` is not `none`', 'ran `/keel:start-task`', 'This conversation works on a task', 'end it with /keel:end-task']);
  assert.match(skill('end-session'), /check --session <sid>/);
});

test('end-task: a task on another branch is switched to first; no task at all offers one or a plain verification', () => {
  const text = skill('end-task');
  assert.ok(text.indexOf('switch --name <branch>') < text.indexOf('task activate <id>'), 'switch, then activate');
  assert.match(text, /without a\s+remote prefix: `origin\/x` → `x`/);
  says(text, ['No task at all → offer', 'create one from what this conversation did', 'task new <id>', 'or verify without a task file']);
  says(text, ['after any `start` of git.md', 'or one git.md makes', "set the task file's `branch:`", 'the `branch:` that `start` printed', 'manual git: to that new branch', 'before the commit'], 'a branch git.md made also reaches the task file');
  says(text, ['add `--finish <id> --session <sid>` to every `start`, `commit`, `sync` and `push`', 'A step that stops puts the task back by itself'], 'git stopped after the deletion: git-flow itself puts the task back');
});

test('end-task reads only the sections it needs and leaves the What next wording to final-report.md', () => {
  const text = skill('end-task');
  says(text, ['read only that section; its language rule too']);
  assert.doesNotMatch(text, /intake\.md/, 'end-task never reads intake.md');
  assert.doesNotMatch(text, /\/clear|continue any time/);
  assert.doesNotMatch(text, /never ask which\s+git steps/, 'git.md says it once');
  const h = shared('handoff.md');
  const format = h.slice(h.indexOf('## The handoff format'), h.indexOf('## Write the note'));
  says(format, ['**Language**', "A task's task.md and a plan.md in its folder", '`repo_language` when `tasks.in_git` is not false']);
  says(format, ['Never passwords, keys, tokens']);
  assert.match(shared('intake.md'), /follow handoff\.md\s+"The handoff format"/);
});

test('level words count only alone or after "level"; prepare only is gates only without a question', () => {
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /standing alone or\s+after "level"/, name);
  assert.match(skill('end-task'), /a menu choice is not a\s+level/);
  says(skill('end-session'), ['Prepare only: gates only, no question', 'Otherwise, without a level']);
});

test('only the command instruction gives a level; one from a brief or the note is only advice', () => {
  says(shared('verify.md'), ['A level found anywhere else', "is not the user's choice", 'it is only advice', 'recommended option', 'you still ask']);
  const sources = /A level found anywhere else \(([^)]*)\)/.exec(shared('verify.md'))[1];
  for (const source of ['the start prompt', 'memory', 'an earlier message', 'the level used last time']) {
    assert.match(sources, new RegExp(source.replace(/ /g, '\\s+')), source);
  }
  for (const name of ['end-task', 'end-session']) {
    assert.match(skill(name), /a level from a brief, the note or memory is only\s+advice/, name);
  }
});

test('git.md: default steps per ending in one table; branches are deleted only by /keel:tasks drop', () => {
  const git = shared('git.md');
  // The one question left above the steps is the merge one; no branch question remains.
  says(git, ['Never ask which git steps to take', 'except the merge question above', 'the instruction only adds or changes steps']);
  assert.doesNotMatch(git, /branch question/);
  says(git, ['**Unfinished work never stays on this machine only**']);
  // The only way out of the automatic commit and push.
  says(git, ['The user\'s own instruction (e.g. "do not commit") wins']);
  const noBranch = part(git, '**A task handoff without its own branch**', 'A planned ticket on its feature branch');
  says(noBranch, ['no question', 'a new branch `<id>-<short-name>` from here', '`start --name <it>`', 'commit and push there', 'back on `<current>`']);
  says(noBranch, ['Say it in one line, naming the new branch']);
  assert.doesNotMatch(git, /no commit: the changes stay uncommitted|commit and push to the current branch|git stash/);
  const message = part(git, '## Commit message', '## Manual mode');
  says(message, ["**task handoff** commit's subject", '"Work in progress: <title>"', 'task id first', 'tracker key', 'within 72 characters']);
  says(part(git, '3. **Handoff**', '4. `sync'), ['refused → say so', 'on this machine only', 'does not stop the handoff']);
  const manual = part(git, '## Manual mode', '## Autonomous mode');
  says(manual, ['**handoff of a task**', 'commit the work and the task folder', 'on the task branch', 'push it', '`git switch <base>`']);
  // Manual git runs no `start`, so the task file learns the new branch here, before its commit.
  says(manual, ['A task without its own branch', '`git switch -c <id>-<short-name>`']);
  says(manual, ["set the task file's `branch:` to that new branch", 'before the task file is written']);
  says(skill('end-task'), ['On a hand off', 'after any `start` of git.md', '(manual git: to that new branch)', 'before the commit']);
  says(shared('handoff.md'), ['a task handoff without its own branch', 'the new branch git.md makes']);
  assert.doesNotMatch(shared('handoff.md'), /stash/);
  // The docs describe no handoff question any more.
  const docs = ['overview.md', 'under-the-hood.md', 'workflows.md'].map((f) => fs.readFileSync(path.join(PLUGIN, '..', '..', 'docs', f), 'utf8')).join('\n');
  assert.doesNotMatch(docs, /first asks where the work goes|answer\s+to a handoff without|a handoff without\s+the task's own branch, each step/);
  assert.doesNotMatch(read('templates', 'keel', 'task.md'), /stash/i);
  says(git, ['| finish (task or session) | commit, sync, push;']);
  says(git, ['| task handoff | commit, push, switch to the base branch |']);
  says(git, ['| session handoff or prepare | commit, push; no sync |']);
  says(git, ['3. **Handoff**', '`push`', 'A task: then `switch --name <base>`', 'Done, skip the rest'], 'a session handoff does not sync either');
  says(git, ['delete branches', 'only `/keel:tasks drop` does', '`git-flow.js delete-branch`', 'Claude Code confirms']);
  assert.match(skill('tasks'), /the user also\s+removes that branch → no commit/);
});

test('start-session never uses task wording; plan.md has task and session Execution steps', () => {
  const h = shared('handoff.md');
  says(h, ['from step 3 only the retell and the premise check', 'no "new or continuation"', 'never a task']);
  says(h, ['| no note (or `status: done`), no instruction |']);
  says(h, ['a note (not `done`)', 'is about a different line of work', 'Continue the written line or start a new one?']);
  says(h, ['`lane: conflict`', 'show its lines', 'ask which lane leads it and stop']);
  const exec = read('templates', 'keel', 'plan.md').slice(read('templates', 'keel', 'plan.md').indexOf('## Execution'));
  says(exec, ['<task> Run `node "<keel>/scripts/notes.js" "<project>" task new']);
  says(exec, ['<session> Write `.keel/next-session.md`', 'never a task file']);
  says(exec, ['<session> `/keel:end-session`']);
});

test('the lane choice rule is said in both start paths; start-task asks one question per decision', () => {
  const rule = ['in 1-3 sittings → a task', '"later" items → a session'];
  says(shared('intake.md'), rule);
  says(shared('handoff.md'), rule);
  const intake = shared('intake.md');
  says(intake, ['`lane: task` for the given key', 'one question', 'This is the unfinished task <id>: continue it?']);
  says(intake, ['not when `lane: task` names it: step 3 asks once']);
  says(intake, ['proposes its name (step 4) inside that one question', 'always ends with a question mark', 'Right, or change the name?', 'A statement without the question does not settle it']);
  says(intake, ['`lane: conflict`', 'show its lines', 'ask which lane leads it and stop']);
  const resume = intake.slice(intake.indexOf('## Resume'));
  says(resume, ["The branch: the task's `branch`", '`State: ... branch <name>`', 'else the one in `Files: (on branch ...)`', 'without a remote prefix']);
});

test('one wording each: the here-or-delegate question comes from plan-steps.js, the plain-command rule from preflight.md', () => {
  for (const f of ['intake.md', 'handoff.md']) {
    says(shared(f), ['its `ask:` line'], f);
    assert.doesNotMatch(shared(f), /Here or delegate to implementers\?|Do it here or delegate to implementers/, f);
  }
  says(shared('preflight.md'), ['as its own plain command']);
  for (const f of ['verify.md', 'delegate.md', 'usage-sync.md']) {
    says(shared(f), ['preflight.md'], f);
    assert.doesNotMatch(shared(f), /no variables, pipes|no `cd`, `;`, `&&` or shell variables/, f);
  }
});

test('merging: only on the instruction, or on a finish with ask_before_merge false; Claude Code confirms each merge', () => {
  const flow = shared('configure-flow.md');
  assert.doesNotMatch(flow, /merge X into Y/);
  says(flow, ['Claude Code asks you to confirm each such merge']);
  says(read('skills', 'git', 'SKILL.md'), ["merges only when the user's instruction asks", 'on a finish', '`ask_before_merge` is false']);
  says(shared('git.md'), ['Claude Code confirms each merge', 'keel was told to do', '`git.ask_before_merge` is false', 'confirmed autonomous mode']);
});

test('configure: explains each question group first, one decision per question, every option offered', () => {
  const flow = shared('configure-flow.md');
  says(flow, ['**Explain before you ask**', 'in quick setup too', 'all questions go in one message', 'Before each group of questions']);
  for (const label of ['**What it is:**', '**What it changes:**', '**Example:**', '**Change later:**']) assert.ok(flow.includes(label), label);
  says(flow, ['also when all questions go in one message']);
  says(flow, ['**One decision per question.**', 'never one question whose options combine two decisions']);
  says(flow, ['a recommendation never removes the other options']);
  const quick = flow.slice(flow.indexOf('**Quick or detailed**'), flow.indexOf('Read the check output'));
  assert.doesNotMatch(quick, /in one question/, 'no merged questions in quick setup');
  says(quick, ['4 Git | asked', 'mode (both modes offered)', 'main branch', 'two questions in one call']);
  says(quick, ['yes to all / choose one by one']);
  assert.match(flow, /Its own\s+question with both modes as options/);
});

test('configure: the instruction audit is advised only when other instructions exist, with why and the effect', () => {
  const flow = shared('configure-flow.md');
  const step = flow.slice(flow.indexOf('**Instruction check, only when it is worth it**'));
  assert.ok(step.length > 100, 'the step exists');
  says(step, ['`other instructions:` line of the scan (section 2)']);
  says(step, ['`audit: advise`', '`audit: not needed`', 'say nothing about it', 'not even that it is not needed']);
  for (const part of ['- **Why:**', '- **What it does:**', '- **The effect:**', '- **How:**']) assert.ok(step.includes(part), part);
  says(step, ['type `/doctor prompt-audit` in a new conversation']);
  says(step, ['not keel\'s rules']);
});

test('configure: the first question is always project or machine; optional sections may be skipped; the setup is committed', () => {
  const flow = shared('configure-flow.md');
  assert.ok(flow.indexOf('**The first question, always**') < flow.indexOf('## Ground rules'), 'the first line of the flow');
  says(flow, ['**Quick** setup (section 0)', 'asks only the questions that need the user']);
  const quick = flow.slice(flow.indexOf('**Quick or detailed**'), flow.indexOf('Read the check output'));
  for (const asked of ['1 Languages | asked', '3 Gates | asked', '4 Git | asked', '10 Claude Code settings | asked', '11 Usage and costs | asked']) assert.ok(quick.includes(asked), asked);
  says(flow, ['After a quick setup', 'every value that was not asked', 'the section that changes it']);
  const steps = flow.slice(flow.indexOf('## 12. Write and summary')).match(/^\d+\./gm);
  assert.deepEqual(steps, ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'], 'no duplicate step numbers');
  says(flow, ['**Commit the setup** (project mode)', "keel's git steps never commit on the main branch", 'the user runs them']);
  says(flow, ['first `/keel:start-task` offers to take them', "that task's branch"]);
  says(shared('intake.md'), ["take the setup into this task's branch", "reaches the main branch with the task's merge"]);
});

test('configure: no lock-file audit without a lock file, quick setup never promises missing scanners, origin/HEAD is not the remote', () => {
  const flow = shared('configure-flow.md');
  says(flow, ['An audit that reads the lock file', 'proposed for an ecosystem the scan names', '`(no lock file: <ecosystems>)`', 'other ecosystems keep theirs', '`ENOLOCK`']);
  says(flow, ['Quick setup keeps only the installed ones', 'never say there that they stay in the list']);
  says(flow, ['no `origin/HEAD`', 'never tell the user there is no remote', '`git remote`']);
});

test('autonomous git not confirmed: keel offers to run trust itself, never a command with placeholders', () => {
  says(shared('git.md'), ['offer to run', 'trust', 'on a yes run it', 'never give the user a command with `<project>`']);
});

test('configure ADR style: a project rule that already says how records are kept is the recommendation', () => {
  says(shared('configure-flow.md'), ["The project's own rules already say how its records are kept", 'recommend that style', 'the rule is theirs']);
});

test('cleanup shows the found list in its own message before it asks for numbers', () => {
  says(skill('cleanup'), ['Show the list in your message', 'does not see the script', 'before the question']);
});

test('cleanup never offers to empty old trash; the reminder line appears only when it names /keel:cleanup', () => {
  assert.doesNotMatch(skill('cleanup'), /offer `\/keel:cleanup empty-trash`/);
  says(skill('cleanup'), ['never offer it']);
  says(shared('final-report.md'), ['only when it names `/keel:cleanup`', 'any other reminder output is left out']);
  for (const name of ['end-task', 'end-session']) says(skill(name), ['its line goes into the report', 'only when it names `/keel:cleanup`'], name);
});

test('tasks drop: manual git gets the commands; an old handed-off task is offered drop or start then end; restore names the batch', () => {
  const t = skill('tasks');
  says(t, ['Manual git mode: keel runs none of the git commands above']);
  assert.match(t, /offer\s+`\/keel:tasks drop <id>`, or `\/keel:start-task <id>` then `\/keel:end-task`/);
  says(t, ['`/keel:cleanup restore <batch>` brings it back', '`trash batch:`']);
  // No keel trace in the project's history, and no key: a commit with a ticket key reads as work on it.
  says(t, ['`git-flow.js commit`', '"Remove the notes of a dropped task"', 'no "keel", no id']);
  assert.doesNotMatch(t, /keel: drop/);
  for (const f of ['git.md', 'intake.md', 'handoff.md', 'planning.md']) assert.doesNotMatch(shared(f), /message "keel:|commit -m "keel:/, `${f}: no keel commit message`);
});

test('handoff notes: where the work is says only what is certain before git; files and tried-and-failed rules', () => {
  const h = shared('handoff.md');
  says(h, ['Never a push or merge result']);
  says(h, ['Tests counted as "N new, M total"']);
  says(h, ['what the user rejected', 'what turned out wrong during the work']);
  says(h, ['`lane: none (task <id> was finished or dropped earlier)`', 'ask whether to start it as a new line']);
  says(shared('intake.md'), ['`lane: none (task <id> was finished or dropped earlier)`', 'ask whether to start it as a new task']);
});

test('planning: the step table is checked inside Plan Mode and approved once; plan.md points to the full task.md list', () => {
  const intake = shared('intake.md');
  says(intake, ['Still in Plan Mode', 'check its steps', 'ExitPlanMode once']);
  says(intake, ['No separate question after ExitPlanMode']);
  assert.match(intake, /come first, only when step 2 needs\s+a branch switch/);
  says(read('templates', 'keel', 'plan.md'), ['intake.md` "7. Execution" item 2', 'lists (every front-matter field and section)']);
  assert.match(shared('usage-sync.md'), /final-report\.md` block Costs says/);
  assert.doesNotMatch(shared('verify.md'), /\| gates red before the change \|/, 'the trouble table repeats no step');
});

test('shipped files point to no unshipped plan or decision documents', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(PLUGIN).filter((f) => /\.(js|md|json)$/.test(f))) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /KEEL-PLAN|\bphase [0-9]\b|\bplan 1[0-9]\.|DECISIONS|\bD[0-9]{2}\b|memory docs/, path.relative(PLUGIN, file));
  }
});

// --- endings: git after a stop, the cost report last, every finish recorded ---

test('git.md: a handoff that asks to merge merges before switching to the base branch', () => {
  const git = shared('git.md');
  const step3 = git.slice(git.indexOf('3. **Handoff**'), git.indexOf('4. `sync'));
  says(step3, ['The instruction asks to merge', 'step 6 now', 'still on this branch']);
  assert.ok(step3.indexOf('step 6 now') < step3.indexOf('switch --name <base>'), 'merge first: on the base branch merge would stop');
  says(git, ['6. **Merge** (a handoff comes here from step 3)']);
});

test('git.md: in a finish a sync conflict comes after the commit that holds the removal, so nothing is put back', () => {
  const sync = shared('git.md').slice(shared('git.md').indexOf('4. `sync'), shared('git.md').indexOf('5. `push`'));
  says(sync, ['`conflict` → show the files', 'In a finish the commit of step 2 already holds', "the task's removal", 'nothing is put back']);
  says(sync, ['after the resolve commit the finish goes on with the push', 'Offer: resolve together now']);
});

test('git.md: red gates after a sync offer a fix or putting the task back, never a silent stop', () => {
  const sync = shared('git.md').slice(shared('git.md').indexOf('4. `sync'), shared('git.md').indexOf('5. `push`'));
  says(sync, ['`merged N new commits`', 'red → show them', 'no push while they are red', 'Offer: fix them now', 'or stop']);
  says(sync, ["With `--finish` the task's removal is committed but not pushed", '"stop" puts the task back', 'node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>']);
});

test('the cost report runs last and is pasted whole: the only cost numbers in the final report', () => {
  const sync = shared('usage-sync.md');
  // Changed on purpose: reading the other machines' data is part of the sync step now, so the sync is steps 1-3 and the report step 4.
  // Changed on purpose: the sync runs in a small Haiku agent the end command starts, which costs a fraction of doing it in the session.
  says(sync, ['4. **Not now: last, right before you write the final report**']);
  for (const name of ['end-task', 'end-session']) {
    const text = skill(name);
    says(text, ['start its sync agent (steps 1-3)'], name);
    says(text, ['Report: run usage-sync.md step 4 (the cost report), then read'], name);
    assert.ok(text.indexOf('run usage-sync.md step 4') > text.indexOf('git.md'), `${name}: the report runs after git`);
  }
  const costs = shared('final-report.md').slice(shared('final-report.md').indexOf('**Costs**'));
  says(costs, ['The user does not see tool output', 'paste its text into this message']);
  says(costs, ['Never "see above" and never leave it out']);
  assert.match(costs, /These are the only cost numbers in the\s+report/);
  assert.doesNotMatch(shared('verify.md'), /ledger-report\.js/, 'no second cost total from the verification');
});

test('verify.md: nothing to verify still records the verification; re-checks cover must and should fixes', () => {
  const text = shared('verify.md');
  says(text, ['`proposal: none`', 'nothing to verify', 'node "<keel>/scripts/fingerprint.js" "<project>" save --tier none']);
  says(text, ['For each fixed must or should item', 'critical or important', 'nice items need no re-check']);
  assert.doesNotMatch(text, /fixed critical or important item/);
});

test('final report: a finished task names its trash batch and the restore command', () => {
  says(shared('final-report.md'), ['batch <id from the `trash batch:` line of `task delete`>', '`/keel:cleanup restore <that id>` brings it back']);
});

test('preflight: a missing or invalid project scan is said in one line with the re-scan offer', () => {
  says(shared('preflight.md'), ['`profile: missing` or `invalid` → say in one line', 'offer the same re-scan after the command; do not block']);
});

test('start-session: a new line while a note is open asks what happens to the old Plan and Later first', () => {
  const row = shared('handoff.md').split('\n').find((l) => l.includes('Continue the written line or start a new one?'));
  says(row, ['New → there is one note, so ask next', 'finish the old line', 'keep its open Plan steps and Later items', "the new note's **Later**"]);
  says(row, ['Write the new note only after this answer']);
});

test('start-task: any other page link is a text source with its link; task files are translated into their language', () => {
  const intake = shared('intake.md');
  says(intake, ['any other page or document link', '`--source text --link <url>`']);
  says(intake, ['translate the retell and the plan when writing the files']);
});

test('migration: the old note keeps its facts in repo_language; a standalone run writes and checks the config; an outside apply still reaches the secrets step', () => {
  const m = shared('migrate.md');
  assert.doesNotMatch(m, /old note's text unchanged/);
  says(m, ['its facts unchanged', 'translated into `repo_language`']);
  const eight = m.slice(m.indexOf('## 8.'), m.indexOf('## 9.'));
  says(eight, ['write the config change from step 4 into `.keel/config.json`', 'node "<keel>/scripts/check-config.js" "<project>"', 'fix it until it says `keel-config: ok`']);
  const seven = m.slice(m.indexOf('## 7.'), m.indexOf('## 8.'));
  says(seven, ['migrate.js" "<project>" state`', '`possible secrets in moved text`', "stand for apply's output", 'go on with step 8', 'step 10 is never skipped']);
});

test('configure: a chosen docs pattern the docs do not follow yet is offered as its own first task, with an estimate', () => {
  const flow = shared('configure-flow.md');
  assert.match(flow, /\*\*Moving the existing docs\*\*[\s\S]*your docs already follow it; nothing to move/);
  says(flow, ['give the cost as an **estimate** and how it was made']);
  says(flow, ['write `<project>/.keel/local/docs-migration.md`']);
  says(flow, ['First run `/keel:start-task .keel/local/docs-migration.md`']);
  says(flow, ['Quick setup takes the suggested profile and pattern', 'keel keeps the docs the way they are']);
});

test('every text about costs says what an API-key-only session gets: exact dollars, no usage page', () => {
  const flow = shared('configure-flow.md');
  const texts = {
    'configure-flow.md 11': flow.slice(flow.indexOf('## 11. Usage and costs'), flow.indexOf('## 12.')),
    'usage-page.md': shared('usage-page.md'),
    'final-report.md': shared('final-report.md'),
    usage: skill('usage'),
    help: skill('help'),
  };
  for (const [name, text] of Object.entries(texts)) {
    assert.match(text, /API key/, name);
    says(text, ['exact dollars'], name);
    assert.match(text, /no usage page|no page|cannot reach (it|the page)|has no access to the page/, name);
  }
  // Where the account types are listed, all three are there.
  for (const name of ['configure-flow.md 11', 'final-report.md']) {
    assert.match(texts[name], /API key only/, name);
    assert.match(texts[name], /subscription/, name);
    assert.match(texts[name], /both/, name);
  }
});

test('the main usage docs tell the three account cases: exact dollars, no usage page with an API key only', () => {
  const texts = {
    'README.md': fs.readFileSync(path.join(PLUGIN, '..', '..', 'README.md'), 'utf8'),
    'usage-dashboard.md': fs.readFileSync(path.join(PLUGIN, '..', '..', 'docs', 'usage-dashboard.md'), 'utf8'),
  };
  for (const [name, text] of Object.entries(texts)) {
    assert.match(text, /API key/, name);
    assert.match(text, /exact dollars|exact with an API key/, name);
    assert.match(text, /no usage page|no page/, name);
  }
  const dash = texts['usage-dashboard.md'];
  says(dash, ['| API key only |']);
  says(dash, ['| subscription only |']);
  assert.match(dash, /\| both \|/);
});
