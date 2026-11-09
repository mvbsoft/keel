# Planning

Planning is the third lane of work, next to tasks and sessions ([ways of working](workflows.md)): a
feature that needs several tasks is talked through before any code and ends as short tickets.

A *feature* is one finished capability of the product that one sentence explains (a connection to
S3). Planning turns it into short tickets in a conversation with you, before any code: the
conversation writes only the draft, and keel's hook refuses changes to other project files
([what is guaranteed and what is not](behavior.md#planning)). One conversation plans one feature.

## Start: `/keel:start-planning`

| You type | keel does |
|---|---|
| `/keel:start-planning` the first time in a project | Without the project's planning settings (the ticket prefix and where the tickets live, `/keel:configure planning`) it stops before any question and says so. Then one question: where the draft lives: on this machine (default, outside git) or in the repository (a `tickets/` folder, or a ticket folder the project already has; colleagues see it through git). Say "draft in the repo" at any start to change it. |
| `/keel:start-planning` | Lists the drafts (feature, state, open questions, tickets, last change, where) and asks which to continue or what the new feature is. |
| `/keel:start-planning csv-export` | Continues that draft: its open questions, the review findings without a decision, which files its tickets name changed since, a summary in 3-6 lines and the Next action. |
| `/keel:start-planning continue the CSV export` | Looks for the words in the drafts' names and In plain words: one match → "Continue `csv-export`?"; several or none → the list. |
| `/keel:start-planning <idea, link or file>` | A new feature (below). |
| `/keel:start-planning .keel/local/plans/briefs/<name>-brief.md` | A new feature from a brief of `/keel:start-task` ([too big for a task](workflows.md#start-a-planned-ticket)): its content goes into the plan, the brief to keel's trash; planning starts from its open questions. |

**A new feature.** keel says once that it advises Opus for planning (the model stays your choice,
`/model`), reads the source as `/keel:start-task` reads a link, retells the goal, who gains and what
is out, and checks in the code that what the feature relies on is there. Then:

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

**The work.** One question per message, answerable in a line; options come with a recommendation.
keel writes the draft first and then replies, so the answer and the next question are in its last
message.
keel keeps `plan.md` true as you go: In plain words (the whole feature for a person), Level, Decisions (`D1. decision - why`), Contract, Out of scope, Design sketch,
Terms, What was gathered, Open questions (`Q1. question - what depends on it`; an answered Q becomes a
D), Tickets, Next action. Tickets are written at once, their sections always in this
order: In plain words (the whole task in plain words, without code or paths but with a diagram or a table where it helps, as long as it needs),
Example (may go), Goal, Acceptance criteria (a `- [ ]` list, each item a sentence "situation → what
we see" with concrete people and values), How to check, Boundaries (`- always:`, `- ask first:`,
`- never:`, each with why in a few words), Correct the priors (the obvious wrong way; may go), Where
to look (`file:line`), Out of scope, Why, Dependencies. Every section is written for someone who has
not seen the feature: short, but in whole sentences, and a D or T number comes with its words. The
technical part, all but In plain words and Example, stays short: 150-500 words, one goal, no
implementation steps. The ticket reviewer checks that a newcomer understands each section. In the draft they are
`T1`, `T2`...; a T-number is never reused. More than about 15 tickets → keel offers to split the
feature. keel looks up code facts itself; a pricier model or web research only when you ask or say
yes to an offer of it.

**Pictures in In plain words.** Where a picture explains the work better than words, In plain words of
the plan and of a ticket has one, right after the text it shows and after a sentence naming it: a `mermaid` diagram for steps
between people and parts of the system (`sequenceDiagram`), states (`stateDiagram-v2`) or branches
(`flowchart`), a markdown table for options side by side. One simple action gets none. The diagrams
and tables pass `plans.js check` and go into the feature overview as they are; In plain words has no
word limit, so they never count against one. The ticket reviewer notes a process told only in words.

**Gathering before the questions.** When the feature is told in a line or two, or is large, keel first
offers what to look up, with the price said as an estimate, all on one yes: the project map, a helper
on Haiku (cheap) that finds where the feature meets the code: the stack, the modules and data it
touches, what it can reuse; and, when the feature leans on outside know-how (a library, a protocol, an
outside service), how others do it: the researcher, a helper on Sonnet that reads the web (dearer).
Take all, some or none (then the questions start at once, and keel does not search the code
in its place). What it finds goes into `plan.md`, What
was gathered, short and with `file:line`; the questions after it are
concrete ("`chat/` already has a WebSocket: send through it, or a channel of its own?"), and none asks
what the gathered facts or the project's docs already answer. The next conversation on the draft
reads that section instead of searching again. The facts the tickets need go into their Where to look
and Boundaries, the conclusions into Decisions; What was gathered is not exported and goes to the
trash with the draft.

**Decisions.** Before planning new code keel looks for what exists, in this order, and stops at the
first good answer: the project's code, its installed packages, the framework and the platform, a small
living package, then writing it ourselves. The first three are searches in files; for a package keel
offers the researcher on your yes, which reads registries (npm, Packagist, deps.dev) for at most 2
packages, and shows a table: size, dependencies, license, releases, known vulnerabilities, each with
its source and date, "write it ourselves" always among them, and a recommendation. An elementary task
("1d 2h" to seconds) gets one simple answer: a short function, no levels; so does a task with none of
the reasons below. A feature with a reason for
more (several variants today, a database or network, a public API, money, access, security, a scale
you gave in numbers, or simply a large feature) gets 2-5 levels, each with what is built, about how
many tickets, the cost and risk now and how painful adding it later is; keel recommends one, you
choose, and you can ask for any level it did not offer. The level goes into Level so that someone who
has not seen the levels follows it: which of how many and what the scale means, what this level builds,
and what is put off and why. The design fits
today's acceptance criteria: a request for everything at once gets a first working slice to grow,
each ticket is a thin slice through the layers it needs, and a new dependency, datastore, protocol,
module boundary or public contract comes with an offer of a short ADR. Before writing the
tickets keel looks at the plan as three colleagues would (the product and its users, the architect,
operations and security) and offers what may be missing; you decide each. A research report goes into
the draft's `research/<topic>.md`, and a ticket that follows it names it.

**Abandon a draft**: say so in the planning conversation; after your yes the plan is `abandoned`. A
draft on this machine goes to keel's trash (`/keel:cleanup` restores it); one in the repository stays
until you remove it.

## A feature on several repositories

One conversation plans a feature that also needs work in other repositories on this machine, such as
a new event in `api` and a badge in `web`; each ticket is for one repository only.

- **Which projects.** After checking the premise, when the feature shows signs of another repository
  (an API, event or format others use; a front or an app) or you name one, keel asks: "Besides `api`,
  it looks like it touches `web`, `admin`. Right?" [yes, all] [only some] [other: I give a path] [no].
  The candidates come from `plans.js repos`: the repos map ([settings](settings.md#planning-settings))
  and the git repositories next to this project (never this project or another worktree of it), each
  with its planning prefix. A new folder goes into the map with its prefix; a repository whose prefix
  is not set yet gets one you confirm now (keel proposes 3-4 letters from its name), and that
  repository must set the same one before the tickets go there. The plan records its repositories in
  `repos: [API, WEB]` (`plans.js set <f> --repos "WEB"`).
- **Their rules and code.** The gathering offer always includes each other repository: a helper on
  Haiku reads its `CLAUDE.md`, `AGENTS.md`, skills and code by its absolute folder, and its notes go
  into What was gathered under `### <PREFIX>`. Claude Code may ask to allow reads in another folder;
  `/add-dir <folder>` lets the conversation read it without asking.
- **Its tickets.** `plans.js ticket <f> --title "..." --repo WEB` marks a ticket `repo: WEB`. The check
  looks for its Where to look in that repository's folder; a folder not on this machine is a note,
  "not checked", never a problem. The reviewers get the ticket's repository folder. `stale` compares
  each repository's tickets with its own commit (`after_commit_repos`, recorded by `plans.js set <f>
  --after-commit` when you hand over).
- **A repository not on this machine.** keel says what it found ("a front is needed, but no
  repository was found") and offers: a repository that may be it, to confirm; stubs; leave it out; or
  your own way. A stub is a ticket of its own type (`plans.js ticket <f> --title "..." --stub ADM`,
  front matter `type: stub`, `repo: ADM`) with only what can be written without that repository's
  code: no Boundaries, Correct the priors or Where to look, and How to check in manual steps. Tickets
  name it in `depends_on` like any other; its state is never read, so it never holds a ticket back, and
  the plan reviewer counts its behaviour as covered. Export puts it into this project's feature folder
  as `ADM-S1-<slug>.md` (`S` and a number counted per prefix, past every `ADM-S<n>` this project's
  folders and git history have), listed in the overview's Tickets; the feature page shows it with
  state unknown and a "stub" mark, and a dependency on it as unknown. This project needs at least one
  ticket of its own: a plan of stubs only is not exported. While a stub is left, the feature is not
  complete: `plans.js done` names the stubs left and `plans.js drop` refuses. A plan from before stubs
  were tickets has a `## Stubs` section; check stops on it until each stub is a ticket.
- **When that repository is here.** `plans.js check` (and `plans.js tickets <f>` for an exported
  feature) says so, and keel offers to turn the stub into a full ticket: `plans.js ticket <f>
  --from-stub T2` in a draft (the same T, the repository added to the plan's `repos:`), or
  `--from-stub ADM-S1` in an exported feature (the ticket goes into that repository's feature folder
  with its next key, `ADM-7`, and `replaces: ADM-S1`; a folder of the feature there already, from an
  earlier stub or a ticket of the plan, takes it beside its tickets; the overviews list it and the stub
  goes to keel's trash first, so of two runs at once only one converts). Tickets that name `ADM-S1`
  are not edited: a dependency on a stub key reads the ticket of the same feature that replaces it
  (another feature's or project's `ADM-S1` is not it). Once the stub has left and that repository's
  clone has no such ticket yet (not pulled since), the dependency is not found and holds the ticket
  back. keel then studies that repository, with the stub as the start, for the sections
  it lacked; until they are written they are placeholders and the check stops on them.
- **Export** puts each repository's tickets into that repository, by its own planning settings: its
  prefix and its own next number after its own `git fetch` (`API-1` here, `WEB-10` there), its ticket
  place, and its main branch as `merge_into` (the plan's `merge_into` when you changed it). All or
  nothing across the repositories: nothing is written until every one is checked. Each repository gets
  the same `README.md` overview, already from 1 ticket: `repos: [API, WEB]`, every repository's tickets
  and stubs, and `## Parts` from the Design sketch (`### web (WEB)`). `research/`: this
  project gets every report, another repository the reports its tickets or the overview name.
- **Another repository must be ready**: on the feature branch with a clean tree, its prefix set, no
  keel task active there, no folder of the feature yet (tickets on that machine only: just the prefix
  and the folder). keel does not export while one is not and says why, per repository. On its main
  branch with a clean tree keel offers to create (or switch to) the feature branch there on your yes;
  "wait, I prepare it" keeps the plan `ready` (later `/keel:start-planning <f>`, then
  `/keel:end-planning`); uncommitted changes or another branch may stay on your word
  (`--as-is "WEB"`), noted in the report. A repository in `repos:` without a ticket is refused: give it
  one, or leave it out.
- **Commit and push** are asked once for all repositories, and Claude Code then asks for each one,
  naming it. The commit checks the keys in every repository: a key taken meanwhile gets a new number
  in every repository's files. A failed push does not stop the others; after a network or access
  failure the report names the command to run again, after a refusal (behind, a protected branch)
  what to do first.

## End: `/keel:end-planning`

| You type | keel does |
|---|---|
| `/keel:end-planning we continue tomorrow` (any words for "later") | **Hands over**: reviews only the tickets never reviewed or changed since their review; each finding is fixed now or becomes a Q; `plan.md` gets the open questions and the Next action. A draft in the repository: the commit questions (below). |
| `/keel:end-planning final review and export` | **Final**: below. |
| `/keel:end-planning` | Open questions or structure problems → hands over, with the reason in one line; otherwise asks "Final review and export, or hand over?". |

**Final.** 1) The gates: no open questions, a clean structure check (the `# [id] title` heading, each section
once and in its order, headings inside code blocks being text, the three Boundaries labels, acceptance criteria as a `- [ ]` list, no TBD, the named files exist, no path of this machine in the plan, a ticket or a report (`C:\…`, `/home/<user>/…`, `/Users/<user>/…`, `/mnt/c/…`, the project or a neighbouring repository by its folder: paths go from the repository's root),
dependencies without cycles; style is the ticket reviewer's advice and never blocks), and a decision for every finding; else keel
shows what blocks and offers to hand over. 2) Ticket reviews of the tickets not reviewed as they are
(`keel:ticket-reviewer`, up to 4 tickets per call), then one review of the whole plan
(`keel:plan-reviewer`, which also checks that each behaviour the plan promises is an acceptance
criterion of exactly one ticket, a stub's behaviour counted as covered), both on Sonnet; a ticket of
another repository is reviewed in that repository's folder. You decide each finding: fix, defer to a Q, or reject with a
reason; decisions go into `reviews/` and are not raised again. Fixed tickets are reviewed again, at
most 2 rounds per `/keel:end-planning`; a failed review is named as failed, never as "no findings".
3) The plan becomes `ready` (any later change makes it a draft again), then "Export the <n> tickets
now?"; no → it stays `ready`, to export later with `/keel:start-planning <f>`, then
`/keel:end-planning`.

Every end, also after a no, frees the conversation from planning. The report: **Done**, **Reviews**,
**Git**, **What next** (the Next action, or "a ticket starts with `/keel:start-task <KEY>`"),
**Costs**.

## Export

- **Where**: the project's setting, asked by `/keel:configure` (`planning.tickets` and
  `planning.tickets_dir` in `.keel/config.json`, [settings](settings.md#planning-settings)): the
  repository (a ticket folder the project has, else `tickets/`; the feature lands in
  `<folder>/<feature>/`) or this machine only (keel says "These tickets are seen on this machine
  only"). A draft in the repository exports only there: with `pc` the export is refused and names
  both ways out (`plans.js settings set --draft pc` for this machine, or `/keel:configure planning` for
  the team). Never used: hidden folders, `handoff/` and `handoffs/` (another notes system),
  `docs/plans`, a place outside the project. A plan on several repositories: each repository's own
  setting ([above](#a-feature-on-several-repositories)).
- **Names**: `PROJ-123-add-csv-export.md` with the title `# [PROJ-123] Add CSV export`. The prefix is
  `planning.ticket_prefix`, one per repository and the same for the team; `/keel:configure` proposes
  the tracker's prefix from git history, else 3-4 capital letters from the repository's name.
  Without these settings the export is refused and names `/keel:configure planning`.
- **Shared numbers**: after a `git fetch`, the next number is 1 + the highest of that prefix in commit
  messages, ticket file names on every branch, branch names and ticket folders (exact: `PROJ-10` is
  not `PROJ-101`). The commit checks again: a key another ticket file took meanwhile gets a new number
  while ours is on no remote yet (a published one is refused, to settle by hand); the push checks once
  more and refuses.
- **All or nothing**: every key first, `T1`... replaced everywhere (dependencies, links, the
  overview), the files written into a temporary folder and renamed once. A failed run leaves no
  feature folder and the plan `ready`.
- **After**: the feature folder is the one source: the tickets (`type: ticket`, `key`, `status: todo`,
  `feature`, `branch`, `merge_into`, `depends_on`) and, from 2 tickets, a `README.md` overview: the
  plan's In plain words, Level, Decisions, Contract, Out of scope and Terms that have text, and a
  Tickets list keel builds (each ticket's key, title and repository, the last part of the remote's URL
  or else the project folder's name; no states, each ticket carries its own), and the research
  reports in `research/`. A draft on this machine goes to keel's trash; one in the repository leaves with the commit of the tickets.
- **Git**: "Commit the planning files?", then "Push `<branch>`?", each on its own, and Claude Code asks
  too, every time. Never on the main branch; planning never opens a pull request.

## Ticket states

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
feature merge in the same feature, or already in its own feature branch). Marks after the state: `reverted` (done on a branch merged once, then taken back),
`stale` (the branch behind the state has no commit for 30 days), `duplicate key` (several files). Each
line names the branch, author and age behind it. Branches without a commit in 30 days are not read,
except each ticket's own `branch` and `merge_into`. Tickets on this machine: `done` in the file,
`in progress` by a task or the note here, else `to do`.

**Where a dependency's code is.** For a `to do` ticket, `/keel:start-task` and the key view
(`plans.js tickets <KEY>`) say where each dependency that holds it back is, read from git on every run,
and the feature list marks it (`PROJ-1 only in feature branch chat`):

| The dependency's code | keel says | The ticket |
|---|---|---|
| already in this ticket's feature branch (through main, or merged in by hand) | `PROJ-1 is in your feature branch notify: PROJ-5 can start` | may start |
| only in another feature's branch | `PROJ-1 is ready in feature branch chat, not in main. To start PROJ-5: wait for its merge into main, or pull it into notify: git merge chat` | you decide |
| only in its ticket branch | `PROJ-2 is ready in ticket branch PROJ-2-read, not in feature branch chat yet: wait for that merge` | waits |
| in progress, or not started | `PROJ-3 is in progress (branch PROJ-3-edit, ...): wait for it`, `PROJ-4 is not started: wait for it` | waits |

A dependency in another repository cannot be merged in from here: its line names that repository and
says only to wait.

**Dependencies in other repositories.** `depends_on` may name a ticket of another repository by its
key (`depends_on: [API-121]` in `WEB-14`): a key whose prefix is neither this project's planning
prefix nor that of a ticket here. keel finds that repository's folder on this machine in the
[`repos` map](settings.md#planning-settings) and reads the ticket's state there the same way, from
that folder's git and files, with no network: the state is as of that repository's last fetch, which
the `depends:` line names (`API-121 waiting for the feature merge (/path/to/api, server data from
<date>)`); `--fetch` fetches only this project. It counts as for a ticket here: `done`, or
`waiting for the feature merge` in a feature of the same name. With no folder for the prefix in the
map, or a folder that is not on this machine or not a git repository, the dependency is
`not checked`: a note, never a block, so the ticket can still be `next`, its line marked
`API-121 not checked`. `plans.js check` and
`plans.js ticket --depends` look the key up the same way: absent from that repository is a problem,
`not checked` a `note:` line. `/keel:start-task` with such a dependency not met asks: take the next
ticket / wait for it / start anyway; one not checked: start anyway / take another ticket.

**Tickets of linked repositories.** A feature on several repositories has `repos:` in its overview
(`README.md` beside its tickets). `/keel:tasks` then also shows that feature's tickets in its other
repositories, after the next ticket here and marked apart: never the next one here, and only for
features of this project (another project's own tickets are not shown). A feature done here but not
there is still shown. A repository in the [`repos` map](settings.md#planning-settings) is read the
same way as a dependency there, with its branches, authors and ages; a ticket its overview lists
that it has no file for is looked up in its history. One with no folder on this machine: "the
repository widget has more tickets", the overview's Tickets lines with the state unknown.

```
next: API-122 (message-notify)
linked: message-notify in web (WEB; /path/to/web, server data from 2026-10-27T09:12:00Z)
  WEB-14 Unread badge — in progress · branch message-notify, Ann Lee, 2 days ago
  WEB-15 Sound — to do
linked: message-notify: the repository widget (WGT) has more tickets, state unknown (no folder for WGT in the repos map: ...):
  WGT-3 Badge on the chat icon — state unknown
linked: message-notify: the overview in web differs from this project's (pull there; still different: plans.js align message-notify)
```

The overview is the same word for word in every repository; one that differs gets that one line, it
blocks nothing. Each is read in the working tree, else on the tip of the feature branch. Still
different after a pull (someone edited it by hand in one repository): `plans.js align <feature>`
shows each repository's version, when it last changed, and per section the lines one has and another
lacks (`-` / `+`); keel asks which version is right. The default is the newest: the latest commit that
changed the overview, an uncommitted edit counting as newer still; with the same time, the main
repository's (the first in `repos:`). `plans.js align <feature> --take WEB` writes that version into
the other repositories' overviews on this machine, in their working trees (one whose feature branch
is not checked out there is named, not changed); the commit and push of each
(`plans.js commit <feature> --repo <PREFIX>`, then `push`) only on your yes.

## Edit an exported feature

`/keel:start-planning <feature>` reopens it in its feature folder (when the folder is on another
branch, keel offers to switch). Only `to do` and `next` tickets are edited, each change on your yes,
then checked and reviewed; you decide each finding in the chat. A ticket `in progress`,
`waiting for ...` or `done` is never changed: keel offers a new ticket or to leave it, and names whom it
concerns. A new ticket takes the next shared key and a line in the overview's Tickets. A feature on
several repositories: `--repo WEB` puts it into that repository's feature folder with WEB's next key,
and every overview of the feature on this machine gets its line (keel names any it could not update).
`/keel:end-planning` then checks the folder and offers the commit and push of each repository it
changed; no plan gates, no plan review.

## End of a feature

When the last ticket is marked done, or `/keel:tasks` finds every ticket `done` or
`waiting for the feature merge`, keel says "Feature <f> is complete" and asks one question at a time,
each step only on its yes, in both git modes: 1) onto the feature branch (a ticket branch first merges
into it); 2) keep the tickets (default) or delete them: the folder goes to keel's trash, and one in the
repository leaves in its own commit on the feature branch, before the merge; 3) "Merge `<branch>` into
`<merge_into>`?"; 4) after the merge, "Delete the branch `<branch>`?".
