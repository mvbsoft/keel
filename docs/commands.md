# Commands

[Українська](commands.uk.md)

Every keel command, how to call it and what happens in each case. Only you start these commands; the
model never runs them on its own.

**How instructions work.** After the task, session and planning commands you write what you want in plain
words; there are no keyword arguments. `/keel:tasks` (`drop`), `/keel:cleanup` (`restore`,
`empty-trash`) and `/keel:configure` (`machine`, a section name) take the words shown below. keel works out what you mean, asks when it is not sure, and says in one line what
each action will do before it runs. A level word (`gates`, `basic`, `standard`, `maximum`,
`none`; `quick` means `basic`) picks the verification level when it stands alone or after "level" (`level standard`); the
levels: [verification](verification.md).

| Command | In short |
|---|---|
| [`/keel:configure`](#keelconfigure) | set up or change keel for this project or this machine |
| [`/keel:start-task`](#keelstart-task) | start a task, or continue one |
| [`/keel:end-task`](#keelend-task) | finish a task, or hand it off |
| [`/keel:tasks`](#keeltasks) | list, show or drop tasks |
| [`/keel:start-session`](#keelstart-session) | continue or start a long line of work |
| [`/keel:end-session`](#keelend-session) | end a session: verify, write the note, git |
| [`/keel:start-planning`](#keelstart-planning) | plan a feature: questions, decisions and short tickets, no code |
| [`/keel:end-planning`](#keelend-planning) | hand the plan over, or review it and export the tickets |
| [`/keel:cleanup`](#keelcleanup) | move leftovers to keel's trash, put them back, empty old trash |
| [`/keel:usage`](#keelusage) | the link to your private usage page, opened |
| [`/keel:usage-clear`](#keelusage-clear) | deletes all data on the usage page, after a warning and your yes |
| [`/keel:help`](#keelhelp) | a short table of the commands |

## `/keel:configure`

`/keel:configure [section | machine]`

Without `machine`, every run first asks: this project, or only this machine? keel needs a git
repository: in a folder without one, `/keel:configure` and every other command offer `git init` and a
first commit of the current state, and stop on a no.

| You type | keel does |
|---|---|
| `/keel:configure` in a new project | Asks: quick setup (recommended, about six questions) or detailed. Scans the project (languages, package managers, monorepo parts, test, lint and type commands, CI, existing AI rules, security scanners). **Quick** asks the two languages, the gate commands with one dry run, the git mode and main branch, the recommended Claude Code settings (all, one by one, or none), and the usage settings when this machine has none; every other value is the recommendation, and the summary names the section that changes it. **Detailed** goes through every section: languages, gates, git, verification thresholds, file sizes and comments, stack plugins, documentation, moving from another notes system, Claude Code settings, usage and costs. Each group of questions starts with a plain explanation (what the setting is, what it changes, an example); each decision is its own question with every option, the recommended one first. Quick keeps your existing docs as they are; detailed setup, when the docs pattern you pick differs from the one your docs follow, offers to prepare their move as a task ([your existing docs](getting-started.md#3-set-up-a-project-keelconfigure)). |
| `/keel:configure` in a configured project | Asks what to change: a section, a new scan, or everything. |
| `/keel:configure` when the config is out of date or broken | Repairs it: asks only about fields a newer keel added, or lists each problem with a proposed fix, and keeps everything else. |
| `/keel:configure machine` | Only this machine's settings, for every project: the conversation language, the machine values of the Claude Code settings, usage and costs. Writes no `.keel/` files. |
| `/keel:configure check` | Says, without changing any setting, whether the project changed since the last configure in ways its settings depend on, which sections to run again and why (each with the fact, for example a new `npm run test:e2e` keel does not run, or a main branch that is gone), and the command that runs only those. Package versions alone never count. One script does the comparison, so the answer costs about one reply. On a machine without a record of the last configure it rebuilds one from the commit of `.keel/` (a few seconds, once). [More](#keelconfigure-check). |
| `/keel:configure <section>[,<section>...]` | Only those sections again, in a configured project, in section order, and the files are written once at the end: `/keel:configure gates,git` (or `3,4`). Sections: `languages`, `scan`, `gates`, `git`, `verification`, `code`, `plugins`, `docs`, `migration`, `settings`, `usage`, `prices`. `prices` has an agent read the official pricing page and shows the differences; `migration` moves another notes system into keel. |

Nothing is written without your yes. A project setup writes `.keel/config.json`, `.keel/profile.json`
and `.keel/.gitignore`; with your yes also the Claude Code settings it recommends (each file backed up
first), a short "Working with Claude Code" section in your README, a status line and a private usage page.
At the end keel says how to commit the setup (on the main branch now, or with the first task:
[the setup commit](getting-started.md#3-set-up-a-project-keelconfigure)) and to start the first task
in a fresh conversation (`/clear`). When you agreed to move your docs, the summary names that task
first: `/keel:start-task .keel/local/docs-migration.md`. Every other command but `/keel:help` and `/keel:usage` checks this setup first and
offers to run it. Every setting: [settings](settings.md).

### `/keel:configure check`

Each configure run records, in `.keel/local/configure-snapshot.json` (outside git), what the sections it ran were based on (a run of some sections keeps the record of the others): the
parts of the project, their test, lint and type commands, the paths that call for a specialist review,
the AI instruction files, the frameworks, the files loaded into every session, other notes systems.
`check` compares the project with that record, and checks the main branch, ticket ids in the git
history, settings a newer keel recommends and this machine's usage settings. Each reason is either
**needed** (keel's settings no longer fit: a gate would be missed or fail, a part has no gates, tasks
cannot branch off the main branch) or **worth a look** (keel could do more, such as a checked plugin for
a new framework). For example:

```text
Needed: scan, gates, git. Worth a look: plugins, docs.
- gates: new command npm run test:e2e — keel does not run it before a task is finished
- git: the main branch "main" is gone — keel starts each task from it
- docs: CLAUDE.md has 260 lines (6 at the last configure) — every request reads it
Run: /keel:configure scan,gates,git   (with plugins,docs if you want those too)
```

Something the committed `.keel/profile.json` already lists (a part you added by hand, or what a teammate's later configure saw) is never new. A change of package versions alone is not a reason, and it no longer marks the profile as stale at the
start of other commands. When this machine has no record (a fresh clone), keel scans the project as it
was at the last commit of `.keel/` in a temporary worktree (git hooks off), keeps that as the record and
removes the worktree. With `.keel/` never committed it compares with `.keel/profile.json` and names the
checks it could not run.

## `/keel:start-task`

`/keel:start-task <link | key | your words>`

| You give | keel does |
|---|---|
| a link (Jira, Linear, Asana, GitHub, Google Docs, any page) | reads it from outside (a connector, `gh` or a web fetch); cannot → asks you to paste the text |
| a key or number (`CAN-123`, `#123`) | looks in keel's tasks, then in the planned tickets, then in the repository, and asks "Is this it?"; `#123` alone is never read from GitHub: give the issue link |
| `next ticket` (any words for it) | takes the planned ticket `/keel:tasks` names next, after a fetch |
| a file path | reads the file |
| your own words | takes them as the task and looks for similar unfinished tasks |
| nothing | shows the unfinished tasks, then the next planned ticket, and asks which to continue or what the new task is |

Then one combined question (the retell, "continuation of X?" or "new, right?", and a proposed name),
questions or a brainstorm offer, a plan with the branch to work in (a new branch from the current one,
recommended; the current branch; or your own git steps, which keel runs in both git modes), the task
folder, and the code. A task that turns out too big: keel offers to plan it as a feature instead,
while no code changed. Every case, including continuing a task and a planned ticket:
[ways of working](workflows.md#start-a-task-keelstart-task).

## `/keel:end-task`

`/keel:end-task [instruction]`

| You type | keel does |
|---|---|
| `/keel:end-task` | a menu: finish fully / hand off / your own instruction |
| `/keel:end-task finish` | verification (you pick the level), fixes, Claude Code's own confirmation "task <id> is done?" (every time; yes moves the folder to keel's trash, no keeps the task active), git, report |
| `/keel:end-task hand off` (any words: "park it", "prepare for the next conversation") | gates only, the task file updated, git, report. A task without its own branch and no git instruction: keel first asks where the work goes (a new branch, the current branch, no commit, or your instruction) and runs the answer |
| `/keel:end-task finish and merge into main` | as finish, then the [merge](workflows.md#merging-into-the-main-branch) (Claude Code asks first, unless you confirmed autonomous git on this machine and set `git.ask_before_merge: false`) |
| `/keel:end-task push` | asks: finish or hand off? |

Every case: [ways of working](workflows.md#end-a-task-keelend-task).

## `/keel:tasks`

`/keel:tasks [<id> | drop <id>]`

| You type | keel does |
|---|---|
| `/keel:tasks` | Lists the unfinished tasks of this working tree and of every branch (as of the last fetch): `<id> · <title>`, then Source, State (active or handed off, how long ago, steps done of total, branch), Next and Files; a "Base moved" line when the base branch got new commits since the handoff. A task handed off 30 days ago or more: keel offers to finish it or drop it. It ends with "Continue one with `/keel:start-task <id>`". Then a "Planned" block: each feature with planned tickets not done, every ticket's state, when the server data was fetched, and "Start the next one with `/keel:start-task <KEY>`"; a feature whose every ticket is `done` or `waiting for the feature merge` gets the offer of its [end](workflows.md#end-of-a-feature). |
| `/keel:tasks CAN-123` | Shows that task: goal, state, open questions and the next action, in 3-6 lines. It reads the task file also from another branch. |
| `/keel:tasks drop CAN-123` | Explains everything the task left: its folder, its branch (local, pushed), the commits not in the base branch, the changed files and the docs among them. Asks what to remove: everything or which parts. Then each removal on its own, the folder first, and Claude Code itself asks you to confirm the folder and the branch. The folder goes to keel's trash (`/keel:cleanup restore` brings it back); when its branch stays, the removal is committed on that branch. The branch is deleted locally (`git branch -D`) and, if it was pushed, on the remote; after a local delete keel prints the `git branch <name> <commit>` command that brings it back, and after a remote delete the remote branch's last commit and `git push <remote> <commit>:refs/heads/<name>`, which brings it back while that commit is still in your repository. The main branch and the current one are refused (switch away first). Changes already in the base branch are only reverted (`git revert`), never rewritten. In manual git keel gives the commit, branch and revert commands instead of running them. |

An example of the list: [ways of working](workflows.md#see-and-drop-tasks-keeltasks).

## `/keel:start-session`

`/keel:start-session [plan file | feature | link | description | how to continue]`

| You type | keel does |
|---|---|
| `/keel:start-session` with a note | a summary of where things stand and the first action |
| `/keel:start-session` with no note | looks for plans and TODOs and proposes what to take; with unfinished tasks it points to `/keel:tasks` and `/keel:start-task` |
| `/keel:start-session docs/plan.md` (or a link, or a description) | starts a new line of work: writes the note, shows it and asks "Start?", then creates the line's branch (manual git: gives `git switch -c <name>` and waits); when a note is open and this is about a different line of work, it first asks "continue the written line or start a new one?" |
| `/keel:start-session csv-export` (a feature with planned tickets) | starts a new line whose plan is the feature's open tickets, the next one first, on the feature branch |
| `/keel:start-session only write the tests today` | continues, following your instruction |

Every case: [ways of working](workflows.md#start-a-session-keelstart-session).

## `/keel:end-session`

`/keel:end-session [instruction]`

| You type | keel does |
|---|---|
| `/keel:end-session` | verification (you pick the level), the note for next time, git, "Next time: ..." to agree or correct |
| `/keel:end-session we continue tomorrow, prepare` | gates only, the note, git |
| `/keel:end-session push and merge into main` | verification, the note, then the push and the merge |
| `/keel:end-session the line is finished` | verification, the note marked done, then git as a finish: commit, update from the main branch, push (autonomous); a merge only when you ask for it or `git.ask_before_merge` is off |

Every case: [ways of working](workflows.md#end-a-session-keelend-session).

## `/keel:start-planning`

`/keel:start-planning [idea | link | file | feature name | what to continue, in your words]`

| You type | keel does |
|---|---|
| `/keel:start-planning` | lists the drafts (feature, state, open questions, tickets, last change, where) and asks which to continue or what the new feature is |
| `/keel:start-planning CSV export of invoices` (or a link, or a file) | a new feature: the retell, its size, a name, where its tasks merge, then one question at a time |
| `/keel:start-planning csv-export` (or "continue the CSV export") | continues that draft from its Next action; an exported feature reopens its tickets for editing |

The first run in a project asks the tickets' language and where the draft lives (this machine or the
repository). No code: the conversation writes only the draft. Every case:
[ways of working](workflows.md#planning).

## `/keel:end-planning`

`/keel:end-planning [instruction]`

| You type | keel does |
|---|---|
| `/keel:end-planning we continue tomorrow` | hand over: reviews of the new and changed tickets (never reviewed, or changed since their review), then the open questions and the Next action written for the next conversation |
| `/keel:end-planning final review and export` | the gates, the ticket reviews and one plan review, then, after your yes, the export of the tickets into the feature folder |
| `/keel:end-planning` | open questions or structure problems → hand over, with the reason; otherwise asks "Final review and export, or hand over?" |

Planning files are committed and pushed only after your yes and Claude Code's own prompt. The report:
Done, Reviews, Git, What next, Costs. Every case: [ways of working](workflows.md#end-keelend-planning).

## `/keel:cleanup`

`/keel:cleanup [restore [batch] | empty-trash]`

| You type | keel does |
|---|---|
| `/keel:cleanup` | Finds temporary files, backups, caches and what an old notes system left, and shows them in three groups: **safe** (preselected), **check** and **do not touch** (both only by number; a do-not-touch item gets a second question about what may break). Moves only what you pick to `.keel/local/trash/<batch>/`. If the project's tests are affected, it runs them; red → it puts the batch back by itself and runs them again. Reports what moved, its size, and how to undo. Nothing found → says so. |
| `/keel:cleanup restore` | Puts the newest batch back. |
| `/keel:cleanup restore <batch>` | Puts that batch back (also a dropped task's folder). |
| `/keel:cleanup empty-trash` | Says what would be deleted for good (by default batches 30 days old or more, `cleanup.trash_max_age_days`; or one batch you name per run; or all); Claude Code itself asks you to confirm, naming which (the batches of that age, the one batch, or all), then it deletes. |

Only `empty-trash` deletes files for good; the trash is never emptied by itself. (`/keel:tasks drop`
also deletes a task's branch, after your confirmation.) Secret files are never moved or opened, nor is
a folder that holds one: keel refuses it and names the secret file. After
a task or session keel reminds you of `/keel:cleanup` only when enough leftovers have collected.

## `/keel:usage`

`/keel:usage` gives the link to this machine's private ["keel usage" page](usage-dashboard.md) and
opens it. It works in any project, set up or not. No page on this machine yet → it says so and points
to `/keel:configure usage`.

## `/keel:usage-clear`

`/keel:usage-clear` deletes all data on the usage page: every machine's day documents (hours and
sessions), the machine documents and the calibration. Before anything is deleted it shows a warning: the
period (first and last day), how many sessions and dollars, the machines, the size, and what it affects
(the page is empty until the next end step; it is gone for everyone the page is shared with; it cannot be
undone). Only after your explicit yes it deletes, then says what was deleted. This machine's local logs,
limit records and calibration stay, and so do the page itself and its language; the next sync sends only
what happens after the clear. Document contents never pass through the conversation: a clear is three
reads and one write per 50 documents. [More](usage-dashboard.md#clearing-the-page).

## `/keel:help`

`/keel:help` shows a short table of the commands (what each does, how to run it, one example) in the
conversation language, then two lines: what tasks, sessions and planning are, and that one conversation
keeps to one of them. It runs and reads nothing.
