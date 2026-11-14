# Changelog

All notable changes to keel are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `docs/features.md` (and its Ukrainian source `docs/features.uk.md`): a short, complete list of what
  keel 2.0 does and which questions it asks in which cases, linked from the top of both READMEs. A
  test keeps the two pages in the same shape and checks that every command and advisory skill is on both.
- `/keel:configure usage` asks which page to join when the account has several titled "keel usage", and
  updating the page no longer stops for the page's owner (the read says "owned
  by you", not "writer").
- `/keel:usage on|off` (and `usage-setup.js <project> sync on|off`) turns this machine's sync on or off;
  the end reports still show the costs, and `on` sends what Claude Code's logs still hold of the time it was off.
  `usage.json` gets `sync` and `sync_off_since`.
- `usage.js audit --page <folder>` compares this machine's dollars and tokens per session on the page
  with the local transcripts and names the difference to Claude Code's own cost. A session too big for
  one page document is compared with all of it, so what the page left out shows as a difference,
  marked "shortened on the page" only when the page left out some of its agents.
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
  stubs: tickets of their own type (`plans.js ticket <f> --title "..." --stub ADM`, `type: stub`)
  with only what needs no code of that repository (no Boundaries, Correct the priors or Where to
  look; How to check in manual steps). Tickets name a stub in `depends_on`; its state is never read
  and it never holds a ticket back; the plan reviewer counts it as covered. Export puts it into this
  project's feature folder as `ADM-S1-<slug>.md`, listed in the overview; the feature page shows it
  with state unknown and a "stub" mark. Once that repository is here, `plans.js check` and
  `plans.js tickets <f>` say so, and `plans.js ticket <f> --from-stub T2` (a draft) or
  `--from-stub ADM-S1` (exported: the ticket in that repository with its next key and
  `replaces: ADM-S1`, which a dependency on the stub key of that same feature then reads) turns it
  into a full ticket, also beside tickets already in that repository's feature folder. A plan of
  stubs only is not exported, and a feature with a stub left is not complete (`plans.js done` names
  it, `plans.js drop` refuses). Exported stubs count as planning files, so a task leaves them alone.
- Exporting a feature on several repositories: `plans.js export` puts each repository's tickets into
  that repository by its own planning settings (prefix, ticket place, main branch) and its own key
  counter after its own `git fetch`, all or nothing across the repositories. Each gets the same
  `README.md` overview, already from 1 ticket, with `repos:`, every repository's tickets and
  `## Parts`; `research/` goes to each repository whose tickets or overview name the report.
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
  in the feature's files is never published: the page is refused with each one named. The
  conversation only finds the page and asks its questions; building, translating and publishing run
  in one Sonnet agent (`skills/_shared/feature-page-build.md`), so the page never stays in the
  conversation: about $0.6-0.75 for a new 6-ticket page translated in full.
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
- `usage.js report --last-turn` prints the end report as one line, for the latest user turn only.
- `docs.adr_style` (`journal`, `living` or `custom`): how a project keeps its decision records.
  `/keel:configure` asks it whenever the project has or will write ADRs, also when moving from another
  system, and first says how the existing records are kept (the scan counts superseded and amended
  records). The `adr-required` skill and the docs reviewer follow only the chosen style; `custom` is the
  project's own rule in the ADR folder's README. Choosing `living` over a journal offers a one-time
  clean-up task that renumbers the records once. `/keel:configure check` says when no style is chosen.
  The skill now also loads before a decision record is written, and editing a file in an ADR folder
  reminds Claude to load it.
  Not set reads as `journal`, which now also asks a new record to restate everything still valid, and
  forbids partial supersedes and links left on a superseded record.
- Price rows for Claude Fable 5.2, 5.1 and 5, so their sessions are priced from their own rows.
- Usage page data: each of your messages now carries what was done after it: the most used tools, the
  agent types, the agents' part of the cost, the tokens and the largest context of one request. keel
  computes it from the logs at sync time; it holds no message text and is sent with or without
  previews. A day too big for one document drops these details first. Days synced earlier get them
  when they are sent again; the session page shows them.

- The keel design system (`plugins/keel/templates/design/`, described in `docs/design-system.md`): one
  look for every page keel makes. `keel.css` holds the colour tokens of both themes, the fonts and the
  shared components, `keel-theme.js` the theme switch and `keel-mark.png` the brand mark. A page opens
  dark, a switch in its header turns on the light theme, and the choice is remembered in that browser
  for that page. The published page carries the three files. `tests/design-system.test.js` checks that
  a page holds no colour literal, that every token is defined in both themes and that text and marks
  reach their contrast.
- Usage page, Sessions: each of your messages opens to show what was done after it (the tools with
  counts, the agents it started and their part of its dollars, its tokens by kind and the largest
  context one request read); a session without such data says so. A "verification level" filter, and
  the list shows 10 rows with "Show more" adding 20.
- Usage page, Analysis: the controls read as one sentence, filters are chips, the numbers are also a
  table with two sets of columns, and "Save CSV" saves it.
- Usage page, Overview: the card "Spend by token kind" shows the dollars of output, cache write, cache
  read and input. Sessions sent before keel kept the dollars by kind are not in it, and the card says how
  many of the period's dollars that leaves out; a period with none of them still shows the tokens by kind.
- Usage page: the two dates of your own period open a calendar in keel's look, not the browser's date
  picker: weeks start on Monday, today and the chosen day are marked, arrows, Page Up and Page Down move
  the day or the month, and the page works with the keyboard alone.

### Changed
- The usage page is rebuilt on the design system. The tabs are Overview (was Dashboard), Analysis,
  Sessions and Plan limit (was Calibration); the old addresses `#dash` and `#calib` still open them.
  One period control in the header serves Overview, Analysis and Sessions. Overview shows the plan
  limit of the week, what was spent in the period, where the money went and the most expensive
  sessions. Plan limit shows what 1 % costs, how it is counted and the latest 5 measurements with
  "show all". The page draws its charts itself and no longer loads a chart library.
- The feature page is rebuilt on the design system, with the same content and functions in a new
  layout: the feature, the ticket in work and the ticket list on the left, the chosen ticket on the
  right, windows for decisions, terms, research and the Markdown file in the centre, and on a phone a
  ticket as its own screen with a way back. Its script is `page.js`, published beside the page.
- keel's commands need fewer requests and read less text:
  - a command reads `preflight.md` only when the settings check is not plainly `ok`; its rules for the
    whole command stand in each command;
  - steps that need nothing from each other run in one message: configure's five scripts, its
    `safe-command.js` checks, the lint and type gates, the cleanup reminder with the final report;
  - `git-flow.js save` commits, updates from the base, pushes and (in a task handoff) switches back in
    one call; it stops on a conflict, and before the push when the update brought new commits (the
    gates run again first); a finish in it needs `--sync`;
  - `changes.js --start` prints the comment check's notes first and then starts the verification, so
    no separate `comments.js` run is needed; after a fix for a note it runs again;
  - `notes.js task new` takes `--branch`, `--base`, `--merge-into`, `--execution` and `--plan-file`
    (a text file in the project or Claude Code's plans folder, never a secret file), and
    `notes.js check` prints `head:` and `today:` for the note's fields;
  - rarely needed parts of the shared instructions (a task becoming planning, resuming a task or a
    session, manual git, the end of a feature, an exported feature, configure's plugins, migration,
    price update and instruction check) are files of their own, read only in their case;
  - a skill hint carries the skill's rules, so no extra step loads the skill;
  - review agents read and search in batches; the test reviewer reverts once and runs the chosen tests
    in one command;
  - the agents' descriptions, loaded into every session of every project, are about 100 characters.
- The note, memory and each task file also have a limit of 12000 characters (with 150 lines); a note
  of short lines and very long ones no longer passes unnoticed.
- Task branches, git steps and planned features check a branch name by one rule (git's own, without
  names such as `@` or `@{-1}`); a planned feature's branch also keeps to letters, digits, `.`, `_`,
  `/` and `-`.
- keel no longer teaches one deploy style for schema changes (expand → migrate → contract over several
  releases, both app versions against every intermediate schema). On a risky change to a table with
  data or to an API others can call, it offers the ways to do it for that change, from several releases
  to one migration, with how to undo it or back up the data it destroys, and builds the one you pick; a
  rule in the project's rules settles it. A very risky pick is asked about twice and written down. The
  reviewers check a change against the pick instead of reporting "not expand/contract", and
  `migration-safety` is suggested only when a migration is edited or written, not read.
- The usage page sync at the end of `/keel:end-task`, `/keel:end-session` and `/keel:end-planning` runs in a
  small Haiku sync agent: about $0.07-0.20 per end of work instead of $0.15-0.55, because the long session no
  longer re-reads its conversation for every step of the sync. The docs and `/keel:configure usage` give
  these costs in dollars (measured for a medium session, computed for short and very long ones) instead
  of the old estimate.
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
- A planning draft's `plan.md` has In plain words, Level, Contract and What was gathered instead of
  Summary and Problem / Goal; `plans.js find` reads In plain words.
- The feature overview `README.md` takes the plan's In plain words, Level, Decisions, Contract, Out of
  scope and Terms (no more Design sketch) and lists the feature's tickets: key, title and
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
- The context warning is in the conversation language you set (`conversation_language`).

### Fixed
- The setup `/keel:configure` writes and you leave uncommitted (`.keel/config.json`, `.keel/profile.json`,
  `.keel/.gitignore`) now goes into the first task's commit. Before, the task start recorded it as
  your own untracked files, so the commit left it out and it stayed uncommitted on the main branch.
- `/keel:configure` no longer proposes an audit that needs a lock file (`npm audit` and similar) for a
  part without one (it failed with `ENOLOCK` on every task); the scan names the ecosystems without one,
  `(no lock file: python)` (`findings.no_lock_file`), and counts a workspace root's lock and a
  git-ignored one. Quick setup no longer says that missing scanners stay in the list, and a
  repository without `origin/HEAD` is no longer reported as having no remote.
- A Ukrainian conversation no longer slips into Russian: long planning conversations did, after
  English agent reports. A new hook, `language-guard`, sends a reply with even one Russian letter or
  word (outside code, also in quotes and when the user asked for Russian) back to be written again
  without Russian, and reminds of the conversation language after each agent report; the session
  start says it too.
- `/keel:configure` recommends the ADR style the project's own rules already describe.
- `/keel:cleanup` shows the found items before it asks which numbers to move, and a git step that
  needs `git-flow.js trust` offers to run it instead of handing over a command with `<project>` in it.
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
  `| <30 s | >1 min |`, `<30 s, then >1 min` or anything in a code block indented under a list item
  or fenced with `~~~`, such as a mermaid diagram. A code block that is never closed is reported, so
  the text it would hide is not taken as clean.
- A finish with `/keel:end-task`, and `/keel:end-session` with verification, ask for the level when
  the command names none, also when a brief, the session note or memory names one: that level is
  shown as advice next to the recommended proposal.
- After the first task took keel's setup into its branch and was handed off, the main branch looked
  not configured and every command offered `/keel:configure` again. The check now finds the settings
  on a local branch, keel says which one and offers to switch there (or names the folder, when that
  branch is checked out in another worktree); it never commits them to the branch you are on, and
  `/keel:configure` does not start a fresh setup there unless you insist. Taking the setup into a task
  whose branch already exists no longer stops without a way forward.
- `/keel:cleanup` after a migration of loose notes no longer lists the whole project as "left in an old
  notes system"; it does not enter another checkout, such as another conversation's worktree under
  `.claude/worktrees/`; and its reply is the list itself with the question as its last line, in plain
  text.
- A source file that is only named like a secret (`secrets.py`, `credentials.ts`) is code: reviewers
  see its changes, and keel's commits include it when git already tracks it (they left it out
  before). A new file with such a name is still left out of keel's commit and listed, because it may
  hold keys: commit it by hand once if it is code. `.env*`, keys, certificates, `credentials.json`,
  `secrets.yml` and the like stay hidden.
- The supply-chain audit plugin is proposed for a project that has a lock file (the ecosystem names
  did not match before). The scan gives a Flutter project `flutter test`, finds uv workspace members,
  and matches a workspace member named by one folder (Cargo `core`, Gradle `:app`) only at its own path.
- keel no longer runs `git worktree prune` in your repository.
- A reviewer's finding with an optional field written as `null` is no longer thrown away as invalid.
- The filter for project check commands refuses database wipes and schema changes (Prisma, Alembic,
  Flask, Django, Rails, TypeORM, Drizzle, Supabase, Diesel, sqlx, Flyway, Redis flush, Mongo drop,
  `dropdb`, `mysqladmin drop`, raw `DROP` and `TRUNCATE`), also when options stand between the tool
  and its action or the package has a version (`prisma@latest`). It no longer refuses a test file
  named after a migration (`migrate.test.js`, `db_migrate_test.go`).
- The attribution filter keeps an ordinary sentence that names a person, such as "Written by Claude
  Shannon.", and catches product names (`Claude Desktop`, `Gemini Advanced`) and `gpt-` names.
- A merge from a worktree whose target branch is checked out in another folder says where and what to
  do, instead of git's raw message.
- The language guard also catches common Russian words that have no Russian-only letter (such as
  «проверил»), and works when the conversation language is written `ua`, `ukr` or `українська`.
- Ukrainian texts: «ви» in every message, «за днями», «за проєктами» on the usage page, one word each
  for hours (год), calibration readings (замір) and gates (перевірки).
- The status line on Windows shows Cyrillic folder and branch names correctly.
- The usage page's default period ends on the current UTC day, so evening spend in time zones behind
  UTC is no longer cut off. `history_days: 0` is refused (1 or more), and `/keel:usage on` says what
  goes to the page before the first send.
- Planning: review findings are written as `undecided` before you are asked, so a conversation that
  stops loses none and the next one shows them; a later review round gets the exact paths of the
  earlier decisions; a failed review report gets a new reviewer run; `other` is a finding's check only.
- Planning: a `## ` line inside a code block of `plan.md`, or a section written twice, no longer cuts
  the exported overview, a brief or the draft search; the check reports the repeated section.
- `/keel:feature-page` takes a ticket's own branch as its feature, offers only the features this
  working tree holds, skips the fetch for a draft, and a title that contains `{{DATA}}` no longer
  breaks the page.
- Planning, smaller: a stub key in a review report, the `--draft-dir` name in a refusal, "exported
  already" on a repeated export, `status: "draft"` in quotes, two ticket files with one number reported
  by the check, and `file:` lines usable with `git show` when the project is a subfolder of its
  repository.
- Planning texts: a stub key given to `/keel:start-task` is explained, removing a ticket that nobody
  started has its steps (after a fetch, so a ticket started on another machine stays), and a finished
  export offers `/keel:feature-page`.
- Review agents that run code write it to a script file; they no longer pass it inline (`node -e`),
  which the command filter refuses.
- `/keel:help` lists `configure machine`, `cleanup restore` and `cleanup empty-trash`. Resuming a
  session in manual git gives `git switch <branch>` when the note's branch differs.
- Docs: the Maximum level's agents, the number of quick-setup questions (11 to 18), the two Stop hooks
  and what happens to a finished task when verification stays red now match the behaviour.

### Removed
- `approved_artifact_urls` and `page_shared` in `~/.claude/keel/usage.json`.
- `language`, `export`, `export_dir` and `prefix` in `.keel/local/plans/keel/settings.json`, and their
  `plans.js settings set` options: the project's `planning` section replaces them. Values saved there
  are not carried over: set them again with `/keel:configure planning`.
- The Ukrainian copies of the documents in `docs/` (`docs/*.uk.md`); only `README.uk.md` stays.

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
