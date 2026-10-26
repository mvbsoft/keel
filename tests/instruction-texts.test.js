'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const frontmatter = (text) => (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';

test('end-session is the long-work lane only: the note, never the task files', () => {
  const text = read('skills', 'end-session', 'SKILL.md');
  assert.doesNotMatch(text, /current-task|clear-task|task finish|\.keel\/tasks/);
  assert.match(text, /Task files are not part of this lane/);
  assert.match(text, /\*\*Later\*\*/);
  const handoff = read('skills', '_shared', 'handoff.md');
  assert.doesNotMatch(handoff, /current-task|\.keel\/tasks\/|task finish/);
  assert.match(handoff, /never the task files/);
  assert.match(handoff, /Tasks use \/keel:start-task/, 'a task id or ticket as the argument points to the other lane');
  assert.match(handoff, /\*\*Later\*\*[\s\S]*propose the next 1-3/, 'a finished Plan proposes the next items from Later');
});

test('the note carries merge_into and execution, handoff and git read them from the note or the task file', () => {
  const note = frontmatter(read('templates', 'keel', 'next-session.md'));
  for (const key of ['base', 'merge_into', 'execution']) assert.match(note, new RegExp(`^${key}:`, 'm'), key);
  assert.match(read('skills', '_shared', 'handoff.md'), /`branch`, `base`, `merge_into` and `execution`/);
  assert.match(read('skills', '_shared', 'git.md'), /`base` and `merge_into` of the task file \(end-task\), else of the note \(end-session\)/);
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
  assert.match(intake, /A long-work line is open here/, 'start-task while a session line is open');
  assert.match(read('skills', '_shared', 'handoff.md'), /A task is active in this session/, 'start-session while a task is active');
  const before = intake.slice(intake.indexOf('## Before any branch change'));
  assert.match(before, /git-flow\.js" "<project>" status/);
  assert.match(before, /`changed files:` not 0 → stop and offer/);
  assert.match(before, /git stash push -m "keel: <id>"/);
  assert.match(before, /Never carry changes into another task/);
  const resume = intake.slice(intake.indexOf('## Resume'), intake.indexOf('## Before any branch change'));
  assert.ok(resume.indexOf('Uncommitted changes') < resume.indexOf('switch --name'), 'changes are dealt with before the switch');
  assert.match(resume, /`Base moved:`/);
  assert.match(resume, /git-flow\.js sync --from <base>/);
  assert.match(resume, /read the source again[\s\S]*Do not overwrite them without a yes/);
  assert.ok(intake.indexOf('git-flow.js" "<project>" start --name') < intake.indexOf('task new <id>'), 'the branch is made first, then the task file is written');
});

test('end-task verifies a resumed task as a whole: the base is its base branch, the session start only without a task branch', () => {
  const text = read('skills', 'end-task', 'SKILL.md');
  assert.match(text, /when it has its own branch[\s\S]*step 1 uses `--base <the task's base branch>`[\s\S]*earlier sessions are\s+covered/);
  assert.ok(text.indexOf("`--base <the task's base branch>`") < text.indexOf('`--base <that commit>`'));
  assert.match(text, /only without a task branch \(manual git on the main branch\)/);
  assert.match(read('skills', '_shared', 'verify.md'), /git takes the merge base, so a branch name covers its whole work/);
});

test('end-task: a handoff never stops on red gates and records them in the task file', () => {
  const text = read('skills', 'end-task', 'SKILL.md');
  // The section is "Open questions" now: one handoff format for tasks and sessions.
  assert.match(text, /A handoff never stops on red gates: write\s+`gates failing: <which>` under the task's "Open questions"/);
});

test('verify.md: comments are settled before the overview, one base, level list and step numbers are right', () => {
  const text = read('skills', '_shared', 'verify.md');
  assert.ok(text.indexOf('comments.js') < text.indexOf('changes.js" "<project>" --start'), 'the diff is written after the comment edits');
  assert.equal((text.match(/comments\.js/g) || []).length, 1);
  assert.doesNotMatch(text, /--base <main branch>/);
  assert.match(text, /Maximum \/ No verification/);
  assert.doesNotMatch(text, /step 13/);
  assert.match(text, /for `qa-break`: the test commands and the path of QA's saved reply in/);
  assert.match(text, /for `test-reviewer`: the test commands/);
  assert.match(text, /for topic\s+`comments`: the long comments you kept in step 1/);
});

test('test-reviewer reverts with plain git commands only, no copying or redirection', () => {
  const text = read('agents', 'test-reviewer.md');
  assert.match(text, /git diff --binary <base> --output=/);
  assert.match(text, /git apply -R/);
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

const skill = (name) => read('skills', name, 'SKILL.md');
const shared = (name) => read('skills', '_shared', name);

test('no keyword arguments: the four lane commands take a free-text instruction', () => {
  for (const name of ['start-task', 'end-task', 'start-session', 'end-session']) {
    const text = skill(name);
    assert.match(text, /The user's instruction \(arguments, free text\): `\$ARGUMENTS`/, name);
    assert.doesNotMatch(frontmatter(text), /\[handoff\]|\[done\]|\| continue>/, `${name}: no keyword in the argument hint`);
  }
  assert.doesNotMatch(skill('end-session'), /`done`/, 'end-session has no done word');
  assert.doesNotMatch(skill('end-task'), /`handoff`/, 'end-task has no handoff word');
  assert.match(shared('preflight.md'), /Before each action \(a\s+script, a git step, a file change, an agent\), say in one short line what it is and what it will do/);
  assert.match(shared('preflight.md'), /ask, never guess/);
});

test('start-task: a link is read from outside, anything else is searched inside; #123 reads nothing by itself', () => {
  const intake = shared('intake.md');
  const source = intake.slice(intake.indexOf('## 2. Source'), intake.indexOf('## 3.'));
  assert.match(source, /a link \(any URL[^|]*\| \*\*external\*\*: read it with the matching connector tool[\s\S]*`gh issue view[\s\S]*WebFetch/);
  assert.match(source, /\*\*internal search\*\*: keel's tasks first[\s\S]*then the repository/);
  assert.match(source, /"Is this it\?"/);
  assert.match(source, /`#123` alone never reads a GitHub issue/);
  assert.match(source, /ask the user to paste the text/);
  assert.match(source, /notes\.js" "<project>" lane <key or link>`[\s\S]*`lane: session` → say "This is led by \/keel:start-session/);
  assert.doesNotMatch(intake, /screenshot/i, 'screenshots are not promised');
});

test('start-task: retell, always "new or continuation", the system proposes id, title and description', () => {
  const intake = shared('intake.md');
  const retell = intake.slice(intake.indexOf('## 3. Retell'), intake.indexOf('## 4.'));
  assert.match(retell, /Always settle "new or continuation"/);
  assert.match(retell, /"Is this a continuation of <id>, or a new task\?"/);
  assert.match(retell, /"No unfinished tasks, so this is a new one\. Right\?"/);
  assert.match(retell, /\*\*Check the premise\*\*/);
  const name = intake.slice(intake.indexOf('## 4. Name'), intake.indexOf('## 5.'));
  assert.match(name, /`fix-reset-500`/);
  // The name is asked inside the one "new?" question (a live eval run stated it without asking).
  assert.match(name, /\*\*title\*\*[\s\S]*\*\*one-line description\*\*, in the step 3\s+question/);
  const resume = intake.slice(intake.indexOf('## Resume'));
  assert.match(resume, /7 days ago or more/);
  assert.match(resume, /Run the "How to check" command once/);
  assert.match(resume, /Summary in 3-6 lines/);
  assert.ok(resume.indexOf('switch --name') < resume.indexOf('task activate') && resume.indexOf('task activate') < resume.indexOf('How to check'), 'switch, read, staleness, check, summary');
});

test('brainstorm only with a yes: why and how, options, 2-3 approaches, plan in parts, no code before approval', () => {
  const intake = shared('intake.md');
  const b = intake.slice(intake.indexOf('**Brainstorm, only with a yes.**'), intake.indexOf('**Questions**'));
  for (const re of [/AskUserQuestion/, /1-3 per message/, /2-3 approaches with your recommendation/, /the\s+plan in parts, each approved/, /no code before the plan is approved/, /contradictions/, /split first/, /"Turn it on\?"\. No → the\s+ordinary path/]) assert.match(b, re);
  assert.match(shared('handoff.md'), /intake\.md` steps 3, 5 and 6 \(retell, the brainstorm offer or questions, plan\)/, 'start-session offers it for a description too');
});

test('end-task: a menu without an instruction; finish asks before the script deletes the folder; hand off runs gates only', () => {
  const text = skill('end-task');
  assert.match(text, /No instruction → ask[\s\S]*1\) finish fully[\s\S]*2\) hand off[\s\S]*3\) your own instruction/);
  assert.match(text, /Ambiguous \(e\.g\. only "push": finish or hand off\?\) → ask, never guess/);
  // Claude Code itself confirms the folder (keel's hook asks), so the chat does not ask it again.
  assert.match(text, /do not ask "fully done\?" in the chat: Claude Code itself asks it when step 7 runs\s+`task delete`/);
  assert.match(text, /"Claude Code will now ask you to confirm: the task is done and its\s+folder `<folder>` goes to keel's trash\."/);
  assert.match(text, /A clear instruction does not ask WHAT to do \(it still\s+asks the level when none is given, and Claude Code still confirms the folder in step 7\)/);
  assert.match(text, /verify without a task file \(a hand off needs the\s+file; without one, skip the step 7 deletion\)/);
  assert.match(text, /none \(no verification\)/);
  assert.match(text, /Manual: keel runs no git, so the report gives the commit command that includes the deletion; when\s+the user says they did not commit \(or will not\), run\s+`node "<keel>\/scripts\/notes\.js" "<project>" task restore <id> --session <sid>`/);
  assert.match(text, /The user declines \(a non-interactive run denies it\): that is the user's "no"\. Never run it again\s+or another way\. The task stays as it is \(active, on its branch\): skip steps\s+8 and 9/, 'no: no git, no deactivate');
  assert.match(text, /\*\*Hand off\*\*: gates only, no agents: read only the\s+sections "1\. Overview of the change", "2\. Gates" and "12\. Result" of verify\.md/);
  for (const h of ['## 1. Overview of the change', '## 2. Gates', '## 12. Result']) assert.ok(shared('verify.md').includes(h), h);
  assert.match(text, /actions \("create branch bug\/FIX-123, push, merge into main"\) run in step 8, after\s+verification/);
  assert.doesNotMatch(text, /archive/);
  const git = shared('git.md');
  assert.match(git, /\*\*Merging\*\* into the main branch \(or any target\) happens only when the instruction asks for it, or in\s+a \*\*finish\*\* when `git\.ask_before_merge` is false/);
  assert.match(git, /Red verification and an instruction to push or merge → stop and ask before any git step/);
  assert.match(git, /A \*\*task handoff\*\* whose instruction asks to merge[\s\S]{0,200}"Finish\s+the task instead, or merge anyway\?"/, 'an unfinished task is not merged into the target without asking');
});

test('start-session: without an instruction it finds work or points to tasks, never starts one; lanes never mix', () => {
  const h = shared('handoff.md');
  assert.match(h, /"There is no work for a session; tell me what to do\."/);
  assert.match(h, /"There are unfinished tasks: \/keel:tasks shows them, \/keel:start-task continues one\." Never start a task yourself/);
  assert.match(h, /`lane: task` → "Tasks use \/keel:start-task: better continue it there\." and stop/);
  assert.match(h, /put the key \(`key from the link:`\) into the note's `keys`/);
  assert.match(read('templates', 'keel', 'next-session.md'), /^keys: /m);
});

test('end-session: the instruction picks verification, prepare only, or an action after preparing', () => {
  const text = skill('end-session');
  assert.match(text, /none → verification, prepare the next session, then "Next time: \.\.\."/);
  assert.match(text, /prepare only \("we continue tomorrow, prepare"\) → gates only, then prepare/);
  assert.match(text, /an action \("push", "merge into main", "open a PR"\) → verification, prepare, then the action/);
  assert.match(text, /update, do not rewrite/);
});

test('one final report for both lanes: done, verification table, git, what next, costs', () => {
  const r = shared('final-report.md');
  const order = ['**Done**', '**Verification**', '**Git**', '**What next**', '**Costs**'].map((b) => r.indexOf(b));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), `blocks in order: ${order}`);
  assert.match(r, /\| severity \| found \| fixed \| left \|/);
  assert.match(r, /Only gates ran \(or no verification\) → no table/);
  assert.match(r, /"Next time: <the note's next action>" and the question "Agree, or change it\?"/);
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /_shared\/final-report\.md/, name);
});

test('one handoff format: sections, update not rewrite, the selection rule, 150 lines and how to compress', () => {
  const h = shared('handoff.md');
  const f = h.slice(h.indexOf('## The handoff format'), h.indexOf('## Write the note'));
  assert.match(f, /\*\*Goal\*\*, \*\*Next action\*\*[\s\S]*\*\*State\*\* \(✅ done and\s+verified \/ ◐ in progress \/ ⚠ broken \/ ⬜ not started[\s\S]*\*\*Files\*\* \(changed \/ important\s+read \/ next\)/);
  assert.match(f, /\*\*Update, do not rewrite\*\*/);
  assert.match(f, /Keep a sentence only if without it the next session would act differently/);
  assert.match(f, /At most 150 lines[\s\S]*done steps one line each, resolved\s+questions out, from "Tried and did not work" only what could tempt a retry/);
  assert.doesNotMatch(h, /rewrite it;/);
  const sections = (f2) => [...read('templates', 'keel', f2).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const common = ['Goal', 'Next action', 'State', 'Files', 'Decisions and why', 'Tried and did not work', 'Open questions', 'How to check'];
  for (const f2 of ['task.md', 'next-session.md']) assert.deepEqual(sections(f2).filter((x) => common.includes(x)), common, f2);
  assert.ok(sections('next-session.md').includes('Plan') && sections('next-session.md').includes('Later'));
});

test('/keel:tasks: the approved list, and drop explains what the task left and confirms each removal', () => {
  const text = skill('tasks');
  assert.match(text, /`<id> · <title>`, then Source, State, Next, Files/);
  assert.match(text, /conversation language/);
  assert.match(text, /task inventory <id>`/);
  assert.match(text, /Ask what to remove: everything or which parts\. Then each\s+destructive action on its own, the folder first\. Claude Code itself asks the user to confirm the\s+folder and the branch/);
  assert.match(text, /delete-branch --name <branch>`, with\s+`--remote` when it was pushed/);
});

// --- review fixes: lane guards, endings, git defaults, one wording per rule ---

test('lane guards: end-task sends a session conversation to end-session and back', () => {
  assert.match(skill('end-task'), /ran `\/keel:start-session` and the note is not `done` → say "This\s+conversation leads a long-work line: end it with \/keel:end-session\." and stop/);
  assert.match(skill('end-session'), /`active task:` is not `none`,\s+or this conversation ran `\/keel:start-task` → say "This conversation works on a task: end it with\s+\/keel:end-task\." and stop/);
  assert.match(skill('end-session'), /check --session <sid>/);
});

test('end-task: a task on another branch is switched to first; no task at all offers one or a plain verification', () => {
  const text = skill('end-task');
  assert.ok(text.indexOf('switch --name <branch>') < text.indexOf('task activate <id>'), 'switch, then activate');
  assert.match(text, /without a\s+remote prefix: `origin\/x` → `x`/);
  assert.match(text, /No task at all → offer: create one from what this conversation did[\s\S]*task new <id>[\s\S]*or verify without a task file/);
  assert.match(text, /after any `start` of git\.md \(a branch the instruction names\s+or one git\.md makes\) → set the task file's `branch:` to the `branch:` that `start` printed, before\s+the commit/, 'a branch git.md made also reaches the task file');
  assert.match(text, /add `--finish <id> --session <sid>` to every `start`, `commit`,\s+`sync` and `push`\. A step that stops puts the task back by itself/, 'git stopped after the deletion: git-flow itself puts the task back');
});

test('end-task reads only the sections it needs and leaves the What next wording to final-report.md', () => {
  const text = skill('end-task');
  assert.match(text, /read only that section; its language rule too/);
  assert.doesNotMatch(text, /intake\.md/, 'end-task never reads intake.md');
  assert.doesNotMatch(text, /\/clear|continue any time/);
  assert.doesNotMatch(text, /never ask which\s+git steps/, 'git.md says it once');
  const h = shared('handoff.md');
  const format = h.slice(h.indexOf('## The handoff format'), h.indexOf('## Write the note'));
  assert.match(format, /\*\*Language\*\*: the note, `repo_language`\. A task's task\.md and a plan\.md in its folder:\s+`repo_language` when `tasks\.in_git` is not false/);
  assert.match(format, /Never passwords, keys, tokens/);
  assert.match(shared('intake.md'), /follow handoff\.md\s+"The handoff format"/);
});

test('level words count only alone or after "level"; prepare only is gates only without a question', () => {
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /standing alone or\s+after "level"/, name);
  assert.match(skill('end-task'), /a menu choice is not a\s+level/);
  assert.match(skill('end-session'), /Prepare only: gates only, no question\. Otherwise, without a level/);
});

test('git.md: default steps per ending in one table; branches are deleted only by /keel:tasks drop', () => {
  const git = shared('git.md');
  assert.match(git, /Never ask which git\s+steps to take \(except the question above\): the instruction only adds or changes steps/);
  assert.match(git, /\*\*A task handoff without its own branch\*\*[\s\S]*a new branch `<id>-<short-name>` from here[\s\S]*commit and push to the current branch[\s\S]*no commit: the changes stay uncommitted/);
  assert.match(git, /\| finish \(task or session\) \| commit, sync, push;/);
  assert.match(git, /\| task handoff \| commit, push, switch to the base branch \|/);
  assert.match(git, /\| session handoff or prepare \| commit, push; no sync \|/);
  assert.match(git, /3\. \*\*Handoff\*\*: `push`[\s\S]*A task: then\s+`switch --name <base>`\. Done, skip the rest/, 'a session handoff does not sync either');
  assert.match(git, /delete branches \(only `\/keel:tasks drop` does, with\s+`git-flow\.js delete-branch`, which Claude Code confirms\)/);
  assert.match(skill('tasks'), /the user also\s+removes that branch → no commit/);
});

test('start-session never uses task wording; plan.md has task and session Execution steps', () => {
  const h = shared('handoff.md');
  assert.match(h, /from step 3 only the retell and the premise check: no "new or continuation", never a task/);
  assert.match(h, /\| no note \(or `status: done`\), no instruction \|/);
  assert.match(h, /\| a note \(not `done`\), but the instruction \(a link, a description\) is about a different line of work \| ask: "Continue the written line or start a new one\?"/);
  assert.match(h, /`lane: conflict` → show its lines, ask which lane leads it and stop/);
  const exec = read('templates', 'keel', 'plan.md').slice(read('templates', 'keel', 'plan.md').indexOf('## Execution'));
  assert.match(exec, /<task> Run `node "<keel>\/scripts\/notes\.js" "<project>" task new/);
  assert.match(exec, /<session> Write `\.keel\/next-session\.md`[\s\S]*never a task file/);
  assert.match(exec, /<session> `\/keel:end-session`/);
});

test('the lane choice rule is said in both start paths; start-task asks one question per decision', () => {
  const rule = /"done" in 1-3 sittings → a task; a plan for weeks with "later" items →\s+a session/;
  assert.match(shared('intake.md'), rule);
  assert.match(shared('handoff.md'), rule);
  const intake = shared('intake.md');
  assert.match(intake, /`lane: task` for the given key → one question: "This is the unfinished task <id>: continue it\?"/);
  assert.match(intake, /not when `lane: task` names it: step 3 asks once/);
  assert.match(intake, /proposes its name \(step 4\) inside that one question, which\s+always ends with a question mark[\s\S]*Right, or change the name\?"[\s\S]*A statement without the question does not settle it/);
  assert.match(intake, /`lane: conflict` → show its lines, ask\s+which lane leads it and stop/);
  const resume = intake.slice(intake.indexOf('## Resume'));
  assert.match(resume, /The branch: the task's `branch` \(`State: \.\.\. branch <name>`\), else the one in `Files: \(on branch \.\.\.\)`;\s+without a remote prefix/);
});

test('one wording each: the here-or-delegate question comes from plan-steps.js, the plain-command rule from preflight.md', () => {
  for (const f of ['intake.md', 'handoff.md']) {
    assert.match(shared(f), /its `ask:` line/, f);
    assert.doesNotMatch(shared(f), /Here or delegate to implementers\?|Do it here or delegate to implementers/, f);
  }
  assert.match(shared('preflight.md'), /as its own plain command/);
  for (const f of ['verify.md', 'delegate.md', 'usage-sync.md']) {
    assert.match(shared(f), /preflight\.md/, f);
    assert.doesNotMatch(shared(f), /no variables, pipes|no `cd`, `;`, `&&` or shell variables/, f);
  }
});

test('merging: only on the instruction, or on a finish with ask_before_merge false; Claude Code confirms each merge', () => {
  const flow = shared('configure-flow.md');
  assert.doesNotMatch(flow, /merge X into Y/);
  assert.match(flow, /Claude Code asks you to confirm each such merge/);
  assert.match(read('skills', 'git', 'SKILL.md'), /merges only when the user's instruction asks, or on a finish when\s+`ask_before_merge` is false/);
  assert.match(shared('git.md'), /Claude Code confirms each merge keel was told to do, except when\s+`git\.ask_before_merge` is false in a confirmed autonomous mode/);
});

test('configure: explains each question group first, one decision per question, every option offered', () => {
  const flow = shared('configure-flow.md');
  assert.match(flow, /\*\*Explain before you ask\*\*, in quick setup too, and also when all questions go in one message\.\s+Before each group of questions/);
  for (const label of ['**What it is:**', '**What it changes:**', '**Example:**', '**Change later:**']) assert.ok(flow.includes(label), label);
  assert.match(flow, /also when all questions go in one message/);
  assert.match(flow, /\*\*One decision per question\.\*\*[\s\S]*never one question whose options combine two decisions/);
  assert.match(flow, /a recommendation never removes the other options/);
  const quick = flow.slice(flow.indexOf('**Quick or detailed**'), flow.indexOf('Read the check output'));
  assert.doesNotMatch(quick, /in one question/, 'no merged questions in quick setup');
  assert.match(quick, /4 Git \| asked: mode \(both modes offered\) and main branch, two questions in one call/);
  assert.match(quick, /yes to all \/ choose one by one/);
  assert.match(flow, /Its own\s+question with both modes as options/);
});

test('configure: the instruction audit is advised only when other instructions exist, with why and the effect', () => {
  const flow = shared('configure-flow.md');
  const step = flow.slice(flow.indexOf('**Instruction check, only when it is worth it**'));
  assert.ok(step.length > 100, 'the step exists');
  assert.match(step, /`other instructions:` line of the scan \(section 2\)/);
  assert.match(step, /ends with `audit: advise`[\s\S]*`audit: not needed`\. Not needed → say nothing about it, not even that it is not needed/);
  for (const part of ['- **Why:**', '- **What it does:**', '- **The effect:**', '- **How:**']) assert.ok(step.includes(part), part);
  assert.match(step, /type `\/doctor prompt-audit` in a new conversation/);
  assert.match(step, /not keel's rules/);
});

test('configure: the first question is always project or machine; optional sections may be skipped; the setup is committed', () => {
  const flow = shared('configure-flow.md');
  assert.ok(flow.indexOf('**The first question, always**') < flow.indexOf('## Ground rules'), 'the first line of the flow');
  assert.match(flow, /\*\*Quick\*\* setup \(section 0\) asks only the questions that\s+need the user/);
  const quick = flow.slice(flow.indexOf('**Quick or detailed**'), flow.indexOf('Read the check output'));
  for (const asked of ['1 Languages | asked', '3 Gates | asked', '4 Git | asked', '10 Claude Code settings | asked', '11 Usage and costs | asked']) assert.ok(quick.includes(asked), asked);
  assert.match(flow, /After a quick setup also list every value that was not asked, each\s+with the section that changes it/);
  const steps = flow.slice(flow.indexOf('## 12. Write and summary')).match(/^\d+\./gm);
  assert.deepEqual(steps, ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'], 'no duplicate step numbers');
  assert.match(flow, /\*\*Commit the setup\*\* \(project mode\)[\s\S]*keel's git\s+steps never commit on the\s+main branch, so the user runs them/);
  assert.match(flow, /first `\/keel:start-task` offers to take them into that task's branch/);
  assert.match(shared('intake.md'), /take the setup into this task's branch, so it reaches the main branch with the task's merge/);
});

test('cleanup never offers to empty old trash; the reminder line appears only when it names /keel:cleanup', () => {
  assert.doesNotMatch(skill('cleanup'), /offer `\/keel:cleanup empty-trash`/);
  assert.match(skill('cleanup'), /never offer it/);
  assert.match(shared('final-report.md'), /only when it names `\/keel:cleanup`; any other\s+reminder output is left out/);
  for (const name of ['end-task', 'end-session']) assert.match(skill(name), /its line goes into the report only\s+when it names `\/keel:cleanup`/, name);
});

test('tasks drop: manual git gets the commands; an old handed-off task is offered drop or start then end; restore names the batch', () => {
  const t = skill('tasks');
  assert.match(t, /Manual git mode: keel runs none of the git commands above/);
  assert.match(t, /offer\s+`\/keel:tasks drop <id>`, or `\/keel:start-task <id>` then `\/keel:end-task`/);
  assert.match(t, /`\/keel:cleanup restore <batch>` brings it back, with the batch from its `trash batch:` line/);
  // No keel trace in the project's history, and no key: a commit with a ticket key reads as work on it.
  assert.match(t, /`git-flow\.js commit` with the message "Remove the notes of a dropped task" \(no "keel", no id/);
  assert.doesNotMatch(t, /keel: drop/);
  for (const f of ['git.md', 'intake.md', 'handoff.md', 'planning.md']) assert.doesNotMatch(shared(f), /message "keel:|commit -m "keel:/, `${f}: no keel commit message`);
});

test('handoff notes: where the work is says only what is certain before git; files and tried-and-failed rules', () => {
  const h = shared('handoff.md');
  assert.match(h, /Never a push or merge result/);
  assert.match(h, /Tests counted as "N new, M total"/);
  assert.match(h, /what the user rejected or what turned out wrong during the\s+work/);
  assert.match(h, /`lane: none \(task <id> was finished or dropped earlier\)` → say so and ask whether to start it as a new line/);
  assert.match(shared('intake.md'), /`lane: none \(task <id> was finished or dropped earlier\)` → say so and ask whether to start it as a new\s+task/);
});

test('planning: the step table is checked inside Plan Mode and approved once; plan.md points to the full task.md list', () => {
  const intake = shared('intake.md');
  assert.match(intake, /Still in Plan Mode, check its steps \(below\), then ExitPlanMode once/);
  assert.match(intake, /No separate question after ExitPlanMode/);
  assert.match(intake, /come first, only when step 2 needs\s+a branch switch/);
  assert.match(read('templates', 'keel', 'plan.md'), /intake\.md` "7\. Execution" item 2\s+lists \(every front-matter field and section\)/);
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
  assert.match(step3, /The instruction asks to\s+merge → step 6 now, still on this branch/);
  assert.ok(step3.indexOf('step 6 now') < step3.indexOf('switch --name <base>'), 'merge first: on the base branch merge would stop');
  assert.match(git, /6\. \*\*Merge\*\* \(a handoff comes here from step 3\)/);
});

test('git.md: in a finish a sync conflict comes after the commit that holds the removal, so nothing is put back', () => {
  const sync = shared('git.md').slice(shared('git.md').indexOf('4. `sync'), shared('git.md').indexOf('5. `push`'));
  assert.match(sync, /`conflict` → show the files\. In a finish the commit of step 2 already holds the task's removal,\s+so nothing is put back/);
  assert.match(sync, /after the resolve commit the finish goes on with the push\. Offer: resolve together now/);
});

test('git.md: red gates after a sync offer a fix or putting the task back, never a silent stop', () => {
  const sync = shared('git.md').slice(shared('git.md').indexOf('4. `sync'), shared('git.md').indexOf('5. `push`'));
  assert.match(sync, /`merged N new commits` →[\s\S]*red → show them; no push\s+while they are red\. Offer: fix them now \(on yes: fix, run the gates, then step 2 with a new\s+message, then step 5\) or stop/);
  assert.match(sync, /With `--finish` the task's removal is committed but not pushed:\s+"stop" puts the task back, `node "<keel>\/scripts\/notes\.js" "<project>" task restore <id> --session <sid>`/);
});

test('the cost report runs last and is pasted whole: the only cost numbers in the final report', () => {
  const sync = shared('usage-sync.md');
  assert.match(sync, /5\. \*\*Not now: last, right before you write the final report\*\*/);
  for (const name of ['end-task', 'end-session']) {
    const text = skill(name);
    assert.match(text, /follow its steps 1-4/, name);
    assert.match(text, /Report: run usage-sync\.md step 5 \(the cost report\), then read/, name);
    assert.ok(text.indexOf('run usage-sync.md step 5') > text.indexOf('git.md'), `${name}: the report runs after git`);
  }
  const costs = shared('final-report.md').slice(shared('final-report.md').indexOf('**Costs**'));
  assert.match(costs, /The user does not see tool output: paste its text into this\s+message/);
  assert.match(costs, /Never "see above" and never leave it out/);
  assert.match(costs, /These are the only cost numbers in the\s+report/);
  assert.doesNotMatch(shared('verify.md'), /ledger-report\.js/, 'no second cost total from the verification');
});

test('verify.md: nothing to verify still records the verification; re-checks cover must and should fixes', () => {
  const text = shared('verify.md');
  assert.match(text, /`proposal: none` → nothing to verify: run `node "<keel>\/scripts\/fingerprint\.js" "<project>" save --tier none`/);
  assert.match(text, /For each fixed must or should item \(critical or important; nice items need no re-check\)/);
  assert.doesNotMatch(text, /fixed critical or important item/);
});

test('final report: a finished task names its trash batch and the restore command', () => {
  assert.match(shared('final-report.md'), /batch <id from the `trash batch:` line of\s+`task delete`>; `\/keel:cleanup restore <that id>` brings it back/);
});

test('preflight: a missing or invalid project scan is said in one line with the re-scan offer', () => {
  assert.match(shared('preflight.md'), /`profile: missing` or `invalid` → say in one line[\s\S]*offer the same re-scan\s+after the command; do not block/);
});

test('start-session: a new line while a note is open asks what happens to the old Plan and Later first', () => {
  const row = shared('handoff.md').split('\n').find((l) => l.includes('Continue the written line or start a new one?'));
  assert.match(row, /New → there is one note, so ask next: finish the old line[\s\S]*or keep its open Plan steps and Later items \(they go into the new note's \*\*Later\*\*/);
  assert.match(row, /Write the new note only after this answer/);
});

test('start-task: any other page link is a text source with its link; task files are translated into their language', () => {
  const intake = shared('intake.md');
  assert.match(intake, /any other page or document link, e\.g\. Google Docs or Notion: `--source text --link <url>`/);
  assert.match(intake, /translate the retell and the plan when writing the files/);
});

test('migration: the old note keeps its facts in repo_language; a standalone run writes and checks the config; an outside apply still reaches the secrets step', () => {
  const m = shared('migrate.md');
  assert.doesNotMatch(m, /old note's text unchanged/);
  assert.match(m, /its facts unchanged, its words translated into `repo_language`/);
  const eight = m.slice(m.indexOf('## 8.'), m.indexOf('## 9.'));
  assert.match(eight, /write the config change from step 4 into `\.keel\/config\.json` \(Edit\), then run\s+`node "<keel>\/scripts\/check-config\.js" "<project>"` and fix it until it says `keel-config: ok`/);
  const seven = m.slice(m.indexOf('## 7.'), m.indexOf('## 8.'));
  assert.match(seven, /migrate\.js" "<project>" state`: its lines \(with `possible secrets in moved text`\)\s+stand for apply's output; then go on with step 8, so step 10 is never skipped/);
});

test('configure: a chosen docs pattern the docs do not follow yet is offered as its own first task, with an estimate', () => {
  const flow = shared('configure-flow.md');
  assert.match(flow, /\*\*Moving the existing docs\*\*[\s\S]*your docs already follow it; nothing to move/);
  assert.match(flow, /give the cost as an \*\*estimate\*\* and how it was made/);
  assert.match(flow, /write `<project>\/\.keel\/local\/docs-migration\.md`/);
  assert.match(flow, /First run `\/keel:start-task \.keel\/local\/docs-migration\.md`/);
  assert.match(flow, /Quick setup takes the suggested profile and pattern: keel keeps the docs the way they are/);
});

// --- planned tickets in the task and session lanes (spec: .design/planning-spec.uk.md §2, §11) ---

const order = (text, a, b, why) => {
  assert.ok(text.includes(a), `missing: ${a}`);
  assert.ok(text.includes(b), `missing: ${b}`);
  assert.ok(text.indexOf(a) < text.indexOf(b), why || `${a} comes before ${b}`);
};
const part = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `missing: ${from}`);
  const b = to ? text.indexOf(to, a + from.length) : -1;
  return text.slice(a, b < 0 ? undefined : b);
};
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
  assert.match(p, /a `depends:` ticket `waiting for merge into the feature branch`, or one of another feature that is\s+not done → ask: start from that ticket's branch \/ wait for its merge \/ start anyway/);
  assert.match(p, /`done` → say so; start it again only on a yes/);
  assert.match(p, /a `depends:` ticket of the same feature `to do`, `in progress` or `not found` → say which, and\s+ask: start anyway \/ take the next ticket/);
  // A squash merge after the tickets were removed leaves no ticket file in merge_into's history.
  assert.match(p, /`not found` of a finished feature may be one merged\s+with squash after its tickets were removed/);
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

test('start-task: a task turns into planning only while no code changed; the user types /keel:start-planning', () => {
  const intake = shared('intake.md');
  assert.match(intake, /Too big for one task \(the user says so in any words, or the Plan Mode plan is very big\) → "Task to\s+planning" below/);
  const t = part(intake, '## Task to planning');
  assert.match(t, /Lanes never mix: the task ends completely before planning starts/);
  assert.match(t, /No `task new` yet \(step 7 item 2\) → on yes, ask the user to type `\/keel:start-planning`/);
  assert.match(t, /only while no code changed: `git diff --name-only <started>` \(the task file's\s+`started:`\) and `git ls-files --others --exclude-standard` list nothing outside `\.keel\/`/);
  order(t, 'task drop <id>', 'switch --name <base>', 'the task ends first');
  order(t, 'switch --name <base>', 'delete-branch --name <branch>', 'git-flow.js refuses to delete the current branch');
  assert.match(t, /A branch of\s+its own \(`branch` differs from `base`\) is deleted only on its own yes/, 'a ticket\'s shared feature branch is never deleted here');
  order(t, 'delete-branch --name <branch>', 'Then ask the user to type `/keel:start-planning`');
  assert.match(t, /Code changed → hand off first \(`\/keel:end-task hand off`\), then `\/keel:start-planning` in a new\s+conversation/);
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
  order(six, 'done <KEY>`', '`--tickets <those keys>`', 'the keys marked done are the ones committed');
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
  const source = [['plans.js'], ['lib', 'plans-state.js']].map((p) => (fs.existsSync(file(...p)) ? fs.readFileSync(file(...p), 'utf8') : '')).join('\n');
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
  assert.match(read('scripts', 'git-flow.js'), /^\/\/   commit --message-file <f> \[--tickets <K1,K2>\]/m, 'end-session commits the tickets it marked done');
});
