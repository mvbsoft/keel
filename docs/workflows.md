# Ways of working

[Українська](workflows.uk.md)

keel has three lanes of work:

- **Tasks are point changes.** A separate job with a clear end: a bug, a ticket, a small feature.
  You can have many tasks, each on its own branch and in its own folder, and switch between them.
  Think of a stack of cards: take one, put it back, take another.
  Commands: `/keel:start-task`, `/keel:end-task`, `/keel:tasks`.
- **Sessions are the long road.** One big direction from a plan (a module, a rework, a project), day
  after day; each session continues where the last one stopped. Think of a book with a bookmark.
  Commands: `/keel:start-session`, `/keel:end-session`.
- **Planning comes before the code.** A feature that needs several tasks is first talked through in
  its own conversation: one question at a time, decisions and short tickets, no code. It ends in a
  feature folder of tickets that tasks or a session then do. Think of a drawing before the build.
  Commands: `/keel:start-planning`, `/keel:end-planning`.

**How to choose:** "done" within 1-3 sittings → a task. A plan for weeks, with items for "later" → a
session. A feature for several tasks that is not thought through yet → plan it first.

**They never mix.** What started as a task is led only through tasks; what started in a session, only
through sessions. One conversation, one lane: a planning conversation refuses the task and session
commands, and a task conversation refuses planning ([what guarantees it](behavior.md#planning)). Tasks
and sessions end with the same verification and the same [final report](#the-final-report); planning
ends with its own report.

**Two words.** A *conversation* is one Claude Code chat; `/clear` starts a new one. A *session* is one
sitting on a long line of work, from `/keel:start-session` to `/keel:end-session`. (keel's task list
says "active in this session" for a task this conversation works on.)

**Manual git** (`git.mode: manual`, recommended for a first project): keel runs no git step nobody
asked for: no commit, push or merge on its own; it gives you those commands ready to copy. What you
ask for is run: the branch you choose when a task starts, or your own git instruction. See
[git in each mode](#git-in-each-mode).

| | Tasks | Sessions | Planning |
|---|---|---|---|
| Example | Monday you fix login bug CAN-12. On Tuesday a review request interrupts, so you hand CAN-12 off and take CAN-15, an export button. On Wednesday you return to CAN-12. | You build an invoicing module from a plan of 30 steps, two weeks, a few steps each day. | You plan a CSV export of invoices over two conversations; it ends as 4 tickets, PROJ-101 to PROJ-104, each then done as a task. |
| What carries the work over | one folder per task, `.keel/tasks/<id>/`, on the task's own branch | one note, `.keel/next-session.md` | the draft `plan.md` with its tickets, on this machine or in the repository; then the feature folder |
| Start or continue | `/keel:start-task <link, key or your words>` | `/keel:start-session [plan file, feature, link, description or how to continue]` | `/keel:start-planning [idea, link, file or feature]` |
| Stop for now | `/keel:end-task hand off` | `/keel:end-session we continue tomorrow, prepare` | `/keel:end-planning we continue tomorrow` |
| Finish | `/keel:end-task finish` | `/keel:end-session the line is finished` | `/keel:end-planning final review and export` |

Only you start these commands; the model never runs them on its own. `/keel:help` shows them in a short
table.

## How you talk to keel

- **A command plus your instruction in plain words.** There are no keyword arguments: "hand off",
  "park it for later" and "prepare for the next conversation" all mean the same thing. When keel cannot tell
  what you mean, it asks instead of guessing. Your instruction wins over the defaults; without one the
  defaults apply.
- **keel says what it is about to do.** Before each action (a script, a git step, a file change, an
  agent) it says in one short line what the action is and what it will do.
- **A brainstorm only with your yes.** When the goal is vague, or the task needs a design choice,
  keel explains why a brainstorm would help and how it goes, then asks "Turn it on?". It goes like
  this: questions with options, 1-3 at a time; 2-3 approaches with a recommendation; the plan in parts,
  each approved by you; no code before the plan is approved. No → the ordinary path (a few questions,
  then the plan).

**Where the task comes from:** a link is read from outside, anything else is searched inside.

| You give | keel does |
|---|---|
| a link: Jira, Asana, Linear, GitHub, Google Docs, any page | reads it from outside: with the matching connector, `gh` for GitHub, or a web fetch. It cannot read it (no connector, needs authorizing, closed page) → says so in one line and asks you to paste the text. It never guesses content from a link. |
| a key or number: `CAN-123`, `#123` | searches inside: keel's tasks first, then the [planned tickets](#start-a-planned-ticket), then the repository (files, commit messages). Shows what it found and asks "Is this it?". Nothing found → asks for a link or the text. `#123` does not read a GitHub issue by itself: give the issue link for that. |
| a file path: `docs/spec.md` | reads the file |
| your own words: `password reset returns 500` | that is the task text; keel also looks for similar unfinished tasks |


## Tasks

### Start a task: `/keel:start-task`

Every start ends the same way: keel checks in the code that what the task takes for granted is true
(if not, it says so with `file:line`) and asks **one combined question**: the retell in plain words
(the goal, how we know it is done, what is out of scope), "Is this a continuation of X?" or "This is a
new one. Right?", and for a new task the proposed id, title and one-line description. One answer
settles all of it.

| You type | keel does |
|---|---|
| `/keel:start-task https://example.atlassian.net/browse/CAN-123` | Reads the ticket with the Jira connector. One message: the retell, "No unfinished tasks, so this is a new one. Right?" and the proposed id `CAN-123`, title and one-line description. Then questions (or the brainstorm offer), a plan, and after your yes the branch `CAN-123-google-login` and the folder `.keel/tasks/CAN-123/` on it. Then it codes. |
| `/keel:start-task password reset returns 500` | The same from your words. A new task gets a short id such as `fix-reset-500`; your word wins. |
| `/keel:start-task CAN-123` | Searches keel's tasks, then the planned tickets, then the repository. Found → "Is this it?". It is an unfinished task → offers to continue it; a planned ticket → as [below](#start-a-planned-ticket). Nothing found → asks for the link or the text. |
| `/keel:start-task #123` | The same search inside. For a GitHub issue give its link: `/keel:start-task https://github.com/org/repo/issues/123`. |
| `/keel:start-task fix the export button` when similar tasks are unfinished | Names the 1-3 closest, one line each: "Is this a continuation of CAN-15, or a new task?" |
| `/keel:start-task` | Shows the unfinished tasks, then the next planned ticket ("next planned: PROJ-104"), and asks which to continue or what the new task is. None → "What is the task?" (a link, a key or your words). |
| `/keel:start-task next ticket` or `/keel:start-task PROJ-103` | A [planned ticket](#start-a-planned-ticket). |
| `/keel:start-task make the reports better` | The goal is vague, so keel offers the brainstorm, says why and how it would go, and waits for your yes. |
| `/keel:start-task CAN-15` while CAN-12 is active in this conversation | "Hand off CAN-12 first (`/keel:end-task`, then start this again), or continue CAN-12?" With a clean working tree you may also leave CAN-12 as it is; it stays listed as active. |
| `/keel:start-task CAN-40` (or a link with CAN-40 in it) when CAN-40 is led by a session | "This is led by /keel:start-session (the long-work note names it); continue it there." It stops. A key that both a task and the session note name: keel shows both, asks which lane leads it and stops. |
| `/keel:start-task CAN-9` when task CAN-9 was finished or dropped earlier | Says so and asks whether to start it as a new task. No → it stops; the old folder may still be in keel's trash (see [restore](#where-the-files-live)). |

A simple task (one module, no new public interface, 1-3 files) gets a short plan in the chat and
"Start?". A complex one gets Plan Mode: no file changes until you approve the plan. A big plan (8 steps
or 15 files by default) brings the question whether to do it here or hand the steps to implementer
agents ([cost optimization](cost-optimization.md)).

**Which branch.** The "Start?" question (a simple task) or the plan's first Execution step (a complex
one, changed in your answer to the plan) names the branch you are on and offers:

- create `<id>-<short-name>` from the current branch (recommended);
- work in the current branch;
- your own git steps, for example "switch to dev, update it, merge main into it, then branch
  NEW-FEATURE".

On the main branch keel says plainly that the task's changes would stay there until git time, when keel
moves them to a new branch (it never commits on the main branch), and recommends a new branch now. A branch instruction you gave with the task answers the question. Your answer is the
instruction, so keel runs it in both git modes, one step at a time; a conflict, a refusal or an unclear
step stops it, and keel shows what happened and asks. It never pushes or merges into the main branch
unless your instruction says so.

The branch comes before the task folder, so the folder is born on it. Uncommitted changes stop the
start first: keel offers to hand off the current task, commit, or stash. The setup files that
`/keel:configure` left uncommitted are the exception: the first task offers to take them into its
branch, so they reach the main branch with the task's merge.

### Continue a task

`/keel:start-task CAN-123`, then "continuation" (or the id of an unfinished task). keel:

1. when it has to switch branches and there are uncommitted changes, stops first and offers: hand off
   the current task, commit, or `git stash push -m "keel: <id>"`. It carries changes into another task
   only when you say they belong to it. On the task's branch already, the changes stay and belong to
   the task;
2. switches to the task's branch (manual git: gives `git switch <branch>` and waits);
3. reads `task.md` (and `plan.md` if there is one);
4. checks how stale the task is: how many commits the base branch got since the handoff (and offers to
   bring them in); handed off 7 days ago or more, or commits after its last commit → it compares them
   with the task file and says what no longer holds;
5. runs the task's "How to check" command once; a red result comes first;
6. reads a ticket, link or file source again and tells you what changed against the goal and the
   acceptance criteria; it does not overwrite them without your yes;
7. sums up in 3-6 lines (goal, where we are, done and not done, open questions) and names the next
   action.

### Start a planned ticket

Tickets come from [planning](#planning). Only three instructions go to them: none (the list ends with
"next planned: <KEY>"), "next ticket" in any words, and a ticket key; other words go through the usual
search. For the last two keel fetches first; then it reads the ticket's [state](#ticket-states):

| The ticket is | keel does |
|---|---|
| `to do` or `next` | Reads it, checks its Goal, Acceptance criteria and Where to look against the code, then the usual retell, questions and plan. The task id is the key (`PROJ-104`), the title is the ticket's. |
| `in progress` or `waiting for ...` | Names the branch, author and date behind it and asks: continue it on that branch, start over, or take another ticket. A waiting ticket is never offered as free; with `stale`: "Nobody touched it for 30 days: treat it as free?" |
| `reverted` | Explains that the branch was merged once and the merge reverted: merging it again brings nothing back; it needs a revert of that revert, or new commits. |
| blocked by a dependency | A dependency done only on its ticket branch, or not done in another feature → start from its branch, wait for its merge, or start anyway. One of the same feature not done, or not found → start anyway, or take the next ticket. |
| `done` | Says so; starts it again only on your yes. |
| `duplicate key` | Warns first: two tickets with this key, naming the files. |

**Branch.** The ticket's `branch:` (the feature branch) is offered first: keel switches to it, or
creates it from the branch that has the ticket and asks "Push `<branch>` now, so others see the ticket
is taken?". The task merges where the ticket's `merge_into` says. A ticket branch `<KEY>-<short-name>`
only when you ask for one, always from the feature branch; it merges back into it like any task.

**Finish.** Verification covers every commit since the ticket started, teammates' commits pulled into
the feature branch too. Only a passed verification (gates green, no "must fix" left) writes
`status: done` into the ticket file, in the same commit as the code; red verification or a handoff
leaves it `todo` (manual git: keel reminds you to commit the ticket file with the code). On the shared
feature branch keel only commits, pulls the branch and pushes: the feature branch merges at the
[end of the feature](#end-of-a-feature), after its last ticket. A handoff there, with 2 or more
tickets, asks: a new ticket branch from the feature branch (recommended), commit and push to the
feature branch (you work on it alone), or no commit.

**Too big for a task.** When you say the task is too big, or its plan comes out very big, keel offers
"Plan this as a feature instead?". On yes you type `/keel:start-planning`; the plan in this chat is its
source. A task folder already created goes to keel's trash first, only while no code changed (its own
branch is deleted only on its own yes). Code changed → hand off first, then plan in a new conversation.

### End a task: `/keel:end-task`

| You type | keel does |
|---|---|
| `/keel:end-task` | A menu: 1) finish fully: verify, git, move the task folder to keel's trash; 2) hand off: gates only, update the task file, git; continue in another conversation; 3) your own instruction. Picking "finish" is followed by the question about the verification level. |
| `/keel:end-task finish` | Finishes (below) without asking whether to finish or hand off. It asks the verification level, which findings to fix (only when there is a "must fix" or "should fix" one) and, when the gates were red before the change, whether to fix them first. |
| `/keel:end-task hand off` (or "park it", "prepare for the next conversation", "handoff") | Hands off without questions (below). |
| `/keel:end-task finish, level standard` | Finishes with the Standard verification level, without the level question. A level word (gates, basic, standard, maximum, none; quick means basic) counts only on its own or after "level". |
| `/keel:end-task push` | Not clear whether to finish or hand off, so keel asks. |
| `/keel:end-task finish: create branch bug/FIX-12, push, merge into main` | Finishes; the actions from your instruction run after verification: the work moves to `bug/FIX-12`, is pushed and merged into `main`. |
| `/keel:end-task finish and push` and verification stays red | Claude Code has already asked about the folder (that comes before git). keel stops before any git step and asks what to do; stopping puts the task back. |
| `/keel:end-task` when the task is only on another branch | Switches to the task's branch first (uncommitted changes: it asks what to do with them), then goes on. |
| `/keel:end-task` with no task at all | Offers to create a task from what this conversation did, or to verify without a task file (then there is no folder to remove, and a handoff is not possible). |
| `/keel:end-task` in a conversation that runs a long-work session | "This conversation leads a long-work line: end it with /keel:end-session." It stops. |

**Finish:**

1. **Verification.** You pick the level (gates only, Basic, Standard, Maximum or none) unless
   your instruction named one. The whole task is verified, also the commits of earlier conversations on
   its branch. When there is nothing to verify, keel records "no verification" by itself and says so.
   See [verification](verification.md).
2. **Fixes** of the items you choose. With no "must fix" or "should fix" item keel does not ask and
   goes on.
3. **Claude Code's confirmation: "keel: task <id> is done? Its folder `.keel/tasks/<id>/` goes to
   keel's trash."** Claude Code itself asks it every time, also when your instruction says "finish
   fully" and when your permission rules would allow the step; keel only says one line before it.
   keel's script moves the folder only when a verification is recorded for the code as it is now
   (also "none"): committing the verified code keeps it verified, any other change needs a new
   verification. Yes → the folder moves to keel's trash (`.keel/local/trash/<batch>/`, on this
   machine, not in git) before the commit, so the removal is in the last commit of the task branch.
   No → the task stays active on its branch.
4. **Git**: the steps of your git mode (manual: the changed files and a ready commit command that
   includes the folder's removal; autonomous: commit, update from the base branch, push) plus the
   actions you named. The merge only when you asked for it (see
   [merging](#merging-into-the-main-branch)). A declined or protected merge does not undo the finish:
   the work is committed and pushed.
5. **The [final report](#the-final-report)**: "finished", and `/clear` before the next task keeps it
   apart and costs less.

#### What can go wrong in a finish

| What happens | Then |
|---|---|
| You answer no to the folder question | The folder stays and the task stays active on its branch. keel runs no git step: keep working and run `/keel:end-task` again when it is done, or hand it off. |
| Autonomous git: a step before the removal is committed stops (a failing commit hook) | The git script itself puts the folder back and makes the task active again. The report says what stopped; fix it, then run `/keel:end-task` again. |
| Autonomous git: the update from the base branch or the push stops after the commit (a conflict, a refused push) | The removal is already committed, so the task is not put back; the script says so. Fix the cause, then keel runs that step again. |
| Autonomous git: new commits from the base branch turn the gates red | The removal is committed but not pushed. keel stops git and offers: fix them now (then commit and push), or put the task back. |
| Verification is red and your instruction says push or merge | Claude Code has already asked about the folder. keel stops before any git step and asks; stopping puts the task back. |
| Autonomous git: keel would end its answer with the folder in the trash and nothing committed | Claude Code's Stop hook keeps it working once: go on with git, or put the task back. It does not interrupt a question to you. |
| Manual git and you do not commit | Say so: keel puts the task back. If you never say it, the folder stays in keel's trash; `/keel:cleanup restore <batch>` brings it back. |

What guarantees each step: [How keel behaves](behavior.md).

**Hand off:**

1. **Gates only** (tests, linters, types; no agents) unless you name a level. Red gates do not stop a
   handoff and keel does not fix them: they are written under the task's "Open questions".
2. **The task file is updated** in the [handoff format](#what-is-in-a-handoff), with
   `status: handed-off`, the date, the commit it was written after (`after_commit`) and the branch.
3. **Git**: autonomous: commit, push, switch back to the base branch; manual: the commands to run.
4. **The final report**: "handed off: continue with `/keel:start-task <id>`".

**A handoff without the task's own branch** (the task works in the base branch or the main branch,
which other work shares) and no git instruction from you: before any git step keel asks, in both git
modes:

- a new branch from here: commit and push there, then back on the current branch (recommended);
- commit and push to the current branch (not offered on the main branch, where keel never commits);
- no commit: the changes stay uncommitted for next time (they move with you if you switch branches);
- your own instruction.

Your answer is then run, in manual git too, because you asked for it.

### See and drop tasks: `/keel:tasks`

`/keel:tasks` lists the unfinished tasks of this working tree and of every branch (as of the last
fetch), in the conversation language:

```
CAN-123 · Google sign-in lands on an empty page
  Source: Jira — https://example.atlassian.net/browse/CAN-123
  State: handed off 2 days ago · steps 3/5 · branch CAN-123-google-login
  Next: write the test for the redirect after the callback
  Files: .keel/tasks/CAN-123/ (on branch CAN-123-google-login)

fix-reset-500 · Password reset returns 500
  Source: text
  State: active in this session · steps 1/3 · branch fix-reset-500
  Next: lower-case the email before the lookup
  Files: .keel/tasks/fix-reset-500/

Continue one with /keel:start-task <id>.
```

A task whose base branch moved since the handoff also gets a "Base moved" line. A task handed off 30
days ago or more: keel offers to finish it or drop it.

Then the planned tickets, when there are any not done, with their [states](#ticket-states):

```
Planned
csv-export (1 of 4 done, 1 waiting for merge)
  PROJ-101 CSV writer — done
  PROJ-102 Export button — in progress · branch csv-export, Ann Lee, 2 days ago
  PROJ-103 Large files — waiting for merge into the feature branch · branch PROJ-103-large-files, Ivan Bondar, today
  PROJ-104 Export settings — next
Server data from 2026-10-27T09:12:00Z.

Start the next one with /keel:start-task PROJ-104.
```

A feature whose every ticket is `done` or `waiting for the feature merge` gets the offer of its
[end](#end-of-a-feature).

| You type | keel does |
|---|---|
| `/keel:tasks CAN-123` | Shows that task: goal, state, open questions and next action, in 3-6 lines. |
| `/keel:tasks drop CAN-123` | Explains everything the task left: its folder, its branch (local, pushed), the commits not in the base branch, the changed files and the docs among them. Asks what to remove: everything or which parts. Then each removal on its own, the folder first; Claude Code itself asks you to confirm the folder and the branch. |

Dropping, step by step:

- **The folder.** A task whose folder is on another branch: keel switches there first (that needs a
  clean working tree). The folder goes to keel's trash and leaves your task list at once. When it was
  committed and its branch stays, keel commits the removal on that branch (and pushes it when the
  branch was pushed), so teammates stop listing it too; then it switches back. The confirmation names
  `/keel:cleanup restore`, and keel names the batch that brings it back.
- **The branch.** Deleted only after Claude Code's confirmation. The script never deletes the main
  branch or the current one, and after a delete it prints the command that brings the local branch
  back. For a pushed branch it also prints the remote branch's last commit and
  `git push <remote> <commit>:refs/heads/<name>`, which brings the remote branch back while that commit
  is still in your repository.
- **Changes already in the base branch** are only reverted (`git revert`, after your yes), never
  rewritten.
- **Manual git**: keel gives the commit, branch and revert commands instead of running them.

After each step keel says what is gone and what stays.

## Sessions

The only thing that links the sessions of one line is the note `.keel/next-session.md`. Task folders
are not part of it.

### Start a session: `/keel:start-session`

| You type | keel does |
|---|---|
| `/keel:start-session` with a note | Reads the note and project memory, compares them with the repository (new commits, another branch), sums up in 3-6 lines and names the first action. A note with `status: blocked` shows the open questions first. The plan has no steps left but **Later** has items → proposes the next 1-3 of them, with the reason for each, as the new plan. |
| `/keel:start-session only write the tests today` | The same, following your instruction. Extra work is added to the plan. |
| `/keel:start-session` with no note | Looks for work in the project: plans, TODO markers in recently changed files, unfinished work in git; proposes 1-3 briefly. Nothing → "There is no work for a session; tell me what to do." Unfinished tasks → it adds "There are unfinished tasks: /keel:tasks shows them, /keel:start-task continues one." It never starts a task itself. |
| `/keel:start-session docs/invoicing-plan.md` | A new line from a plan file: its items become the note's plan (all not done), its goal the note's goal, **Later** is empty. Shows it and asks "Start?". Then the branch for the line. |
| `/keel:start-session build the invoicing module` (or a link) | A new line from a description: retell, the brainstorm offer or questions, then the plan, which becomes the note's plan. |
| `/keel:start-session csv-export` (a feature name or folder: "do these tickets one by one") | A new line from [planned tickets](#planning): the Plan is the feature's `next` and `to do` tickets, the next one first, each after the tickets it depends on, one step per ticket; their keys go into `keys:`. Tickets `in progress` or `waiting for ...` are listed with their hints, and you decide whether any goes in. Shows it and asks "Start?"; then it switches to the feature branch (or creates it) and writes the note. Each `/keel:end-session` with a passed full verification writes `done` into the tickets whose steps are all done, in the same commit as the code; gates only or red → no. A feature branch is merged only at the [end of the feature](#end-of-a-feature). |
| `/keel:start-session CAN-123` (or a link with CAN-123 in it) | CAN-123 is led by a task → "Tasks use /keel:start-task: better continue it there." and stops. Both a task and the note name it → keel shows both, asks which lane leads it and stops. Nobody leads it → keel finds what it is ("Is this it?"), the session goes on, and the key is written into the note's `keys:` field. |
| `/keel:start-session CAN-9` when task CAN-9 was finished or dropped earlier | Says so and asks whether to start it as a new line; no → it stops. |
| `/keel:start-session <a link or a description>` while a note is open | If it is about a different line of work: "Continue the written line or start a new one?" There is only one note, so a new line asks next: end the old line, or carry its open steps into the new note's **Later**. |
| `/keel:start-session` while a task is active in this conversation | Asks to hand the task off or finish it with `/keel:end-task` first, or to open a new conversation for the line. |
| `/keel:start-session do it through subagents` | The summary, then the remaining steps go to implementer agents. |

### End a session: `/keel:end-session`

| You type | keel does |
|---|---|
| `/keel:end-session` | Verification of this session's work since `/keel:start-session`, committed or not (you pick the level) → prepares the note, project memory and a session log → git (commit, push) → the [final report](#the-final-report) with "Next time: ..." and "Agree, or change it?". Your answer updates the note. |
| `/keel:end-session we continue tomorrow, prepare` | Gates only, with no level question → prepares the note → git (commit, push) → report. |
| `/keel:end-session push and merge into main` | Verification → prepares the note → git with the push and the merge. |
| `/keel:end-session the line is finished` | The same as the first row, and the note gets `status: done`. |
| `/keel:end-session level standard` | Verification at the Standard level, without the question. |
| `/keel:end-session` in a conversation that works on a task | "This conversation works on a task: end it with /keel:end-task." It stops. |

Preparing means: the note is updated, not rewritten; things found along the way for the future go into
**Later**; the next action is one concrete step.

## Planning

A *feature* is one finished capability of the product that one sentence explains (a connection to
S3). Planning turns it into short tickets in a conversation with you, before any code: the
conversation writes only the draft, and keel's hook refuses changes to other project files
([what is guaranteed and what is not](behavior.md#planning)). One conversation plans one feature.

### Start: `/keel:start-planning`

| You type | keel does |
|---|---|
| `/keel:start-planning` the first time in a project | Two questions, one per message: the tickets' language (default: the project's `repo_language`), and where the draft lives: on this machine (default, outside git) or in the repository (a `tickets/` folder, or a ticket folder the project already has; colleagues see it through git). Say "draft in the repo" at any start to change it. |
| `/keel:start-planning` | Lists the drafts (feature, state, open questions, tickets, last change, where) and asks which to continue or what the new feature is. |
| `/keel:start-planning csv-export` | Continues that draft: its open questions, the review findings without a decision, which files its tickets name changed since, a summary in 3-6 lines and the Next action. |
| `/keel:start-planning continue the CSV export` | Looks for the words in the drafts' names and summaries: one match → "Continue `csv-export`?"; several or none → the list. |
| `/keel:start-planning <idea, link or file>` | A new feature (below). |

**A new feature.** keel reads the source as `/keel:start-task` reads a link, retells the goal, who
gains and what is out, and checks in the code that what the feature relies on is there. Then:

- **size**: small (up to 5 questions, one conversation) or large (several conversations, each ended
  with `/keel:end-planning`); one goal for 1-3 sittings looks like one task, so keel suggests
  `/keel:start-task`, and you decide;
- **name**: 2-4 English words joined by `-` (`[a-z0-9-]`, at most 40 characters, starting with a
  letter, no digit right after a hyphen: `add-2fa` would read as the key `ADD-2`); what, not how:
  `s3-connection`. Your word wins;
- **main branch**: with several candidates (main, master, develop, release/*) one question: "Where
  will this feature's tasks merge?"; otherwise keel names `git.main_branch` in one line;
- **project rules**: when `AGENTS.md`, `CLAUDE.md` or `CONTRIBUTING.md` says otherwise ("no backlog in
  the repo"), keel quotes it and offers: follow the project, keep your choice, or your own way;
- **a draft in the repository**, before its first file and each commit: on the main branch → "Create
  branch `<feature>`?"; on another task's branch → a new branch; other uncommitted changes → commit or
  stash them first; the feature's branch exists → "Switch to it?"; a task active in another
  conversation → the draft on this machine for now, another copy (`git worktree add`), or your risk.

**The work.** One question per message, answerable in a line; a design choice comes with 2-3
approaches and a recommendation. keel keeps `plan.md` true as you go: Summary, Problem / Goal,
Decisions (`D1. decision - why`), Out of scope, Design sketch, Terms, Open questions
(`Q1. question - what depends on it`; an answered Q becomes a D), Tickets, Next action. Tickets are
written at once and stay short (150-400 words, one goal, no implementation steps): Goal, Why,
Acceptance criteria, Where to look (`file:line`), Out of scope, Dependencies, How to check. In the
draft they are `T1`, `T2`...; a T-number is never reused. More than about 15 tickets → keel offers to
split the feature. keel looks up code facts itself; a pricier model or web research only when you ask.

### End: `/keel:end-planning`

| You type | keel does |
|---|---|
| `/keel:end-planning we continue tomorrow` (any words for "later") | **Hands over**: reviews only the tickets never reviewed or changed since their review; each finding is fixed now or becomes a Q; `plan.md` gets the open questions and the Next action. A draft in the repository: the commit questions (below). |
| `/keel:end-planning final review and export` | **Final**: below. |
| `/keel:end-planning` | Open questions or structure problems → hands over, with the reason in one line; otherwise asks "Final review and export, or hand over?". |

**Final.** 1) The gates: no open questions, a clean structure check (sections, acceptance criteria, no
TBD, the named files exist, dependencies without cycles), and a decision for every finding; else keel
shows what blocks and offers to hand over. 2) Ticket reviews of the tickets not reviewed as they are
(`keel:ticket-reviewer`, up to 4 tickets per call), then one review of the whole plan
(`keel:plan-reviewer`), both on Sonnet. You decide each finding: fix, defer to a Q, or reject with a
reason; decisions go into `reviews/` and are not raised again. Fixed tickets are reviewed again, at
most 2 rounds per `/keel:end-planning`; a failed review is named as failed, never as "no findings".
3) The plan becomes `ready` (any later change makes it a draft again), then "Export the <n> tickets
now?"; no → it stays `ready` for the next `/keel:end-planning`.

Every end, also after a no, frees the conversation from planning. The report: **Done**, **Reviews**,
**Git**, **What next** (the Next action, or "a ticket starts with `/keel:start-task <KEY>`"),
**Costs**.

### Export

- **Where**, asked the first time: the repository (a ticket folder the project has, else `tickets/`;
  the feature lands in `<folder>/<feature>/`) or this machine only (keel says "These tickets are seen
  on this machine only"). A draft in the repository always exports there. Never used: hidden folders,
  `handoff/` and `handoffs/` (another notes system), `docs/plans`, a place outside the project.
- **Names**: `PROJ-123-add-csv-export.md` with the title `# [PROJ-123] Add CSV export`. The prefix is
  asked once: the first of `comments.ticket_prefixes` in `.keel/config.json`, else 3-4 capital
  letters from the repository's name; you confirm.
- **Shared numbers**: after a `git fetch`, the next number is 1 + the highest of that prefix in commit
  messages, ticket file names on every branch, branch names and ticket folders (exact: `PROJ-10` is
  not `PROJ-101`). The commit checks again: a key another ticket file took meanwhile gets a new number
  while ours is on no remote yet (a published one is refused, to settle by hand); the push checks once
  more and refuses.
- **All or nothing**: every key first, `T1`... replaced everywhere (dependencies, links, the
  overview), the files written into a temporary folder and renamed once. A failed run leaves no
  feature folder and the plan `ready`.
- **After**: the feature folder is the one source: the tickets (`type: ticket`, `key`, `status: todo`,
  `feature`, `branch`, `merge_into`, `depends_on`) and, from 2 tickets, a `README.md` overview. A draft
  on this machine goes to keel's trash; one in the repository leaves with the commit of the tickets.
- **Git**: "Commit the planning files?", then "Push `<branch>`?", each on its own, and Claude Code asks
  too, every time. Never on the main branch; planning never opens a pull request.

### Ticket states

`/keel:tasks` and `/keel:start-task` work out each ticket's state from git and the files (a script, no
tokens). The file holds only `todo` or `done`. The first state that holds wins (keel shows them in the
conversation language):

| State | When |
|---|---|
| `done` | `done` on the remote's `merge_into` |
| `waiting for the feature merge` | `done` on the feature branch, not yet in `merge_into` |
| `waiting for merge into the feature branch` | `done` only on another branch, such as a ticket branch |
| `in progress` | a commit with the key that changes more than the ticket, a branch named with the key, an unfinished keel task with the key as its id, or the key in the session note's `keys:` |
| `to do` | none of these |

`next` marks the first `to do` ticket of a feature whose dependencies are done (or waiting for the
feature merge). Marks after the state: `reverted` (done on a branch merged once, then taken back),
`stale` (the branch behind the state has no commit for 30 days), `duplicate key` (several files). Each
line names the branch, author and age behind it. Branches without a commit in 30 days are not read,
except each ticket's own `branch` and `merge_into`. Tickets on this machine: `done` in the file,
`in progress` by a task or the note here, else `to do`.

### Edit an exported feature

`/keel:start-planning <feature>` reopens it in its feature folder (when the folder is on another
branch, keel offers to switch). Only `to do` and `next` tickets are edited, each change on your yes,
then checked and reviewed; you decide each finding in the chat. A ticket `in progress`,
`waiting for ...` or `done` is never changed: keel offers a new ticket or to leave it, and names whom it
concerns. A new ticket takes the next shared key. `/keel:end-planning` then checks the folder and
offers the commit and push; no plan gates, no plan review.

### End of a feature

When the last ticket is marked done, or `/keel:tasks` finds every ticket `done` or
`waiting for the feature merge`, keel says "Feature <f> is complete" and asks one question at a time,
each step only on its yes, in both git modes: 1) onto the feature branch (a ticket branch first merges
into it); 2) keep the tickets (default) or delete them: the folder goes to keel's trash, and one in the
repository leaves in its own commit on the feature branch, before the merge; 3) "Merge `<branch>` into
`<merge_into>`?"; 4) after the merge, "Delete the branch `<branch>`?".

## Merging into the main branch

keel merges into the main branch (or another target) **only when your instruction asks for it**, for
example `/keel:end-task finish and merge into main`. Without that, the branch stays pushed and the
report says "merge it when ready". The one exception: with `git.ask_before_merge: false` in the project
settings, finishing a task (or a line) in autonomous git also merges.

- Before merging keel says "Merging X into Y.", and Claude Code asks before every merge keel runs. Only
  with autonomous git confirmed on this machine and `git.ask_before_merge: false` does the merge run
  without asking.
- The merge needs the branch pushed as it is now, and stops when your local target branch has commits
  the remote does not have (they would be published with it).
- A task handoff whose instruction asks to merge, with the task folder in git: keel first says the task
  is not finished and the merge puts `.keel/tasks/<id>/` into the target, and asks "Finish the task
  instead, or merge anyway?".
- A protected target: keel offers a pull request.

## The final report

`/keel:end-task` and `/keel:end-session` end with one report in the same order: **Done**,
**Verification**, **Git**, **What next**, **Costs**. When only the gates ran, the Verification block is
just the gates line. An example (shortened; the numbers are made up):

> **Done.** Password reset no longer fails when the email has capital letters; the reset link now
> works for every account.
>
> **Verification:** Basic: one reviewer (Haiku), one verifier.
>
> | severity | found | fixed | left |
> |---|---|---|---|
> | should fix | 2 | 1 | 1 |
> | nice to fix | 1 | 0 | 1 |
>
> Left: 2 the reset email has no plain-text part; 3 rename `tmp` in `reset.js` (not verified).\
> Gates: tests 212 pass, lint 0.
>
> **Git:** committed on `fix-reset-500`, pushed; not merged: merge it when ready.
>
> **What next:** finished, its folder moved to keel's trash (batch 20261014-153012;
> `/keel:cleanup restore 20261014-153012` brings it back). `/clear` before the next task keeps it
> apart and costs less.
>
> **Costs**
>
> | who | requests | in | cache write | cache read | out | $ |
> |---|---|---|---|---|---|---|
> | main (claude-sonnet-5-5) | 84 | 40 | 180k | 2.40M | 31k | $1.00 (88 %) |
> | agent keel:reviewer (claude-haiku-5-5) | 9 | 12 | 30k | 150k | 4k | $0.01 (1 %) |
> | agent keel:verifier (claude-sonnet-5-5) | 6 | 9 | 25k | 120k | 5k | $0.13 (11 %) |
> | **total** | 99 | 61 | 235k | 2.67M | 40k | **$1.14** |
>
> time: 42 min, active 27 min

The cost table lists only participants that actually ran, with a total row; below it come the time,
your turns, the most expensive turns and, on a subscription, the share of your plan limits. How costs
are counted: [usage dashboard](usage-dashboard.md#the-cost-report).

## What is in a handoff

Tasks and the session note use one format. The next conversation knows nothing but this file, the git
history and the code, so the file is a brief written in advance:

| Section | What |
|---|---|
| Goal | one sentence |
| Next action | one concrete step |
| State | one line per step: ✅ done and verified · ◐ in progress · ⚠ broken · ⬜ not started; and where the work is: the branch and "committed together with this note" (manual git: "uncommitted: the user commits it on branch X"; a stash by name); never push or merge results |
| Files | changed / important, read / next |
| Decisions and why | so they are not reopened |
| Tried and did not work | so it is not retried |
| Open questions | what each one blocks (red gates of a handoff are written here) |
| How to check | a command and what a pass looks like |

A task file also keeps the acceptance criteria, what is out of scope, and your own wishes in words
("branch off release-2.3, merge into develop"). The note also keeps the long **Plan** (each step marked)
and **Later**, and the tracker keys it leads in `keys:`. The header names the commit the file was written after
(`after_commit`: HEAD at the time; the file's own commit follows it), the branch and the date.

Rules:

- **Update, do not rewrite**: change what changed, keep what still holds.
- **Keep a sentence only if** without it the next conversation would act differently.
- **At most 150 lines per file** (each task file, the note, project memory), checked by
  `notes.js check`. Over it → compress: done steps one line each, resolved questions out, from "Tried
  and did not work" only what could tempt a retry; a big task plan goes to `plan.md` in the task
  folder.
- **No secrets**: no passwords, keys, tokens or connection strings.
- The text is in the project's `repo_language`; only a task's `task.md` and `plan.md` with
  `tasks.in_git: false` are in the conversation language. Headings stay in English.

## Where the files live

| Path | What | In git |
|---|---|---|
| `.keel/tasks/<id>/task.md` | one task: the ticket, its state and the handoff in one file | yes, on the task's branch only |
| `.keel/tasks/<id>/plan.md` | the task's plan, when it is big | the same |
| `.keel/local/tasks/<id>/` | the same folder when `tasks.in_git` is `false` | no, this machine only |
| `.keel/next-session.md`, `.keel/memory/`, `.keel/sessions/` | the session note, project memory and session logs | yes (`git.state_in_git`) |
| `.keel/local/trash/<batch>/` | the folders of finished and dropped tasks; exported, abandoned and dropped planning folders | no, this machine only |
| `.keel/local/plans/claude/` | Claude Code's Plan Mode plans (the `plansDirectory` keel recommends) | no, this machine only |
| `.keel/local/plans/keel/<feature>/` | a planning draft on this machine: `plan.md`, `tickets/T<n>-<slug>.md`, `reviews/`; after an export to this machine, its `tickets/` holds the exported tickets | no, this machine only |
| `.keel/local/plans/keel/sessions/`, `settings.json`, `samples/` | which conversation plans which feature; the planning settings; the ticket reviewers' inputs and replies, kept to compare models later | no, this machine only |
| `tickets/<feature>/` (or the folder you chose) | a planning draft in the repository, and the feature folder: `<KEY>-<slug>.md` tickets and, from 2 tickets, `README.md` | yes, on the feature branch, after your yes |

- **The task folder lives on the task branch.** It is created after the branch, and a finish removes
  it before the last commit, so the main branch's files never hold it (in manual git, as long as you
  commit on the task branch). After a `--no-ff` merge the main branch's history still holds the
  commits that added and removed it, and a pushed branch keeps it in its history too. To keep task
  text out of the repository entirely, use `tasks.in_git: false`.
- **Only folders are tasks.** A task is a folder `.keel/tasks/<id>/`; any other file there (a README)
  is not a task.
- **The trash is not emptied by itself.** Only `/keel:cleanup empty-trash` empties it, after Claude
  Code's confirmation; by default it deletes batches 30 days old or more
  (`cleanup.trash_max_age_days`).
- **Restoring a folder.** `/keel:cleanup restore <batch>` puts that batch back; without a name it takes
  the newest batch of any kind (a cleanup too). Files come back into the branch checked out now,
  uncommitted: for a task's folder, switch to the task's branch first.
- **Task ids** compare without case (`CAN-123` and `can-123` are one task). Windows device names
  (`CON`, `NUL`, `AUX`, `COM1`...) and an id ending in a dot are refused.
- **`tasks.in_git`** (in `.keel/config.json`, optional, default `true`): `true` commits the folder on its
  branch, so teammates and your other machines see the task (`/keel:tasks` reads every local and
  remote-tracking branch, as of the last fetch); `false` keeps it on this machine, outside git, visible
  from any branch. Use `false` when the repository must not hold task text. All settings:
  [settings](settings.md#this-project).

## Git in each mode

Set by `git.mode` (required: `/keel:configure` asks it and recommends `manual` for a first project); see [settings](settings.md#this-project).

| Moment | Autonomous | Manual |
|---|---|---|
| Start a task | keel runs the branch you chose ([which branch](#start-a-task-keelstart-task)) before the task folder, so the folder is born on it. A new branch starts from the current branch, updated first. With uncommitted changes you said belong to the task (such as keel's setup files), the branch starts from the current commit and carries them | the same: your choice is your instruction, so keel runs it (a new branch with `git switch -c <branch>`; Claude Code may ask) |
| Continue a task | keel switches to the task's branch | keel gives `git switch <branch>` and waits |
| Hand off a task | commit (secret files and untouched files from before the task left out), push (if refused, the handoff stands and keel says so), the merge when your instruction asks for it ([above](#merging-into-the-main-branch)), switch back to the base branch | the changed files and a commit message; commit the work and the task folder on the task branch, then `git switch <base>`; or commit only the folder and `git stash push -u -m "keel: <id>"` for the rest |
| Hand off a task without its own branch, no git instruction | keel asks where the work goes ([above](#end-a-task-keelend-task)) and runs your answer | the same: keel asks and runs your answer |
| Finish a task | commit (with the folder's removal), update from the base branch, push; the merge only as [above](#merging-into-the-main-branch). When a step stops: [what can go wrong](#what-can-go-wrong-in-a-finish) | the changed files and a ready commit message (the removed folder is part of it); you merge as you usually do |
| Start a new line (session) | keel creates the branch for the line | keel gives `git switch -c <name>` |
| End a session or prepare the next one | commit, push; no update from the base branch | "commit and push when convenient; the note is part of the commit" |
| Finish a line (session) | commit, update from the base branch, push; the merge only as above | a ready commit message; you merge as you usually do |

keel never asks which git steps to take (except the branch at a task's start, a handoff without
the task's own branch, each step at the [end of a feature](#end-of-a-feature) and each commit and push
of planning files): these are the defaults, and your instruction only adds or changes steps.
Actions from your instruction run after verification; "create branch bug/FIX-12" moves the work to that
branch. Red verification and an instruction to push or merge → keel stops and asks before any git step.
Secret files, keel's `.keel/local/` files and untracked files that were there before the task and did
not change (not this task's work; verification leaves them out too), which a commit leaves out on
purpose, do not stop the next git steps (git itself still refuses a merge that would overwrite such a file).
Commit messages follow your `git log` style, name the task id when it is a tracker key and never mention
AI. The git steps never force-push, rebase pushed work or commit to the main branch directly; only
`/keel:tasks drop` deletes a branch, after Claude Code's confirmation (and, each on its own yes, the
feature branch at the end of a feature and a task's own branch when it turns into planning). You
confirm autonomous mode once on your machine; until then Claude Code's normal permission rules decide
each git step.

Planning's commit and push are the same in both modes ([export](#export)).
