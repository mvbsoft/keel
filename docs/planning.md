# Planning

Planning is the third lane of work, next to tasks and sessions ([ways of working](workflows.md)): a
feature that needs several tasks is talked through before any code and ends as short tickets.

A *feature* is one finished capability of the product that one sentence explains (a connection to
S3). Planning turns it into short tickets in a conversation with you, before any code: the
conversation writes only the feature's folder, and keel's hook refuses changes to other project files
([what is guaranteed and what is not](behavior.md#planning)). One conversation plans one feature. A
task marker left by a conversation that died blocks planning only in a conversation with that same
session id; a new conversation plans normally.

A feature is **one folder** from the first question to its end. Nothing is copied, exported or
renamed on the way, no overview file is made from the plan, and keel never invents ticket numbers for
a tracker: a ticket is `<feature>/T<n>` (`csv-export/T3`), and a tracker key is written only when you
ask for it ([the tracker](#the-tracker)). What a plan or a ticket is at each moment is its `status`
field.

## Where things live

A feature's folder is in one of two places, set per project (`planning.place`,
[settings](settings.md#planning-settings)) and changeable for one feature when you start it ("this one
outside the repository"):

| Place | The feature's folder | Who sees it |
|---|---|---|
| `repo` | `<tickets_dir>/<feature>/` (`tickets/` by default), committed on the feature's branch | the team, through git |
| `pc` | `.keel/local/plans/keel/<feature>/` | this machine only, never in git |

```
tickets/csv-export/                 the feature folder (place repo; place pc: .keel/local/plans/keel/csv-export/)
├── plan.md                         status: draft → ready → in-progress → done | abandoned
├── research/                       the researcher's reports
├── reviews/
│   ├── plan.md                     the plan review's findings and your decision on each
│   └── T1.md … T6.md               the same per ticket
└── tickets/
    ├── T1-csv-writer.md            status: draft → ready → in-progress → done | abandoned
    ├── …
    ├── T5-export-badge.md          repo: web      (a ticket for another repository, planned here)
    └── T6-admin-switch.md          type: elsewhere (the ticket lives in another repository)

.keel/tasks/                        the work, next to the plan (in git when tasks.in_git is on)
├── fix-reset-500/                  a task with no ticket: flat, as always
│   └── task.md
└── csv-export-T1/                  the task of ticket csv-export/T1 (task.md: ticket: csv-export/T1)
    └── task.md
```

The files of a feature never move, except when you ask `plans.js move` to take the whole folder
between this machine and the repository. A task of a ticket is a flat folder `<feature>-T<n>`.
It lies in `.keel/local/tasks/` whatever `tasks.in_git` says when the feature is on this machine
(`pc`), so that nothing of a feature outside git travels in git, or when the ticket is for another
repository: its code is committed there, and a task folder here would travel on a branch without it.

### Stages

| # | Stage | What you or keel run | What changes in the files | What is removed |
|---|---|---|---|---|
| 1 | Start | `/keel:start-planning` → `plans.js new <feature>` | `plan.md` with `status: draft`, `last_ticket: 0`, `page: <8 hex digits>` | nothing |
| 2 | A brief (optional) | `plans.js brief <feature> <file>` | the brief's sections go into `plan.md` | the brief file goes to keel's trash |
| 3 | Research | the context and researcher agents | `research/<topic>.md` | nothing |
| 4 | Tickets | `plans.js ticket <feature> --title ...` | `tickets/T<n>-<slug>.md`, `status: draft`; for another repository `repo:` (or the pointer file, below) | nothing |
| 5 | Check and reviews | `plans.js check`, the reviewer agents, `plans.js reviewed` | `reviews/T<n>.md`, `reviews/plan.md`; `review_hash` in the ticket | nothing |
| 6 | End of planning | `/keel:end-planning` → `plans.js state <feature> ready` | the plan and every reviewed ticket: `status: ready` (only fields change) | nothing |
| 7 | Commit, push | `plans.js commit <feature>`, `plans.js push <feature>` | one commit of the feature folder as it is | nothing |
| 8 | Take a ticket | `/keel:start-task <feature>/T<n>` | the ticket `status: in-progress` and `branch:`; the plan `in-progress` if it was the first; `.keel/tasks/<feature>-T<n>/task.md` | nothing |
| 9 | Hand a task off | `/keel:end-task`, "hand off" | `task.md`, a "work in progress" commit; **the ticket stays `in-progress`** | nothing |
| 10 | Finish a ticket | `/keel:end-task`, "finish" | after a green verification the ticket `status: done`, in the commit with the code | the task's folder goes to keel's trash |
| 11 | Plan done | `plans.js state <feature> done` (asked after the last ticket) | the plan `status: done` | nothing |
| 12 | End of the feature | `plans.js drop <feature>` (only when you say so) | a commit that removes the folder, on the feature branch | the feature folder goes to keel's trash |

## Start: `/keel:start-planning`

| You type | keel does |
|---|---|
| `/keel:start-planning` the first time in a project | Without the project's planning settings (where the features live, `/keel:configure planning`) it stops before any question and says so. Say "this one outside the repository" at any start to put one feature on this machine only. |
| `/keel:start-planning` | Lists the features (feature, state, tickets that need review, open questions, last change, where) and asks which to continue or what the new feature is. |
| `/keel:start-planning csv-export` | Continues that feature: its open questions, the review findings without a decision, the "needs review" marks, which files its tickets name changed since, a summary in 3-6 lines and the Next action. |
| `/keel:start-planning continue the CSV export` | Looks for the words in the features' names and In plain words: one match → "Continue `csv-export`?"; several or none → the list. |
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
- **a feature in the repository**, before its first file and each commit: on the main branch → "Create
  branch `<feature>`?"; on another task's branch → a new branch; other uncommitted changes → commit or
  stash them first; the feature's branch exists → "Switch to it?"; a task active in another
  conversation → the feature on this machine for now, another copy (`git worktree add`), or your risk.

**The work.** One question per message, answerable in a line; options come with a recommendation.
keel writes the files first and then replies, so the answer and the next question are in its last
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
implementation steps. The ticket reviewer checks that a newcomer understands each section. Tickets are
`T1`, `T2`...; a T-number is never reused (`last_ticket` in `plan.md` counts them). A ticket depends
only on tickets of its own feature (`depends_on: T1, T4`, one plain line; `plans.js check` takes only
numbers that have a file, and finds no cycle). More than about 15 tickets → keel offers to split the
feature. keel looks up code facts itself; a pricier model or web research only when you ask or say
yes to an offer of it.

**Pictures in In plain words.** Where a picture explains the work better than words, In plain words of
the plan and of a ticket has one, right after the text it shows and after a sentence naming it: a `mermaid` diagram for steps
between people and parts of the system (`sequenceDiagram`), states (`stateDiagram-v2`) or branches
(`flowchart`), a markdown table for options side by side. One simple action gets none. The diagrams
and tables pass `plans.js check` and go into the feature page as they are; In plain words has no
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
what the gathered facts or the project's docs already answer. The next conversation on the feature
reads that section instead of searching again. The facts the tickets need go into their Where to look
and Boundaries, the conclusions into Decisions.

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
operations and security) and offers what may be missing; you decide each. A ticket that changes a
table with data or breaks an API others can call first gets the risky-change question (the ways to do
it, from the most reliable to the simplest, and a backup when data would be lost); your pick becomes
a Decision, and the plan review reports a risky change with no pick. A research report goes into
the feature's `research/<topic>.md`, and a ticket that follows it names it.

**Abandon a feature**: say so in the planning conversation; after your yes `plans.js state <feature>
abandoned --reason "<why>"` marks the plan `abandoned` and every ticket not closed `abandoned` with the
same reason. The folder stays where it is; `plans.js drop` removes it later, to keel's trash
(`/keel:cleanup` restores it).

## A feature on several repositories

One conversation plans a feature that also needs work in other repositories on this machine, such as
a new event in `api` and a badge in `web`; each ticket is for one repository only. A repository is
named by its name in git (the last part of its remote's URL, such as `web`; without a remote, its
folder's name; `owner/web` when two repositories have the same name). `plans.js repos` lists this
project and the repositories a feature may also touch, each with its name and whether keel is set up
there.

- **Which repositories.** After checking the premise, when the feature shows signs of another repository
  (an API, event or format others use; a front or an app) or you name one, keel asks once: "These
  tickets touch other repositories: T3 → `web`, T5 → `admin`. Right?" Then **one question per
  repository**: where it lies (keel finds the folders next to this project by name or remote and
  proposes one, or you give a path; none → a stub, below) and, for a repository where keel is set up,
  whether its tickets go there or stay here. A folder you give goes into this machine's repos map
  ([settings](settings.md#planning-settings), `plans.js settings set --repo web=<folder>`). keel never
  puts a ticket into another repository without asking.
- **Their rules and code.** The gathering offer always includes each other repository: a helper on
  Haiku reads its `CLAUDE.md`, `AGENTS.md`, skills and code by its absolute folder, and its notes go
  into What was gathered under `### <name>`. Before it starts keel says in plain words what that costs
  and offers: here, in a helper per repository, or a separate session in that folder. Claude Code may
  ask to allow reads in another folder; `/add-dir <folder>` lets the conversation read it without
  asking. A helper asks you nothing itself: it returns its questions to the conversation.

| The other repository | Where its ticket lives | What kind of ticket |
|---|---|---|
| on this machine, keel set up | here or there: keel asks, here is the default | full, written from its code |
| on this machine, no keel | here only | full, written from its code |
| not on this machine | here only | a stub: what to do, no technical decisions |

- **A ticket here.** `plans.js ticket <feature> --title "..." --repo web` makes an ordinary `T<n>` with
  `repo: web` in this feature's folder. The check looks for its Where to look in that repository's
  folder; a folder not on this machine is a note, "not checked", never a problem. The reviewers get the
  ticket's repository folder. `plans.js stale` compares each repository's tickets with its own commit
  (`after_commit_repos`, recorded by `plans.js set <feature> --after-commit` when you hand over).
  A ticket left here stays here, whatever else happens later.
- **A ticket there.** `plans.js ticket <feature> --title "..." --elsewhere web` writes the ticket in
  `web`'s own folder of the feature (`<its tickets_dir>/<feature>/tickets/T<n>-<slug>.md`, with a
  `plan.md` that names this project as its `home` when there is none yet). Here it leaves a pointer
  file with the same number: `type: elsewhere`, `repo: web`, a heading and one line "Lives in web",
  no status and no sections. Numbers come only from this plan, so `depends_on: T2` means the same
  ticket in both. The ticket's status, `depends_on` and review are read in `web`; when its folder
  cannot be read the status is `unknown`, and marking the plan done asks you first. The plan's
  status is mirrored into `web`'s folder. keel says "commit it there": it never commits in another
  repository for you.
- **A repository not on this machine.** keel says what it found ("a front is needed, but no
  repository was found") and offers: a repository that may be it, to confirm; stubs; leave it out; or
  your own way. A stub is a ticket of its own type (`plans.js ticket <feature> --title "..." --stub
  admin`, front matter `type: stub`, `repo: admin`) with only what can be written without that
  repository's code: no Boundaries, Correct the priors or Where to look, and How to check in manual
  steps. Tickets name it in `depends_on` like any other and it has a status like any other; the plan
  reviewer counts its behaviour as covered.
  `/keel:start-task` does not start a stub: it must first become a full ticket.
- **When that repository is here.** `plans.js check` says so (`note: stub T4 can become a full ticket`),
  and keel offers `plans.js ticket <feature> --from-stub T4`: the same `T4`, now a full ticket in
  this feature's folder with `repo:` set. keel then studies that repository, with the stub as the
  start, for the sections it lacked; until they are written they are placeholders and the check stops
  on them.
- **A repository without keel.** Its tickets are planned and done like the others: the git steps run
  there in manual mode (its main branch from `origin/HEAD`), keel proposes its checks from its
  `package.json` or `composer.json` and you confirm, and its task has its own `started`, `branch` and
  `base`. keel's own files there (`.keel/local/`: the verification record, the finish record of its
  task, scratch files) get a `.gitignore` of their own, so they never show in `git status` or a commit.
- **Doing it.** `/keel:start-task <feature>/T<n>` for a ticket of another repository asks once where
  it runs: here, in a helper working in that repository (it asks nothing itself: it stops on a
  decision and the conversation asks you), or a separate session. keel prints the separate session's
  command, ready to paste: `cd <folder> && claude --add-dir <this project> "<prompt>"`; the prompt
  names the ticket file and ends with `plans.js ... status <feature> T<n> done --project <this
  project>`, so the session marks the ticket here. Claude Code must be allowed to write in this
  project's folder.
- **Commit and push** of a feature are asked for the repository that holds its folder, and Claude
  Code then asks too. Each repository commits and pushes its own files.

## End: `/keel:end-planning`

| You type | keel does |
|---|---|
| `/keel:end-planning we continue tomorrow` (any words for "later") | **Hands over**: reviews only the tickets never reviewed or changed since their review; each finding is fixed now or becomes a Q; `plan.md` gets the open questions and the Next action. A feature in the repository: the commit questions (below). |
| `/keel:end-planning final review` | **Final**: below. |
| `/keel:end-planning` | Open questions or structure problems → hands over, with the reason in one line; otherwise asks "Final review and ready, or hand over?". |

**Final.** 1) The gates: no open questions, a clean structure check (the `# [id] title` heading, each section
once and in its order, headings inside code blocks being text, every code block closed, the three Boundaries labels, acceptance criteria as a `- [ ]` list, no TBD (a done or abandoned ticket is not checked for it), the named files exist, no path of this machine in the plan, a ticket or a report (`C:\…`, `/mnt/c/…`, this machine's home folder, the project or a neighbouring repository by its folder: paths go from the repository's root; another `/home/<name>/…` or `/Users/<name>/…` is only a note, as a web route such as `/home/<page>` looks the same),
dependencies without cycles; style is the ticket reviewer's advice and never blocks), and a decision for every finding; else keel
shows what blocks and offers to hand over. 2) Ticket reviews of the tickets not reviewed as they are
(`keel:ticket-reviewer`, up to 4 tickets per call), then one review of the whole plan
(`keel:plan-reviewer`, which also checks that each behaviour the plan promises is an acceptance
criterion of exactly one ticket, a stub's behaviour counted as covered), both on Sonnet; a ticket of
another repository is reviewed in that repository's folder. You decide each finding: fix, defer to a Q, or reject with a
reason. Each finding is written into `reviews/` as `undecided` before you are asked, so a conversation that stops loses none (the next `/keel:start-planning` shows them); your decision replaces the word and is not raised again. Fixed tickets are reviewed again, at
most 2 rounds per `/keel:end-planning`; a failed review is named as failed, never as "no findings".
3) `plans.js state <feature> ready`: the plan becomes `ready` and so does every draft ticket that
needs no review. That is all it does: no file is copied, renamed or created, and the folder is where it
was. A feature in the repository then offers the commit and the push.

Every end, also after a no, frees the conversation from planning. The report: **Done**, **Reviews**,
**Git**, **What next** (the Next action, or "a ticket starts with `/keel:start-task <feature>/T<n>`";
also that `/keel:feature-page <feature>` makes the feature's page), **Costs**.

**Commit and push.** "Commit the planning files?", then "Push `<branch>`?", each on its own, and
Claude Code asks too, every time. The commit takes the feature's folder as it is ("Plan <feature>" the
first time, "Update the <feature> plan" after) and removes nothing. Never on the main branch; planning
never opens a pull request. A file of the commit with a path of this machine stops it: keel names the
file and the line.

## Commands

Everything is run through one script, `node "<keel>/scripts/plans.js" "<project>" <command>`; the
conversation runs it for you and you ask in plain words ("mark T3 done", "move this feature into the
repository"). Every command is a script: it gives the same result every time and uses no tokens. Those
marked **script only** do not need an agent at all, and the agent runs them only when a step of a
command or you ask. The others are the scripts the planning conversation, the reviewers and the
tasks call as part of their work; the judgment (the questions, the reviews, the texts) stays with the
agents.

| Command | What it does | When to run it | What it changes in files |
|---|---|---|---|
| `new <feature> [--place repo\|pc]` | Makes the feature | at the start of a new feature | creates `plan.md` (`status: draft`) in the place `--place` or `planning.place` says; refused for a bad or taken name |
| `ticket <feature> --title <t> [--slug <words>] [--depends "T1,T2"]` | Adds a ticket | when a piece of work is clear | creates `tickets/T<n>-<slug>.md`, `status: draft`, never reviewed; raises `last_ticket`; on a `ready` feature the plan keeps its status and the ticket waits for its review. With `--repo <name>`, `--elsewhere <name>` or `--stub <name>`: [other repositories](#a-feature-on-several-repositories); `--from-stub T<n>` turns a stub into a full ticket |
| `check <feature>` | Checks the structure | before a review and before `ready` | nothing (a report: problems, `note:`, `warn:`, and `plan:` when every ticket is done or abandoned) |
| `review <feature>` | Says what needs a review | before a review | nothing (per plan and ticket: never reviewed, changed since its review, unchanged) |
| `reviewed <feature> <T1\|plan> ...` | Records a finished review | right after the review | `review_hash` in the ticket, `ready_hash` in the plan |
| `state <feature> <draft\|ready\|in-progress\|done\|abandoned> [--reason <why>]` **script only** | Sets the plan's status | `ready` at the end of planning; `done` when every ticket is done or abandoned; `abandoned` on your word | `status` of `plan.md`. `ready` needs a clean check, a ticket and no open question, and also readies every draft ticket that needs no review. `abandoned` needs `--reason` and abandons every open ticket with it. `done` waits for every ticket to be done or abandoned. `in-progress` and `done` only after `ready`; back only from `ready` to `draft`, and from `done` or `abandoned` to `in-progress`. `--project <path>` for a session in another repository |
| `status <feature> T<n> <state> [--reason <why>] [--branch <b>]` **script only** | Sets one ticket's status | when a ticket is taken, finished or given up | `status` of the ticket file. `ready` waits for its review; `abandoned` needs `--reason` and names the tickets that depend on it; `in-progress` (not from a draft, again from `done` or `abandoned`; `--branch` the task's branch, into `branch:`) also moves a `ready`, `done` or `abandoned` plan to `in-progress`; `done` only from `in-progress`. `--project <path>` for a session in another repository |
| `set <feature> [--branch <b>] [--merge-into <b>] [--after-commit]` | The feature branch and where it merges | when they change, and when you hand over | `branch`, `merge_into` in `plan.md`; `--after-commit`: `after_commit` and `after_commit_repos`, the commits the facts were last checked at |
| `stale <feature>` | Which files changed since the facts were gathered | when you continue a feature | nothing |
| `tickets [<feature> \| <feature>/T<n>] [--fetch]` | The tickets' states and the ticket to take next; a feature also with its branch and folder (`(this machine only)` when it is not in the repository), a ticket with its file | before taking a ticket; `/keel:tasks` runs it | nothing (`--fetch`: a `git fetch` first) |
| `list`, `find <words>` | The features; the ones a few words name | to pick a feature | nothing |
| `repos` | This project and the repositories next to it | before asking about other repositories | nothing |
| `settings`, `settings set --repo <name>=<folder>` | The planning settings; this machine's repos map | `set` when you name where a repository is | `settings set` writes `.keel/local/plans/keel/settings.json` |
| `commit <feature> [--tickets T1,T2]` **script only** | Commits the feature's folder | after planning, after a status changed | one git commit of the folder as it is, on the current branch; never on the main branch; removes nothing. `--tickets`: only those ticket files and `plan.md` (tickets taken) |
| `push <feature>` **script only** | Pushes the current branch | after the commit | a git push; after a network or access failure `retry:` and the command |
| `move <feature> --to repo\|pc` **script only** | Moves the whole folder between this machine and the repository | only when you ask | the folder moves as it is; no file is rewritten. Refused when the target exists, a ticket is `in-progress`, a task names a ticket of the feature (`ticket:` in its `task.md`) or the folder has uncommitted changes. `--to pc`: once committed, the folder leaves git for everyone |
| `drop <feature>` | Ends a feature | only when you say so, once every ticket is done or abandoned | the folder goes to keel's trash; one in the repository only off the branch it merges into, then `commit <feature>` records the removal |
| `brief <feature> <file>` | Starts a feature from a task's brief | when a task is too big | fills `plan.md` from the brief; the brief goes to keel's trash |
| `report <file>` | Reads a reviewer's reply | after a review | nothing (its findings, or `report: failed` and why) |
| `mark set\|get\|clear --session <id>` | Which conversation plans which feature | start and end of planning | the chat marks in `.keel/local/plans/keel/sessions/` |

`list`, `check`, `review`, `stale`, `tickets`, `repos` and `find` only read. The result is the first
line of the output; a refusal is `plans: <command> refused (<why>)`.

## Ticket states

A ticket's state is its `status` field and nothing else: no git history and no key in a commit decide
it. The same field is on the plan.

| State | Ticket | Plan |
|---|---|---|
| `draft` | being written; keel does not offer it as the next ticket | being planned |
| `ready` | reviewed and agreed; can be taken | planning ended (`/keel:end-planning`) |
| `in-progress` | taken: its `branch:` says by whom and where | the first ticket was taken |
| `done` | finished after a green verification | every ticket is done or abandoned, and you said yes |
| `abandoned` | closed without doing it; `reason:` says why | closed without doing it; its open tickets are abandoned with it |

Any state may go to `abandoned` (on your word, with a reason). Otherwise a state moves forward only,
and `plans.js` refuses the rest: a plan becomes `in-progress` or `done` only after `ready`, and goes
back only from `ready` to `draft` (planning reopened); a ticket is `done` only from `in-progress`, and
is taken again (`in-progress`) from `done` or `abandoned`: a finish whose git step stopped, or you
start it again. A `done` or `abandoned` plan goes back to `in-progress` with it, so a plan marked done
before a commit that stopped does not stay done with an open ticket. `/keel:tasks` and `/keel:start-task` print each ticket's state, `on <branch>` for one in
progress, and the one to take next, with `plans.js tickets` (a script, no tokens): the first ticket by
number that is `ready`, is no stub, needs no review and whose dependencies are all `done`. A ticket that depends on
an abandoned one waits for your answer: remove the dependency, or abandon it too. A ticket in another
repository is read there; one that cannot be read shows `unknown`.

**The main copy.** The file on the feature's branch on the remote is the main copy of a status; the
working tree is a copy. `/keel:start-task` fetches first, and a ticket that is `in-progress` there on
another branch is shown with who took it and where, so two people do not take one ticket unknowingly.
For a feature on this machine only, nothing is shared.

**What git says.** Git changes no state. It warns in one case: the ticket's branch is merged where it
goes while the ticket is not `done`: a ticket branch `<feature branch>-T<n>` into the feature branch,
the feature branch into the feature's `merge_into` (`warn:` in `plans.js tickets` and `check`).

**Dependencies.** `depends_on` names tickets of the same feature. A dependency that is not `done` holds
a ticket back: `/keel:start-task` names it and asks: take the next ticket, or start anyway.

## Take and finish a ticket

`/keel:start-task <feature>/T<n>` ("next ticket" takes the one `plans.js tickets` names):

1. keel fetches, reads the ticket and says if it is a `draft`, if it needs review, if it is already
   taken, or if it lives in another repository (then: start it there).
2. It reads the ticket, checks its Goal, Acceptance criteria and Where to look against the code, and
   goes on as for any task, with the ticket's acceptance criteria.
3. The task works on the feature's branch unless you ask for a ticket branch; a ticket branch is the
   plan's branch plus `-T<n>` (`csv-export-T3`), made from the plan's branch, and merges back into it.
4. `plans.js status <feature> T<n> in-progress --branch <the branch>` writes `status` and `branch`
   (and moves a `ready`, `done` or `abandoned` plan to `in-progress`). For a feature in the repository keel then offers the
   commit and push of that change (only the ticket file and `plan.md`), so others see the ticket is
   taken; in autonomous git it runs them. `/keel:start-session` does the same for the tickets it takes.
5. The task is `.keel/tasks/<feature>-T<n>/`, with `ticket: <feature>/T<n>` in its `task.md`.

`/keel:end-task`:
- **finish**: after a green verification the ticket's `status` becomes `done`, and its file and
  `plan.md` go into the same commit as the code. When that was the last open ticket, keel asks "Mark
  the plan done?" (`plans.js state <feature> done`). A ticket `needs review` is checked against the
  code in the verification, not by a separate review.
- **hand off**: the ticket stays `in-progress`; its state is never changed by a handoff.

A ticket of another repository is verified, committed and pushed in that repository, by its own rules.

## Changing a plan after `ready`

Edits after `ready` never move a status: nothing sends a plan back to `draft`. keel weighs an edit by
the section it is in.

| | Essential sections | Descriptive sections |
|---|---|---|
| Ticket | Goal, Acceptance criteria, How to check, Boundaries, Correct the priors, Out of scope, Dependencies (and `depends_on`) | In plain words, Example, Why, Where to look |
| Plan | Level, Decisions, Contract, Out of scope, Design sketch | In plain words, Terms, What was gathered, Open questions, Tickets, Next action |

- An edit to a descriptive section needs nothing.
- An edit to an essential section marks that ticket **needs review**: its `review_hash` (made by
  `plans.js reviewed` over the essential sections and `depends_on`) no longer matches. The status stays.
  keel asks "Review it now?"; one reviewer checks that ticket, and when `depends_on` changed, keel shows
  the tickets that depend on it and asks whether to review them too. With "later" the mark shows in
  `/keel:start-task` (before the ticket is taken), `/keel:start-planning`, `/keel:tasks` and the feature
  page. A ticket that is `in-progress` is not reviewed on its own: `/keel:end-task` checks it with the code.
- An edit to an essential section of the plan marks the **plan** as needing review (`ready_hash` no
  longer matches). The plan reviewer names the tickets it touches, they are reviewed, and the marks go.
- A new ticket on a `ready` plan (`plans.js ticket`) is a `draft` with the mark; keel offers its review
  and shows related tickets, and after your yes it becomes `ready`. A draft is never offered as the
  next ticket.
- A change of `status`, `branch`, `reason`, `tracker`, `tracker_url` or `page` is never an edit: none
  of them is part of a hash.

## The tracker

`tracker: <key>` and `tracker_url: <link>` are fields of the plan and of every ticket, one plain line
each, with no type: the plan may be an epic or a parent task in your tracker and a ticket anything
below it; keel does not store which. keel writes them only when you ask:

- "Here is the link for this ticket" → keel writes `tracker` and `tracker_url`.
- "Create this in Jira" → keel's tracker skill (`tracker`, loaded on such a request in any
  conversation, not only while planning) creates it through your tracker's connector and writes the
  fields.
- "Move this whole feature to the tracker" → the same skill reads the plan and the tickets, asks only
  what the files do not say (project, type of the plan and of the tickets, version, sprint, assignee,
  labels), looks for each item by name before creating it, then creates the plan's item, then the
  tickets', `depends_on` as "blocks" links, and writes `tracker` after each item at once, so a run
  that stops half way creates no duplicates when run again.

A connected, signed-in connector of your tracker is needed for the last two. The status in the file is
the only status: keel never reads or writes a status in the tracker.

## End of a feature

When the last ticket is `done` or `abandoned`, keel says "Feature <f> is complete" (`plans.js check`
and `plans.js tickets` print `plan: every ticket is done or abandoned`; `plans.js tickets` with no
feature lists such an open plan too, so `/keel:tasks` and `/keel:start-task` find it also when the last
ticket was closed in another session or repository) and offers `plans.js state <feature> done`. Then it asks one question at a time, each step
only on its yes, in both git modes: 1) onto the feature branch (a ticket branch first merges into it);
2) keep the files (default) or remove them: the folder goes to keel's trash, and one in the repository
leaves in its own commit on the feature branch, before the merge; 3) "Merge `<branch>` into
`<merge_into>`?"; 4) after the merge, "Delete the branch `<branch>`?".
