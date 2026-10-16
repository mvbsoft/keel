# Getting started with keel

[Українська](getting-started.uk.md)

This walkthrough takes you from install to a finished task and a task that continues the next day.
keel is a Claude Code plugin (Claude Code is the platform today; other coding agents are planned). You
type a few commands, and keel does the planning, the checks and the bookkeeping around your work.

After a command you write what you want in plain words (`/keel:end-task hand off`); keel asks when it
is not sure. keel has two ways of working, tasks and sessions, and they never mix in one conversation:
see [two ways of working](workflows.md). Every command and its variants: [commands](commands.md).

## 1. Requirements

Claude Code, Node.js 22 or newer (`node --version`), git, and Windows, macOS or Linux. Details:
[install](install.md#requirements).

## 2. Install

In Claude Code: `/plugin marketplace add mvbsoft/keel`, then
`/plugin install keel@keel`. Claude Code asks for two settings (the language keel talks in, and whether
keel's agents may use Opus) and the install scope. keel acts only in projects you set up in the next
step. Terminal install, scopes, updates and removal: [install](install.md).

## 3. Set up a project: `/keel:configure`

Open your project in Claude Code and run:

```
/keel:configure
```

It first asks whether you set up this project or only this machine and, for a new project, whether you
want the **quick** setup (recommended, about six questions) or the **detailed** one. keel needs a git
repository: in a folder without one it offers `git init` and a first commit of the current state, and
stops if you say no. Then it works in these steps.

**What it scans.** Languages, package managers, monorepo parts, test, lint and type-check commands (from
CI, scripts, task runners, hooks, tool configs), existing AI rules (AGENTS.md, CLAUDE.md and similar),
and security scanners. Files that hold secrets are listed by path only: the scan never opens them, and Claude is told not to.

**What it asks.** Before each group of questions keel explains in a few plain lines what the
setting is, what it changes, an example, and how to change it later; then the options with pros and
cons and a recommendation. Each decision is its own question, so every option is in front of you; the
recommended one comes first, and you can always write your own answer. Ask for more and keel explains
the setting in full. Quick setup explains too; it only asks fewer questions.

- **Quick setup** asks only: the two languages (the one keel talks in and the one it writes into the
  repository), the gate commands (the commands that must pass) and one dry run of them, the git mode
  and the main branch, the recommended Claude Code settings (all, one by one, or none), and, when this machine
  has no usage settings yet, how it pays, the status line and the usage page. Every other value is
  keel's recommendation; the summary lists each one with the command that changes it, for example
  `/keel:configure verification`.
- **Detailed setup** goes through every section: languages, gates, security scanners, git,
  verification thresholds, code size and comments, stack plugins, documentation, moving from another
  notes system, Claude Code settings, and costs. Some sections can be skipped; the repository
  language, gates, git, thresholds, file sizes and comment level, and the documentation profile cannot
  be skipped, but you can accept the proposal with one answer.

The dry run skips any command that deploys, publishes, migrates, deletes, or discards uncommitted
work (such as `git restore`, `git stash` or `rm`); keel says why, and you can run it yourself.

**Your existing docs.** Quick setup keeps them as they are (the suggested documentation profile and
pattern). In detailed setup (documentation profiles 3 and 4 pick a pattern such as Diátaxis or
arc42), when the pattern you pick is not the one your docs follow now, keel says what would move
where and gives the cost as an estimate, with how it made it: the docs' characters ÷ 4 × 3 tokens
(read, write, check) at the Sonnet price, plus a Standard verification, as a range. The move runs as
an ordinary keel task: its own branch, a plan you approve, Haiku implementers for the moves, Sonnet
for content and links, then Standard verification. On your yes keel prepares the task file
`.keel/local/docs-migration.md`, and the setup summary tells you to run
`/keel:start-task .keel/local/docs-migration.md` first, so new docs land in the new places. When the
docs already follow the pattern, keel says there is nothing to move.

An abridged example of a quick setup:

```
keel: I found a Node project with npm. Gates: tests `npm test` (from package.json),
      lint `npm run lint` (from CI). Run them once to check that they work?
you:  Yes.
keel: Both passed. Git mode: who commits and pushes. Manual: I give a report and a
      ready commit message, you commit. Autonomous: I commit, update the branch from main,
      re-run the tests and push; I merge only when you ask. You can switch later with
      /keel:configure git.
      1. Git mode? Manual (recommended for a first project) / Autonomous
      2. Main branch? main (recommended, the repository's default) / another
you:  1 Autonomous, 2 main.
```

**What it writes.** Only after your yes, and it shows the files first:

| File | What |
|---|---|
| `.keel/config.json` | the project's settings (in git, shared with the team) |
| `.keel/profile.json` | the confirmed project profile (parts, triggers, secret files by path only) |
| `.keel/.gitignore` | keeps keel's temporary files out of git |

Optionally, each only after your yes: the Claude Code settings it recommends, for this project or for
the whole machine (a backup of each file is kept first), a status line, a short "Working with Claude
Code" section in your README, and a private usage page ([usage dashboard](usage-dashboard.md)).

**The setup commit.** keel's git steps never commit on the main branch, so at the end keel offers two
ways, in both git modes:

- commit the new `.keel/` files (and any README, CLAUDE.md, `.gitignore` or Claude Code settings file
  the setup changed) on the main branch yourself: keel gives the ready commands;
- or leave them uncommitted: the first `/keel:start-task` offers to take them into that task's branch,
  so they reach the main branch with its merge (useful when the main branch takes changes only through
  pull requests).

Then start the first task in a fresh conversation (`/clear`): keel's working standards load when a
conversation starts in a set-up project. When the project or `~/.claude` already had instructions of
its own (a long CLAUDE.md, rules, skills, commands, agents), keel advises running `/doctor
prompt-audit` once, and says why: two instructions that say opposite things make Claude pick one
arbitrarily, and outdated ones cost context in every conversation. That Claude Code command lists
contradictions, outdated instructions and references to missing files, each with a proposed edit, and
changes nothing until you agree. With no such instructions keel does not mention it. Every other keel
command except `/keel:help` and `/keel:usage` checks this setup first and offers to run it.

## 4. Your first task: `/keel:start-task`

```
/keel:start-task https://example.atlassian.net/browse/CAN-123
```

The source can be a link (Jira, Linear, Asana, a GitHub issue, Google Docs or any page), a key such as
`CAN-123`, a path to a file, or your own words. A link is read from outside (a connector, `gh` or a web
fetch; if that fails, keel asks you to paste the text). A key is searched inside, keel's tasks first,
then the repository, and keel asks "Is this it?"; `#123` alone is never read from GitHub, so give the
issue link. A file path is read. Your own words are the task text (keel also looks for similar
unfinished tasks). keel then:

1. **Retells the task:** the goal, how we know it is done, and what is out of scope. It checks in the
   code what the task takes for granted; if something does not hold, it says so with `file:line`.
   In the same message it asks "new or continuation?" (with no unfinished tasks: "this is a new one.
   Right?").
2. **Names it:** an id (`CAN-123`, or a short one such as `fix-reset-500`), a title and a one-line
   description, for you to accept or change.
3. **Asks** what it cannot find in the code, 1-3 questions at a time. When the goal is vague or there
   are several real ways to do it, it offers a brainstorm instead and starts it only with your yes.
4. **Plans.** A simple task (one module, no new public interface, no architectural choice, one to three
   files) gets a short plan in the chat and the question "Start?", with the branch to work in (below).
   A complex task gets **Plan Mode**: no file changes until you approve the plan. The plan names the
   files, where each new thing lives, what the framework or installed packages already provide, the
   tests, the documentation to update and the likely verification level (at the end keel proposes a
   level from the actual change, which may differ). A large plan (8 steps or 15 files by default) also
   proposes handing its steps to implementer agents; approving or changing the plan answers that, with
   no separate question ([cost optimization](cost-optimization.md#5-delegation-thresholds)). With the
   Claude Code setting "Yes, clear context" turned on during setup, approving the plan that way starts
   the work in a fresh conversation from the plan alone.
5. **Codes**, step by step, or through the implementer agents when the plan says so.

The "Start?" question (or the plan's first Execution step) also names the branch you are on and asks
where to work: a new branch `<id>-<short-name>` from the current one (recommended), the current branch,
or your own git steps (for example "switch to dev, update it, merge main into it, then branch
NEW-FEATURE"). On the main branch keel says plainly that the changes would stay there until git time, when keel
moves them to a new branch (it never commits on the main branch), and recommends a
new branch.

After your yes (or the plan's approval), keel runs your branch choice, in both git modes, because you
asked for it: your own steps one at a time, stopping on a conflict or a refusal; it never pushes or
merges into the main branch unless you said so. Then it creates the task folder `.keel/tasks/<id>/` on
that branch. Uncommitted changes stop it first: keel asks what to do with them, and when they are only
the setup files from `/keel:configure`, it offers to take them into this branch. On its own branch the
folder stays with the task until it is finished and never reaches the main branch. Starting a ticket
that is already an unfinished task makes keel offer to continue it instead.

## 5. Finish the task: `/keel:end-task`

```
/keel:end-task
```

keel asks what to do: 1) finish fully, 2) hand off for another conversation, 3) your own instruction. You
can say it right away: `/keel:end-task finish`. To finish, keel runs the gates (tests, linters, types,
scanners), proposes a verification level from the change and asks you to choose: gates only, Basic,
Standard, Maximum or none. You can also name the level: `/keel:end-task finish, level standard`.
The levels, their cost and what each one does are in [verification](verification.md).

Then it shows the report and asks what to fix. Before the report keel changes only two things: it acts
on the comment notes for the new code (adds a missing comment, shortens a long one) and fixes failing
gates that this change caused. Everything else waits for your answer. With no must-fix or should-fix
item keel does not ask and goes on (you can still ask for a nice-to-fix item). The layout of the report (example, shortened; the
wording and numbers are made up):

```
Level: Basic. Gates: tests passed, lint passed, gitleaks not installed (warning:
secrets were not scanned).

Must fix
1. [confirmed] Empty cart returns 500 (src/cart/total.js:42)
   What: the total of a cart with no items.
   Problem: items[0] is read before the length check, so an empty cart throws.
   How to fix: check the length first and return 0.
   If not fixed: the checkout page fails for new customers.
   My opinion: agree.
Should fix
2. [unclear] Discount is applied after tax (src/cart/discount.js:18)
   ...
Nice to fix (not verified): 3 rename `tmp` in total.js, 4 stale comment in discount.js
(details on request)
Verifiers refuted 2 findings.
```

You answer per item: fix, skip or not a problem ("fix all must, 4 skip" works). keel fixes the chosen
items one at a time, runs the gates again, and has a new verifier re-check each fixed must and should
item once. Then Claude Code itself asks "keel: task <id> is done? Its folder `.keel/tasks/<id>/` goes
to keel's trash.", every time, also when you said "finish fully". Yes → the
folder moves to keel's trash (on this machine, outside git) before the commit, so it never reaches the
main branch. In autonomous git, a git step that stops before the commit brings the folder back and the
task stays active, so you fix the cause and run `/keel:end-task` again; a step that stops after the
commit (the update or the push) leaves the removal committed: fix the cause and keel runs that step
again. In manual git, tell keel if you do not commit, and it brings the task back. No → the task simply
stays active on its branch, with no git step: keep working and run `/keel:end-task` again, or hand it off. After a yes,
git:

- **Manual git** (`git.mode`: `manual`, recommended for a first project): keel runs no git step you
  did not ask for. It gives you the changed files and a ready commit command, which includes the
  removal of the task folder.
- **Autonomous git**: keel commits (secret files are left out), updates the branch from main and re-runs
  the tests if new commits came in, and pushes the branch. It merges only when you asked for it, for
  example `/keel:end-task finish and merge into main`; Claude Code then shows its permission
  prompt for the merge. With `git.ask_before_merge: false` in autonomous mode confirmed on this machine, a finish
  merges without asking and without that prompt. Without that, the branch stays pushed for you
  to merge when ready. If the target branch is protected, keel offers to create a pull request
  instead. It never force-pushes or commits to main directly, and deletes a branch only in
  `/keel:tasks drop`. The first time, you
  confirm autonomous mode for this project on your machine, and again after its git settings change.

The end of the task is one final report: what was done, the verification table, git, what next and the
costs ([an example](workflows.md#the-final-report); how costs are counted:
[usage dashboard](usage-dashboard.md)). Run `/clear` before the next task: a new conversation costs
less than a long one, because every request re-reads the whole conversation.

## 6. Work that does not fit in one day

There are two ways, for two kinds of work. The page [two ways of working](workflows.md) lists every
case.

**A task you put down** (an interruption, another ticket came first). When you stop before the task is
done:

```
/keel:end-task hand off
```

Any words work: "park it", "prepare for the next conversation". keel checks the gates (a higher level only if
you name one), then updates the task file: the goal, the next action, the state of each step (done,
in progress, broken, not started) and where the work is, the files, decisions, what did not work, open
questions and how to check. The task gets `status: handed-off`. Git does a handoff instead of a finish:
no merge (autonomous: commit, push, switch back to the base branch). A task that works without its own
branch (in the main branch or its base), handed off with no git instruction, first gets a question, in
both git modes: a new branch from here (recommended), commit and push to the current branch (not on the main branch), no commit
for now (the changes stay uncommitted and move with you if you switch branches), or your own
instruction; keel runs the answer. Later, in any conversation:

```
/keel:start-task CAN-123
```

keel finds the unfinished task and asks "Is this a continuation of CAN-123?". On yes it switches to the
task's branch, reads the task file, tells you how far the main branch moved (and offers to bring it in)
and what changed since the handoff, runs the task's check command, reads the ticket again and says what
changed, then sums up and continues from the next action. `/keel:tasks` lists the unfinished tasks;
`/keel:tasks drop <id>` removes one with everything it left, each part after your yes.

**Long work** (a big plan built day after day in one direction). Start from a plan file or a
description:

```
/keel:start-session plan.md
```

keel writes the note `.keel/next-session.md` (goal, the plan, a "Later" list for things found along the
way, one first action), shows it and asks "Start?". On yes it creates the branch for this line of work
(manual git: it gives you `git switch -c <name>` and waits until you say it ran). The note is kept to
about 150 lines and never contains passwords, keys or tokens. Next time, in a new conversation:

```
/keel:start-session
```

keel reads the note, checks it against the repository (new commits on main, a different branch), tells
you in a few lines where things stand and names the first action. Add an instruction to change
how: `/keel:start-session only write the tests`.

End each day's work with:

```
/keel:end-session
```

It verifies the work of this session, committed or not (you pick the level), updates the note and
project memory, writes a session log, does git (autonomous: commit and push; no merge) and ends with
"Next time: ..." for you to agree or correct. Say what you want in words:
`/keel:end-session we continue tomorrow, prepare` runs only the gates, without asking for a level;
`/keel:end-session push and merge into main` also merges; `/keel:end-session the line is finished`
marks the line done and runs git as a finish (autonomous: commit, update from the main branch, push;
a merge only when you ask for it or `git.ask_before_merge` is off). With no note, `/keel:start-session`
looks for plans and TODOs and proposes what to take; it never starts a task by itself.

## 7. Clean up: `/keel:cleanup`

```
/keel:cleanup
```

keel finds temporary files, backups, caches and what an old notes system left, and moves only what you
pick to its trash, `.keel/local/trash/`; nothing is deleted. `/keel:cleanup restore` puts a move back.
Every variant: [commands](commands.md#keelcleanup).

## Next

- [Two ways of working](workflows.md): what to type in each situation.
- [Verification](verification.md): which level to choose.
- [Cost optimization](cost-optimization.md): how to spend less.
- [Settings](settings.md): change keel's defaults.
- [Under the hood](under-the-hood.md): what runs by itself and what keel stores.
