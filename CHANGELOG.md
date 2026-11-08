# Changelog

All notable changes to keel are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `/keel:configure usage` asks which page to join when the account has several titled "keel usage", and
  updating the page no longer stops for the page's owner (the read says "owned
  by you", not "writer").
- `/keel:usage on|off` (and `usage-setup.js <project> sync on|off`) turns this machine's sync on or off;
  the end reports still show the costs, and `on` sends what Claude Code's logs still hold of the time it was off.
  `usage.json` gets `sync` and `sync_off_since`.
- `usage.js audit --page <folder>` compares this machine's dollars and tokens per session on the page
  with the local transcripts and names the difference to Claude Code's own cost.
- The docs and the instructions tell the three account cases: API key only (exact dollars, no usage page,
  no page questions in configure), subscription only, and both.
- `.keel/config.json` has a `planning` section, the same for the whole team: the ticket prefix
  (`ticket_prefix`), where exported tickets live (`tickets`: `repo` or `pc`; the researcher's reports
  go with them) and their folder (`tickets_dir`, default `tickets`), and the tickets' language
  (`language`, default `repo_language`). `/keel:configure` asks the prefix and where the tickets live,
  quick setup too; detailed setup also asks the language. `/keel:configure planning` asks only these.
- The planning settings on this machine keep `repos`, where the neighbouring repositories are by their
  ticket prefix: `plans.js settings set --repo WEB=<absolute folder>`.
- `comments.js` reports the planning ticket prefix in new comments and docs together with
  `comments.ticket_prefixes`, read at each check; `/keel:configure check` no longer proposes it as a
  tracker prefix.
- Planning gathers before it asks: a new feature told in a line or two, or a large one, first gets an
  offer of what to look up, with the price as an estimate, on one yes: the project map, a
  `keel:context` helper on Haiku. Its findings go into `plan.md`, What was gathered, which a continued
  draft reads instead of searching again; the questions after it build on what was found. Skipped or
  not answered yet, it is not replaced by searches of keel's own. In planning keel writes the draft
  first and then replies: the answer and the next question are in its last message.
- A new agent, `keel:researcher` (Sonnet, read-only, web): in planning, on a yes to an offer with its
  price, it reads documentation, package registries (npm, Packagist, deps.dev; GET requests only) and
  the web, and returns a report with dated data and its sources. The planner writes it into the
  draft's `research/<topic>.md`; "how others do it" joins the gathering offer.
- Planning looks for what exists before it plans new code: the project's code, its installed
  packages, the framework and platform, a small living package, then writing it ourselves. A package
  choice is shown as a table with size, dependencies, license, releases and known vulnerabilities,
  each with its source and date, "write it ourselves" always among the options, and a recommendation.
- Planning designs for today's acceptance criteria: a request for everything at once gets a first
  working slice, each ticket is a thin slice through the layers it needs, and a new dependency,
  datastore, protocol, module boundary or public contract comes with an offer of a short ADR.
- Planning looks at the plan with three views before it writes the tickets (the product and its
  users, the architect, operations and security) and offers what may be missing; the user decides
  each.
- Export takes the draft's `research/` with the tickets, into `research/` beside them, on this
  machine and in the repository; a file there that is not a `.md` report stops the export.
- The plan reviewer's `coverage` check also maps the acceptance criteria: each behaviour `plan.md`
  promises is checked in exactly one ticket.
- `depends_on` takes tickets of other repositories by their key (`API-121` in a `WEB` ticket), in a
  draft and in exported tickets. keel reads their state in that repository's folder on this machine
  (the `repos` map) from its git and files, with no network, as of its last fetch, which the
  `depends:` line of `plans.js tickets <KEY>` names; it counts as for a ticket here. A key absent from
  that repository (on any of its branches) is a `plans.js check` problem and refuses
  `plans.js ticket --depends`; with no folder in the map, or a folder not on this machine or not a git
  repository, the dependency is `not checked`: a `note:` line and a mark on the ticket's line, never a
  block, so the ticket can still be next.
- Planning a feature on several repositories in one conversation. When a feature shows signs of
  another repository, planning asks which projects it touches, from the new `plans.js repos`: the
  `repos` map and the git repositories next to the project, each with its planning prefix (never the
  project itself or another worktree of it). `plans.js set <f> --repos "WEB"` records them in `plan.md`
  `repos: [API, WEB]`; a repository whose prefix is not set yet takes the one the user confirms. The
  gathering offer then always includes each other repository: `keel:context` reads its rules and code
  by its absolute folder. `plans.js ticket --repo WEB` marks a ticket `repo: WEB`; `plans.js check`
  looks for its Where to look in that folder (none on this machine: a `note:`, never a problem),
  `plans.js review` names the folder for the reviewers, and `plans.js stale` compares each
  repository's tickets with its own commit, `after_commit_repos`, which `plans.js set <f>
  --after-commit` records with `after_commit` at a hand-over. A repository not on this machine gets
  stubs in `plan.md` `## Stubs` (a title and In plain words, no key), which the plan reviewer counts
  as covered in its coverage check.
- Exporting a feature on several repositories: `plans.js export` puts each repository's tickets into
  that repository by its own planning settings (prefix, ticket place, main branch) and its own key
  counter after its own `git fetch`, all or nothing across the repositories. Each gets the same
  `README.md` overview, already from 1 ticket, with `repos:`, every repository's tickets, `## Stubs`
  and `## Parts`; `research/` goes to each repository whose tickets or overview name the report.
  Another repository must be ready (on the feature branch, clean tree, its prefix set, no active keel
  task, no folder of the feature yet); the refusal says why per repository, and `--as-is "WEB"` lets
  uncommitted changes or another branch stay. `plans.js commit|push <f> --repo WEB` commit and push in
  another repository of the feature (its folder from this machine's `repos` map; a map tracked in git
  is refused); Claude Code's window names the repository. The commit checks the keys in every
  repository and renumbers a taken one in all of them; a push that fails on the network or access prints a `retry:` command.
  `plans.js ticket <f> --repo WEB` on an exported feature adds a ticket with WEB's next key, and a
  later ticket's line goes into the Tickets of every overview of the feature on this machine.
- `plans.js tickets` (and `/keel:tasks`) shows, after `next:`, the `linked:` tickets of each feature
  of this project in its other repositories: their states from that repository's git on this
  machine, or, for one not here, the overview's Tickets list with the state unknown; a feature done
  here but not there stays listed, other projects' own tickets do not show. An overview that differs
  between the repositories gives one line with a pull hint. The new `plans.js align <feature>` shows
  the versions and the sections where they differ, defaults to the newest change (the main
  repository's on the same time), and `--take <PREFIX>` writes the chosen one into the other
  repositories' overviews; the commit and push stay on the user's yes.
- `/keel:feature-page [<feature>] [--lang <code>]` makes a private page of a planned feature in your
  claude.ai account, to read on a computer or a phone: on the left the overview, what is in progress
  or next with the tickets' count by state, and the list of tickets; on the right the chosen ticket,
  its sections as blocks with an explanation each, its decisions and its dependencies with their
  states, and its md file as GitHub draws it, mermaid diagrams included. The new `feature-page.js`
  puts the md texts as they are into a fixed template; the page renders the markdown and the code
  itself, with libraries from cdnjs at exact versions, in both themes. The page's language is
  `--lang`, else the page's own, else the conversation's; its labels come from `locales/` (new
  `page.*` keys), and texts in another language than the tickets' are translated by Claude on the
  page only and kept in it, so an update translates only what changed. The page is titled
  `[API, WEB] - <the overview's heading> (<code>)` and found again in the account by that code: a
  random one each draft gets (`page:` in `plan.md`), which the export writes into every ticket, so
  running it again from any machine or repository of the feature updates the same page; nothing is
  kept on this machine. A
  ticket of a repository that is not on this machine is marked so, its state and any dependency on
  it unknown; one of this repository whose file is only on another branch is read from there and
  marked so. The page is a snapshot: its feature card says when it was built and gives the command
  that updates it, with a Copy button. Before the page is built, `feature-page.js --fetch` fetches the
  remote, so the tickets' states are fresh; a failed fetch still builds the page, says so and marks
  the states on the page as of the last fetch (a draft's page has no git states, so no mark). The
  planning fetch (also for the export and `plans.js tickets --fetch`) counts a remote with no answer
  within 60 s as failed instead of waiting. No feature named: the current branch's. A path of this machine
  in the feature's files is never published: the page is refused with each one named.
- `plans.js check`, and with it the export, reports a path of this machine anywhere in a feature's
  files: the plan or overview, a ticket, a research report (a drive such as `C:\`, `/home/<user>`,
  `/Users/<user>`, `/root`, `/mnt/c/`, the project's or a neighbouring repository's folder). Paths
  in a feature go from the repository's root, so they hold on every machine.
- Planning draws where a picture explains better than words: In plain words of the plan (and so of
  the feature overview) and of each ticket gets a `mermaid` diagram for steps between people and parts
  of the system, states or branches, or a markdown table for options side by side. It stands right
  after the text it shows, after a sentence naming it, its labels and state names in the plan's
  language; one simple action gets none. The ticket reviewer's `plain-words` check notes a process
  told only in words. In plain words still has no word limit, so pictures count against nothing.
- A task too big for one can be planned in a new chat without losing what this one found: keel
  writes a brief, `.keel/local/plans/briefs/<name>-brief.md` (Goal, Files, Decisions and why,
  Open questions), and gives the exact `/keel:start-planning` command. Planning from a brief takes its
  content into `plan.md` with the new `plans.js brief`, which moves the brief to keel's trash, and
  starts from its open questions.

### Changed
- Unfinished work never stays on one machine only: a `/keel:end-task` handoff of a task without its
  own branch no longer asks where the work goes; it makes a new branch, commits the work there as
  "Work in progress: <title>" and pushes it (a planned ticket of a feature with 2 or more tickets: a new
  ticket branch). A task moved to planning commits and pushes its half the same way, without asking.
  The "no commit" and `git stash` options are gone. Every task handoff commit is titled
  "Work in progress: <title>" (a tracker key comes first: "Work in progress: CAN-123 <title>"). Your own git instruction still wins.
- `usage.artifact_url` in `.keel/config.json` is no longer used: each machine syncs to its owner's own
  page and Share on the page shows it to others. The key stays valid in the schema and is ignored; keel
  says so once per machine.
- `/keel:usage-clear` is now `/keel:usage clear`, and it clears only the machine it runs on: its day,
  machine and calibration documents. Other machines' data stays (to clear the whole page, run it on every
  machine) and the dashboard hides nothing by date.
- Planning has its own page, [docs/planning.md](docs/planning.md); [docs/workflows.md](docs/workflows.md)
  keeps tasks and sessions and links to it.
- `/keel:start-task` asks once how to go on with a task too big for one: a new chat with a brief,
  plan here, do not split, or another way. Asked to split it, it does not ask whether and does not
  offer "do not split"; "do not split" is recorded in `task.md`, so a resumed task is not asked
  again. With code already changed it no longer hands the task off: it says what is done and
  advises; work that runs on its own is finished as a task first, and half of something may go on
  in a branch of its own as the feature's branch (the task's own, or a new one when the task works
  directly on a shared branch; committed and pushed as work in progress, the task to keel's trash).
- `/keel:start-task` on a ticket whose dependency is not done offers to take the next ticket first,
  then to start anyway; for another repository's dependency: take the next ticket / wait for it /
  start anyway, and for one not checked: start anyway / take another ticket.
- A to do ticket held back by a dependency learns where that code is, from git: already in its own
  feature branch (then it may start, and can be next), only in another feature's branch (wait for its
  merge into main, or pull it in with `git merge <branch>`), only in its ticket branch, in progress or
  not started (wait). `plans.js tickets <KEY>` prints a `where:` line each, the feature list marks
  `<KEY> only in feature branch <b>`, `/keel:start-task` offers wait / pull it in / start anyway, and
  the feature page shows it beside the dependency.
- Planning no longer offers 2-3 approaches on every choice. An elementary task, or one with none of
  the reasons below, gets one simple answer; a feature with a reason for more (several variants today, a database or network, a public
  API, money, access, security, a stated scale, or simply a large one) gets 2-5 levels, each with what
  is built, about how many tickets, the cost and risk now and the pain of adding it later. keel
  recommends one, the user chooses, also a level it did not offer; the choice goes into Level.
- `/keel:start-planning` says once on a new feature that keel advises Opus for planning; the model
  stays the user's choice. A pricier model or web research also runs after a yes to an offer of it,
  not only when the user asks.
- `/keel:start-planning` stops before its first question while the project has no planning settings
  and names `/keel:configure planning`; export is refused the same way. The first planning on a
  machine asks only where the draft lives. The ticket prefix no longer falls back to the first of
  `comments.ticket_prefixes`.
- A planned ticket starts with In plain words: the whole task told for a person, without code or
  paths, as long as it needs. Its sections always come in one order: In plain words, Example, Goal,
  Acceptance criteria, How to check, Boundaries (`always`, `ask first`, `never`), Correct the priors,
  Where to look, Out of scope, Why, Dependencies; Example and Correct the priors may be left out.
  `plans.js check` checks the `# [id] title` heading (an empty title fails), each section once and
  in its order (headings inside code blocks are text), the three Boundaries labels and the
  acceptance criteria as a `- [ ]` list; the ticket reviewer advises on In plain words and on plain markdown without blocking,
  and its size check leaves In plain words out of the 150-500 words.
- Every section of a planned ticket is written for someone who has not seen the feature: short, but
  in whole sentences, a D or T number with its words. Each acceptance criterion is a sentence
  "situation → what we see" with concrete people and values, each Boundaries item says why, and the
  technical part may take 150-500 words (was 150-400). The plan's Level says which of how many, what
  the scale means, what this level builds and what is put off. The ticket reviewer has a new check,
  `clear-to-newcomer`: a "no" in Goal or Acceptance criteria is important, elsewhere advice.
- A planning draft's `plan.md` has In plain words, Level, Contract, What was gathered and an optional
  Stubs instead of Summary and Problem / Goal; `plans.js find` reads In plain words.
- The feature overview `README.md` takes the plan's In plain words, Level, Decisions, Contract, Out of
  scope, Terms and Stubs (no more Design sketch) and lists the feature's tickets: key, title and
  repository (the last part of the remote's URL, else the project folder's name), without states.
  Tickets and plans in the earlier format fail `plans.js check`; nothing converts them.
- A big plan (8 steps or 15 files, unchanged) is run in a fresh conversation first: the plan names the
  choice (a fresh conversation, recommended; implementers from this conversation; here; or another
  way) and approving it answers. For a task, approve with "Yes, clear context" or type `/clear` and
  `/keel:start-task <id>`; for a session, `/clear` and `/keel:start-session`. What the planning
  settled is written into `task.md` or the note first. The fresh conversation asks once, implementers
  or here (`execution: fresh` until then); a resume with the choice made asks nothing.
  `plan-steps.js` prints both wordings of the question.
- A very big plan, 10 steps or 40 files (not a setting), goes to `/keel:start-task`'s planning as a
  feature: `plan-steps.js` prints a `very big:` line.

### Fixed
- In a session that works in a linked git worktree of the project (a worktree session of the Claude
  desktop app, or after Claude enters a worktree), keel used the main checkout: its note, session
  record, task files and git steps went there, and parallel sessions shared them. keel now works on
  the worktree, and every keel script run there names it (`project: <folder>`). What this machine
  shares between conversations stays with the main checkout: planning drafts, settings and briefs,
  local tasks, keel's trash (an item from a worktree goes back there; a bare `/keel:cleanup restore`
  takes only the items this folder moved, and an item whose worktree is gone stays in the trash),
  keel's project options, the confirmation of autonomous git, and which conversation plans or works on
  what, so a planning or task lock holds in every folder of the project. The project's Claude Code
  settings that configure writes and the context warning reads are those of the folder Claude Code
  started in: in a desktop worktree session, the main checkout's. A worktree without
  its own `.keel/config.json` uses the main checkout's. If you opened a project directly in a linked
  worktree with keel 1.4.0, these stores were kept in that worktree's `.keel/local/`; keel now reads
  them from the main checkout: move `tasks/`, `closed-tasks.json`, `active/`, `plans/keel/`,
  `plans/briefs/` and `options.json` there by hand (keep the main checkout's copy when both have one).
  Restore what you need from that worktree's trash before you update (`/keel:cleanup restore`): a
  batch moved by hand would put its items back into the main checkout.
- `comments.js` no longer stops when `comments.ticket_prefixes` is not a list; it is skipped.
- A planning folder written with a double slash, such as `docs//plans`, is refused like `docs/plans`.
- The cost report counts a message that starts with a system reminder, such as the desktop app's
  "Linked sessions now" note, as your turn, and its preview skips the reminder; before, a long session
  started from another one showed a single turn.
- `plans.js check` no longer reports a comparison such as `| < 30 s | > 1 min |` or `x <= 3 | y > 2`
  as an unfilled `<...>` placeholder; a `<` followed by a space or `=` is not one, and neither is
  `| <30 s | >1 min |`, `<30 s, then >1 min` or anything in a code block indented under a list item,
  such as a mermaid diagram.
- A finish with `/keel:end-task`, and `/keel:end-session` with verification, ask for the level when
  the command names none, also when a brief, the session note or memory names one: that level is
  shown as advice next to the recommended proposal.

### Removed
- `approved_artifact_urls` and `page_shared` in `~/.claude/keel/usage.json`.
- `language`, `export`, `export_dir` and `prefix` in `.keel/local/plans/keel/settings.json`, and their
  `plans.js settings set` options: the project's `planning` section replaces them. Values saved there
  are not carried over: set them again with `/keel:configure planning`.

## [1.4.0] - 2026-10-27

### Added
- `/keel:configure usage` updates an already published "keel usage" page to the current keel's page,
  at the same address and with all its data, after a yes. The page keeps a fingerprint of its page
  files in its settings; each end step reads it back, so `/keel:usage` and `/keel:configure usage` tell
  on every machine when the page was made by an older keel. A team page or a page shared from another
  account is never offered the update: its owner updates it.

### Fixed
- keel's own commands in Bash could run on another folder than the one keel checked: a script path
  with a double backslash (keel on a network share) or a word such as `//srv\share\p`, which Git Bash
  turns into `/srv/...`; such commands are now refused.
- On Windows, `delete-branch` could resolve a name with a sign that only looks like a letter (the
  Kelvin sign for k) to another local branch and delete it; branch names now fold only A-Z there.

## [1.3.0] - 2026-10-27

### Added
- A third lane, planning: `/keel:start-planning` plans a feature in its own conversation, one question
  at a time, with decisions and short tickets in a draft kept on this machine or in the repository;
  `/keel:end-planning` hands it over to continue later, or runs the final review and exports the
  tickets. A planning conversation changes no code and runs no task, session, setup or cleanup
  commands (`/keel:configure`, `/keel:cleanup`), a task conversation does not plan, and planning
  needs a person (`claude -p` is refused).
- Two reviewers for planning on Sonnet: `ticket-reviewer` checks each ticket and what it relies on in
  the code, `plan-reviewer` checks the whole plan once at the final end.
- Export puts the tickets into a feature folder with keys shared across the repository (`PROJ-12`),
  all or nothing; the keys are checked again before each commit and push, which keel always asks
  about.
- Ticket states (to do, next, in progress, waiting for a merge, done) read from git: `/keel:tasks`
  shows them in a "Planned" block, and `/keel:start-task` with no words or "next ticket" offers the
  ticket to take next.
- `/keel:start-task <KEY>` starts a planned ticket on its feature branch, a task that turns out to be
  a feature can become planning before any code, `/keel:start-session` takes a feature folder, and
  `/keel:start-planning` reopens an exported feature to edit the tickets nobody started. A ticket is
  marked done only after a passed verification, in the same commit as its code.
- A task's commit, verification and checks leave planning files out, and the usage page lists
  planning conversations with their feature name.

### Changed
- Plan Mode files go to `.keel/local/plans/claude` (was `.keel/local/plans`); `/keel:configure`
  offers to move the old plans.

### Fixed
- keel's own commands could run a step Claude Code must confirm without the confirmation (PowerShell
  5.1's quoting, special spaces), or run a step on another folder than the one keel checked (special
  spaces, a double backslash in Bash); such commands are now refused.

## [1.2.1] - 2026-10-20

### Fixed
- The commit step of a finish no longer stops with `git add failed: ... did not match any files`
  when the work holds a change already staged by hand: a file moved with `git mv` or removed with
  `git rm`. Such changes are committed as they are.
- A tracked secret file moved with `git mv` stays out of the commit on both sides of the move; before,
  its removal from the old path was committed.

## [1.2.0] - 2026-10-17

### Added
- `/keel:configure check` says, without changing any setting, whether the project changed since the last
  configure in ways keel's settings depend on: which sections to run again (needed or only worth a
  look), each with the fact and why it matters, and the command that runs only those. A script does
  the comparison, so the answer is one reply (measured headless: about $0.08 on Sonnet on top of the
  session start). A machine without a record of the last configure rebuilds it once from the commit of
  `.keel/`, in a temporary worktree.
- `/keel:configure gates,git` (or `3,4`) runs several sections in one go, in section order, and writes
  the files once at the end.

### Changed
- The profile counts as stale only when something the configure sections depend on changed, not when
  only package versions or comments in a manifest did, so other commands stop suggesting a re-scan for
  nothing. The note now points to `/keel:configure check`.

### Fixed
- The scan counted one line too many in files that end with a line break (the size of `CLAUDE.md` and
  other files loaded into every session).

## [1.1.2] - 2026-10-17

### Added
- `/keel:usage-clear` deletes all data on your usage page (every machine's days and sessions, the
  machine and calibration documents) after a warning with the period, the sessions and dollars, the
  machines and what it affects, and only on your explicit yes; then it says what was deleted. The page,
  its language and this machine's local logs and calibration stay; the next sync sends only what happens
  after the clear.

## [1.1.1] - 2026-10-17

### Fixed
- The usage page lists only keel sessions: those in which `/keel:start-task`, `/keel:end-task`,
  `/keel:start-session` or `/keel:end-session` ran. Other Claude Code conversations count only in the hourly
  totals the plan-limit calibration needs. Day documents an earlier version sent with every session are
  rebuilt once at the next sync.

## [1.1.0] - 2026-10-16

### Added
- `/keel:usage` gives the link to your private usage page and opens it, in any project.

### Changed
- Setup explains each group of questions first (what the setting is, what it changes, an example,
  how to change it later), in quick setup too.
- Setup asks one decision per question and always offers every option, the recommended one first: the
  git mode question offers both manual and autonomous; Claude Code settings can be taken all, one by
  one, or none.
- Setup advises `/doctor prompt-audit` only when the project or `~/.claude` already had instructions of
  its own (CLAUDE.md, rules, skills, commands, agents), and says why and what it gives.

## [1.0.0] - 2026-10-15

First public release.

### Added
- Two ways to work: tasks for point changes, several at once (`/keel:start-task`, `/keel:end-task`,
  `/keel:tasks`), and long work along one plan across many conversations (`/keel:start-session`,
  `/keel:end-session`); `/keel:help` lists the commands. See [docs/workflows.md](docs/workflows.md).
- Project setup (`/keel:configure`): a quick setup that asks only what needs you (languages, test and
  lint commands, git mode, Claude Code settings, how this machine pays) and a detailed one; any
  section can be changed later on its own.
- Verification at four levels: gates only, Basic, Standard and Maximum. keel proposes a level from
  the real risk of the change (size, modules, security signals, core files) and names data, API and
  dependency changes so you can go deeper; you choose. Serious findings are checked by separate verifiers that try to refute them, a
  QA finding whose reproduce command no longer fails when keel runs it again becomes "unclear", and
  unverified items are marked as such. The report shows the cost of every participant.
- Delegation of planned steps to implementer agents on the model each step needs.
- Git in manual mode (keel gives the commands) or autonomous mode (branches, commits, updates from
  main, pushes); merging into the main branch only on your instruction (or on every finish, when
  configured so).
- Cleanup into a restorable trash (`/keel:cleanup`) and moving over from another notes system.
- A private spending dashboard fed from every machine, and a status line with plan limits.
- Safety for every step that is hard to undo: Claude Code itself confirms finishing a task, dropping
  one, deleting its branch, emptying keel's trash, turning on autonomous git and each merge (unless
  turned off in a confirmed autonomous mode); a finish needs a verification recorded for the code as
  it is; when a git step stops before the commit, the task is put back by itself. See [docs/behavior.md](docs/behavior.md).
- keel stays out of projects it is not set up in: no rules, agents or checks of its own there (Claude
  Code still lists the short descriptions of its commands and agents, as for any installed plugin).
- A behaviour eval suite (`npm run eval`) to run before each release.

### Notes
- Requires Claude Code 2.1.296 or newer (the version it was tested on; keel does not check it at run
  time, and on an older version its hooks, confirmations included, may not work), Node.js 22 or newer
  and git; runs in Claude Code (other coding agents are planned).
- keel's agents run only on Haiku, Sonnet or Opus, whatever model your conversation runs on; with
  "Allow Opus for agents" off, Sonnet takes Opus's place.

[Unreleased]: https://github.com/mvbsoft/keel/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/mvbsoft/keel/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/mvbsoft/keel/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/mvbsoft/keel/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/mvbsoft/keel/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/mvbsoft/keel/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/mvbsoft/keel/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mvbsoft/keel/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mvbsoft/keel/releases/tag/v1.0.0
