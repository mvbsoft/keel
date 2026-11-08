# Commands

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
| [`/keel:feature-page`](#keelfeature-page) | a private page of a planned feature in your claude.ai account, to read |
| [`/keel:cleanup`](#keelcleanup) | move leftovers to keel's trash, put them back, empty old trash |
| [`/keel:usage`](#keelusage) | the link to your private usage page, opened; `on` / `off` switch this machine's sync; `clear` deletes this machine's data on the page, after a warning and your yes |
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
| `/keel:configure <section>[,<section>...]` | Only those sections again, in a configured project, in section order, and the files are written once at the end: `/keel:configure gates,git` (or `3,4`). Sections: `languages`, `scan`, `gates`, `git`, `verification`, `code`, `plugins`, `docs`, `migration`, `settings`, `usage`, `prices`; `planning` asks only the planning settings (ticket prefix, where the tickets live, their language). `prices` has an agent read the official pricing page and shows the differences; `migration` moves another notes system into keel. |

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
in a new chat with a brief of what was found, or here; with code already changed it advises by what
is done. Every case, including continuing a task and a planned ticket:
[ways of working](workflows.md#start-a-task-keelstart-task).

## `/keel:end-task`

`/keel:end-task [instruction]`

| You type | keel does |
|---|---|
| `/keel:end-task` | a menu: finish fully / hand off / your own instruction |
| `/keel:end-task finish` | verification (you pick the level), fixes, Claude Code's own confirmation "task <id> is done?" (every time; yes moves the folder to keel's trash, no keeps the task active), git, report |
| `/keel:end-task hand off` (any words: "park it", "prepare for the next conversation") | gates only, the task file updated, git, report. A task without its own branch and no git instruction: the work goes to a new branch of its own, committed as work in progress and pushed (your git instruction wins) |
| `/keel:end-task finish and merge into main` | as finish, then the [merge](workflows.md#merging-into-the-main-branch) (Claude Code asks first, unless you confirmed autonomous git on this machine and set `git.ask_before_merge: false`) |
| `/keel:end-task push` | asks: finish or hand off? |

Every case: [ways of working](workflows.md#end-a-task-keelend-task).

## `/keel:tasks`

`/keel:tasks [<id> | drop <id>]`

| You type | keel does |
|---|---|
| `/keel:tasks` | Lists the unfinished tasks of this working tree and of every branch (as of the last fetch): `<id> · <title>`, then Source, State (active or handed off, how long ago, steps done of total, branch), Next and Files; a "Base moved" line when the base branch got new commits since the handoff. A task handed off 30 days ago or more: keel offers to finish it or drop it. It ends with "Continue one with `/keel:start-task <id>`". Then a "Planned" block: each feature with planned tickets not done, every ticket's state, when the server data was fetched, and "Start the next one with `/keel:start-task <KEY>`"; a feature whose every ticket is `done` or `waiting for the feature merge` gets the offer of its [end](planning.md#end-of-a-feature). A feature on several repositories then gets an "Other repositories" block: its tickets there with their states, or, for a repository not on this machine, the overview's list with the state unknown; when the feature's overview differs between repositories, keel says so in one line and offers to align it ([tickets of linked repositories](planning.md#ticket-states)). |
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
| `/keel:start-planning CSV export of invoices` (or a link, or a file) | a new feature: the retell, its size, a name, where its tasks merge; told in a line or two or large, an offer to gather first (the project map, with its price); then one question at a time |
| `/keel:start-planning .keel/local/plans/briefs/<name>-brief.md` | a new feature from the brief `/keel:start-task` wrote for a task too big for one: its content goes into the plan, the brief to keel's trash, and planning starts from its open questions without asking again what it settles |
| `/keel:start-planning csv-export` (or "continue the CSV export") | continues that draft from its Next action; an exported feature reopens its tickets for editing |

Without the project's planning settings (`/keel:configure planning`) the first run stops before any
question; then it asks where the draft lives (this machine or the repository). No code: the conversation writes only the draft. Every case:
[planning](planning.md).

## `/keel:end-planning`

`/keel:end-planning [instruction]`

| You type | keel does |
|---|---|
| `/keel:end-planning we continue tomorrow` | hand over: reviews of the new and changed tickets (never reviewed, or changed since their review), then the open questions and the Next action written for the next conversation |
| `/keel:end-planning final review and export` | the gates, the ticket reviews and one plan review, then, after your yes, the export of the tickets into the feature folder |
| `/keel:end-planning` | open questions or structure problems → hand over, with the reason; otherwise asks "Final review and export, or hand over?" |

Planning files are committed and pushed only after your yes and Claude Code's own prompt. The report:
Done, Reviews, Git, What next, Costs. Every case: [planning](planning.md#end-keelend-planning).

## `/keel:feature-page`

`/keel:feature-page [feature] [--lang <code>]`

| You type | keel does |
|---|---|
| `/keel:feature-page csv-export` | makes the page of the feature `csv-export`, or updates the one made before, and gives its link |
| `/keel:feature-page` | the same for the feature of the current branch; none or several → asks which |
| `/keel:feature-page csv-export --lang en` | the same page in English from now on |

The page is private, in your claude.ai account. On a computer it has two columns. On the left: the
feature (its projects and the commits it is a snapshot of open on a click), the overview in short
with buttons for its sections, decisions, terms and research; what is in progress now (else what is
next), with a bar and the tickets' count by state; and the list of tickets by repository. On the
right: the chosen ticket, the one in progress at first, its sections as blocks: In plain words with
the goal, the trap, Done when, How to check, Boundaries with Out of scope, Where to look, Why with the
decisions it names, and Dependencies with their states (a click opens that ticket). Each block has an
ⓘ whose hint says what it holds; "MD file" shows the file as GitHub draws it, diagrams included. On
a phone the list comes first and a ticket opens over it. A link ending in `#API-122` opens that
ticket.

The texts are those of the md files, which stay the source; keel puts them into a fixed template and
the page draws the markdown and code itself (libraries from cdnjs), so every feature looks the same.
A feature on several repositories also shows the other repositories' tickets: read in their folders on
this machine, else from the overview with the state unknown and a "not on this machine" mark; a
dependency on such a ticket is unknown too. A ticket of this repository whose file is only on another
branch is read from that branch and marked "only on branch <branch>". A dependency shows its ticket's own state and, when it
holds the ticket back or was merged in by hand, where its code is: "ready in the <branch> feature
branch, not in main" (on hover: wait for that merge, or pull it into your branch with `git merge`),
"ready in the <branch> ticket branch", or "already in your branch". The page shows git as it was when
it was built or updated: it does not update itself. keel runs `git fetch` first, so the states are
fresh; when the fetch fails (no network, no access, or no answer within 60 s), the page is still made, keel says so, and the
feature card marks the states as of the last fetch. Other repositories of the feature are read as they
are on this machine, without a fetch. Its feature card says when it was built and gives
the command that updates it, `/keel:feature-page <feature>`, with a Copy button. keel publishes it with
the `Artifact` tool.

**Language.** `--lang`, else the language the page already has, else your conversation language.
The labels come from keel's language files (English and Ukrainian today; English for another
language). When the page's language is not the tickets', Claude translates the texts on the page only,
never the md files; the page keeps each translation with a fingerprint of its original, so the next
update translates only what changed. Translating costs tokens; the same language costs nothing extra.

The page is titled `[API, WEB] - <the overview's heading> (3f9a2c1b)`: the ticket prefixes of the
repositories with tickets, the heading (cut to 80 characters) and the feature's code. The code is
random, made once with the draft (`page:` in `plan.md`) and written by the export into every ticket
of the feature, so it travels with the feature in git: every machine and every repository of the
feature finds the same page, whether or not the other repositories are on that machine or have a
remote, and two projects with the same prefix and feature name never share a page. keel looks the
page up among your latest ones (200, or 500 with the artifact server's tools) by the code at the end
of its title and updates it, renaming it when the heading or the repositories changed. A feature
exported before the code gets one, written into its tickets in this working tree: commit and push
them. Not found while you have more → keel asks for its link or makes a new one. A path of this machine in the feature's files (a ticket, the overview, a report) is never
published: keel names each one and stops; write it from the repository's root. Nothing is kept on this machine: the
page is built in `.keel/local/tmp/` and removed after publishing. It needs Claude Code signed in to a
claude.ai account; with an API key there is no page. Each run costs about $0.1-0.4 (an estimate:
reading the page and the generated file); the run's own cost is the last line of its report.

## `/keel:cleanup`

`/keel:cleanup [restore [batch] | empty-trash]`

| You type | keel does |
|---|---|
| `/keel:cleanup` | Finds temporary files, backups, caches and what an old notes system left, and shows them in three groups: **safe** (preselected), **check** and **do not touch** (both only by number; a do-not-touch item gets a second question about what may break). Moves only what you pick to `.keel/local/trash/<batch>/`. If the project's tests are affected, it runs them; red → it puts the batch back by itself and runs them again. Reports what moved, its size, and how to undo. Nothing found → says so. |
| `/keel:cleanup restore` | Puts back the newest batch this folder moved. |
| `/keel:cleanup restore <batch>` | Puts that batch back (also a dropped task's folder). |
| `/keel:cleanup empty-trash` | Says what would be deleted for good (by default batches 30 days old or more, `cleanup.trash_max_age_days`; or one batch you name per run; or all); Claude Code itself asks you to confirm, naming which (the batches of that age, the one batch, or all), then it deletes. |

Only `empty-trash` deletes files for good; the trash is never emptied by itself. (`/keel:tasks drop`
also deletes a task's branch, after your confirmation.) Secret files are never moved or opened, nor is
a folder that holds one: keel refuses it and names the secret file. After
a task or session keel reminds you of `/keel:cleanup` only when enough leftovers have collected.

## `/keel:usage`

`/keel:usage` gives the link to this machine's private ["keel usage" page](usage-dashboard.md) and
opens it. It works in any project, set up or not. No page on this machine yet → it says so and points
to `/keel:usage on`, which sets one up. A page made by an older keel → it also says that `/keel:configure usage`
[updates it](usage-dashboard.md#updating-the-page) and keeps its data.

`/keel:usage off` stops this machine's sync to the page: the page and its data stay, and the end reports
still show the costs. `/keel:usage on` sends what Claude Code's logs still hold of the time it was off (30 days by
default), or sets the page up if there is none. With an API key only there is no usage page (it lives in a claude.ai account), and the command says
so. [More](usage-dashboard.md#turning-the-sync-on-and-off).

`/keel:usage clear` deletes **this machine's** data on the usage page: its day, machine and calibration
documents; other machines' data stays. To clear the whole page, run it on every machine. Before anything
is deleted it shows a warning: its days (first to last), sessions and their dollars, all usage, the size
in KB and the number of delete calls in the chat (each needs your approval; the end report shows the real
cost). It also says what it affects: this machine starts over from the next end step; it cannot be
undone. Only after your explicit yes it deletes, then says what was deleted. This machine's local logs,
limit records and calibration stay, and so do the page itself and its language; the machine then sends
only what happens from the clear on. Document contents never pass through the conversation
([clearing the page](usage-dashboard.md#clearing-the-page)).

## `/keel:help`

`/keel:help` shows a short table of the commands (what each does, how to run it, one example) in the
conversation language, then two lines: what tasks, sessions and planning are, and that one conversation
keeps to one of them. It runs and reads nothing.
