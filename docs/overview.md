# How keel works

[Українська](overview.uk.md)

keel is a Claude Code plugin that runs your work on a project by a set of rules: at the start it
understands the task and makes a plan, while you work it writes code to your standards, and at the end
agents verify the change, keel does git (or gives you the commands, in manual mode) and reports the
costs. The idea: the quality of an expensive process at a low price; every check has a level, and you
see its price.

keel acts only in a project you set up with `/keel:configure`; anywhere else it adds no rules, checks
or agents, only the short descriptions of its commands and agents that Claude Code lists for every
installed plugin ([install](install.md#what-keel-changes-on-your-machine-and-in-projects)).

This page shows the whole system in short; each section ends with a link to the detailed page.

## 1. Three lanes of work

keel has three lanes, and they never mix in one conversation: what started as a task is led through
tasks; what started in a session, through sessions. Planning writes no code: it ends in a feature folder
of short tickets that tasks or a session then build.

| | Tasks | Sessions | Planning |
|---|---|---|---|
| What | point changes: a bug, a ticket, a small feature; many at once | one big job from a plan, day after day | a feature thought through before code, in one conversation or several: decisions and short tickets |
| Commands | `/keel:start-task <anything>`, `/keel:end-task [instruction]`, `/keel:tasks` | `/keel:start-session [plan file \| feature \| link \| description \| how to continue]`, `/keel:end-session [instruction]` | `/keel:start-planning [idea \| link \| file \| feature \| nothing]`, `/keel:end-planning [instruction]` |
| Lives in | `.keel/tasks/<id>/`, on the task's branch | `.keel/next-session.md` | a draft in `.keel/local/plans/keel/<feature>/` or in the repository; then the feature folder |

**How to choose:** "done" within 1-3 sittings → a task; a plan for weeks with items for "later" → a
session; a feature that needs several tasks → plan it first.

**Common to all three:** the start and end commands take instructions in plain words, with no keyword
arguments; unclear → keel asks; before each action it says what it will do.

More: [ways of working](workflows.md).

## 2. Starting a task

`/keel:start-task` reads the source (a link from outside, a key searched in keel's tasks and the
repository, a file, or your words) → retells it in plain words (the goal, how we know it is done, what
we do not do) and checks it against the code → asks one question: "continuation of X?" or "new,
right?", with a proposed name and description. When the goal is vague it offers a brainstorm, only
with your yes.

- **A new task:** plan (a complex one in Plan Mode), with the branch to work in: a new one from the
  current branch (recommended), the current branch, or your own git steps → branch → task folder →
  work.
- **A continuation:** branch, task file, freshness (did main move on? was it handed off 7 days ago or
  more?), the check command, a summary and the next action.
- **A key led by a session:** "this is led by /keel:start-session".
- **A planned ticket** (`next ticket` or its key): keel shows its state and offers its feature branch;
  then it goes on as a new task. A task that turns out too big can become planning while no code has
  changed (after code changes: once it is handed off).

More: [start a task](workflows.md#start-a-task-keelstart-task).

## 3. Ending a task

`/keel:end-task` with no instruction shows a menu: finish / hand off / your own instruction.

- **Finish:** verification (you pick the level) → fixes → Claude Code's own confirmation "task <id> is
  done? Its folder `.keel/tasks/<id>/` goes to keel's trash" → yes: the folder goes to keel's trash,
  then git (autonomous: commit, update from main, push; a git step that stops before the commit
  brings the task back).
  No: the task stays active.
- **Hand off:** gates only → the task file updated → commit, push, back to the base branch → report. A task
  without its own branch first asks where the work goes.
- Merging into main only on your instruction (or on a finish with `git.ask_before_merge: false`).

More: [end a task](workflows.md#end-a-task-keelend-task); what guarantees each step:
[how keel behaves](behavior.md).

## 4. The task list

`/keel:tasks` lists the unfinished tasks of every branch and the planned tickets; `/keel:tasks <id>`
shows one; `/keel:tasks drop <id>` removes what a task left, each part after its own yes.
More: [the /keel:tasks command](commands.md#keeltasks).

## 5. Sessions

`/keel:start-session` continues from the note, or starts a new line from a plan, a description, a
link or a feature's planned tickets; with no note it proposes work and never starts a task itself. `/keel:end-session` verifies the
session's work, updates the note and does git; `/keel:end-session we continue tomorrow, prepare` runs
only the gates; `/keel:end-session push and merge into main` also merges.
More: [start a session](workflows.md#start-a-session-keelstart-session),
[end a session](workflows.md#end-a-session-keelend-session).

## 6. Planning

`/keel:start-planning` plans a feature in its own conversation: it retells the feature, checks it
against the code, then asks one question at a time and writes the decisions and short tickets into a
draft; no code changes here. With no argument it lists the drafts. `/keel:end-planning we continue
tomorrow` reviews the changed tickets and saves where planning stands; `/keel:end-planning final review
and export` has reviewer agents check the tickets not yet reviewed as they are now, and then the whole
plan, and exports the tickets into the feature folder with real keys. Then `/keel:start-task next
ticket` builds them one by one, or `/keel:start-session <feature>` takes them one by one in a session.
More: [planning](workflows.md#planning), [start-planning](commands.md#keelstart-planning),
[end-planning](commands.md#keelend-planning).

## 7. The report at the end

One for tasks and sessions: **Done** → **Verification** (a found / fixed / left table, the gates) →
**Git** → **What next** → **Costs** (a table, one row per participant: requests, tokens, $ and its
share of the total; on a subscription, the share of the plan limits). Planning ends with its own short
report: **Done** → **Reviews** → **Git** → **What next** → **Costs**.
More: [the final report](workflows.md#the-final-report) and [usage dashboard](usage-dashboard.md).

## 8. The handoff note

One format for tasks and sessions: goal, next action, state (✅ / ◐ / ⚠ / ⬜), files, decisions and why,
what did not work, open questions, how to check. At most 150 lines; updated, not rewritten. Planning has
no handoff: the plan's Next action says where the next conversation starts.
More: [what is in a handoff](workflows.md#what-is-in-a-handoff).

## 9. Verification

| Level | Who checks | Price |
|---|---|---|
| Gates only | the project's tests, linters, types, scanners | ≈$0.2 |
| Basic | one reviewer (Haiku) + up to 2 verifiers | ≈$0.25-0.5 |
| Standard | context map (Haiku), reviewer, bug hunter, architect, QA, test reviewer, up to 4 specialist groups + up to 5 verifiers, a judge | ≈$1.4-4.3 |
| Maximum | two bug hunters, QA and "try to break it", security always, three verifiers per critical finding, judge; mostly Opus | ≈$2.7-7.6 |

Agents run on Sonnet unless named otherwise above. These run on Opus: the security group (Standard and Maximum),
Standard's architect when the change has architecture signals (new files, files over the size
warning), and Standard's verifiers of bug-hunter and security findings. With "Allow Opus" off, every
one of them runs on Sonnet.

The plan already names a likely level; at the end keel proposes one from the actual change, which may
differ; you choose. Verifiers try to refute the serious findings, as many as the level's cap allows. A
finding QA proved by a failing command needs no verifier: keel runs that command again, and when it no
longer fails the finding becomes "unclear" (a command keel may not run again stays "proven", marked
"not run again"). Nice-to-fix items are shown as "not verified". After fixes
only the fixed items are checked again.

More: [verification](verification.md).

## 10. Delegation

For a large plan, keel offers to hand its steps to implementer agents, one per step, each on the model
the step needs (Haiku, Sonnet or Opus). The main conversation accepts each step after its tests.
More: [cost optimization](cost-optimization.md#5-delegation-thresholds) and
[under the hood](under-the-hood.md#delegation).

## 11. Git

Manual mode: keel runs no git step nobody asked for; it gives ready commands and a commit message.
Autonomous: branches, commits, updates, push; confirmed once per project on each machine. In both, the
branch you choose at a task's start and your own git steps are run. Secret files left out of keel's commits, no AI attribution, no force-push, never
a commit on main directly; a protected main → a pull request. Planning commits and pushes its files
only after your yes, in both modes.
More: [git in each mode](workflows.md#git-in-each-mode).

## 12. Other commands

`/keel:configure` sets up a project (quick or detailed) or this machine; `/keel:cleanup` moves
leftovers to keel's trash and back; `/keel:help` shows a table of the commands.
More: [commands](commands.md) and [settings](settings.md).

## 13. What runs in the background

In a set-up project: working standards in every conversation, a warning before Claude Code compacts the
conversation on its own, hints for the advisory skills, a check that blocks AI attribution in
commits and pull requests, and the checks that keep the lanes apart (while a conversation plans, its
changes stay in the draft). While keel works: the model of every keel agent, keel's own scripts without a permission
prompt, Claude Code's confirmation for the steps that are hard to undo, and the agents' cost ledger.
On the whole machine: the usage recording and the status line.
More: [under the hood](under-the-hood.md).
