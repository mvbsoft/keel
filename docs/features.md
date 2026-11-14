# What keel 2.0 does and what it asks you

[Українська](features.uk.md)

keel guides your work on a project in Claude Code by fixed rules. At the start it works out the task and
makes a plan. While you work it writes code to your standards. At the end separate agents check the
change, keel does the git work and shows what it cost. It works in a project where you have run
`/keel:configure` once.

| Command | What it does |
|---|---|
| `/keel:configure` | sets keel up for a project or for this computer |
| `/keel:start-task` → `/keel:end-task` | one task: understand, plan, do; then verify and commit, or hand it off |
| `/keel:tasks` | unfinished tasks and planned tickets; `drop` removes a task |
| `/keel:start-session` → `/keel:end-session` | big work by a plan, day by day |
| `/keel:start-planning` → `/keel:end-planning` | think a feature through without code and split it into tickets |
| `/keel:feature-page` | a private page for a planned feature |
| `/keel:usage` | a private usage page with data from all your computers |
| `/keel:cleanup` | move extra files to the trash, restore them, empty the trash |
| `/keel:help` | a short help on the commands |

**What runs by itself, without a command:** working standards in every conversation, a warning
before the context fills up, a ban on AI signatures in commits, protection of Ukrainian
conversation from Russian, cost tracking
([details](#what-runs-by-itself-without-a-command)).

**How keel asks.** Every decision is a separate question with all the options. The recommended one
is marked, and the reason is explained. One message can hold up to four short questions. keel does
not guess at an unclear instruction, it asks again. Before every action it says in one line what it
is about to do.

There are two kinds of questions. keel asks in the chat. And before eight steps that are hard to
undo (merging, deleting a branch, emptying the trash and others,
[list below](#what-runs-by-itself-without-a-command)), Claude Code itself also shows its own
confirmation window, even if you allowed such commands.

After a command you can write an instruction in your own words, and keel will not ask about what it
already says: `/keel:end-task finish, level standard, merge into main`. In the task, session and
planning commands there are no keywords: "park it", "hand it off", "prepare for tomorrow" mean the
same. A level word (`gates`, `basic`, `standard`, `maximum`, `none`; `quick` means `basic`) works
when it stands alone or after the word "level".

**What keel does not do without your word.** It does not merge branches unless you ask (or you
turned off "ask before merging" in the settings). It never commits to the main branch by itself and
never force-pushes. It deletes nothing for good without a separate confirmation: tasks and extra
files go to keel's trash, and only emptying the trash, deleting a branch and `/keel:usage clear`
delete for good. It does not install new packages without your "yes". It does not change the model
of your conversation.

**What it costs** (at list prices; on a subscription this is not money but a share of your plan
limits):

| What | Price |
|---|---|
| verification: gates only (tests, linter, types, scanners; no agents) | ≈ $0.2 |
| Basic verification: one reviewer and up to 2 verifiers | ≈ $0.25–0.5 |
| Standard verification: reviewer, bug hunter, architect, QA, test reviewer, up to 4 specialist groups | ≈ $1.4–4.3 |
| Maximum verification: the same but deeper, mostly on Opus, security always | ≈ $2.7–7.6 |
| usage page update at the end of work | ≈ $0.07–0.20 |
| feature page (6 tickets with a translation) | ≈ $0.6–0.75 |
| update of model prices or of the usage page template | ≈ $0.1–0.3 |
| standards and command descriptions in every conversation of a configured project | ≈ 3.8k tokens |

Level prices were measured in October 2026 on 8 changes, on keel 1.0:
[verification](verification.md#cost).

The details of each case are in [Commands](commands.md), all settings in [Settings](settings.md),
and how everything works inside is described in [Under the hood](under-the-hood.md). The tables
below show *what* keel asks; the exact words depend on the case.

## Three ways to work

| Way | When | Commands |
|---|---|---|
| Task | one thing that can be finished in 1–3 conversations: a ticket, a bug, a small change | `/keel:start-task` → `/keel:end-task` |
| Session | big work over weeks: there is a plan and a "Later" list | `/keel:start-session` → `/keel:end-session` |
| Planning | first think a feature through and split it into tickets, no code | `/keel:start-planning` → `/keel:end-planning` |

A feature here means one finished capability of the product that you can explain in one sentence
("export invoices to CSV"). One conversation runs only one of the three ways. In a planning
conversation the task and session commands do not run, and in a task or session conversation
planning does not run. `/keel:end-task` in a session conversation and `/keel:end-session` in a task
conversation do nothing: keel names the right command and stops.

Questions shared by the start of a task and of a session:

| When | What it asks | Options |
|---|---|---|
| you start a task, and a session is already running in the conversation (or the other way round) | Finish the current one first, or open a new conversation? | finish / new conversation |
| this ticket (for example CAN-123) is already being worked on in another way | Nothing: it advises to continue it with the matching command | — |
| the same ticket is recorded both in a task and in a session note | Where to continue it? | as a task / in the session |
| the ticket was found by searching its number | "Is this it?" | yes / give a link or text |
| this work was finished or removed before | Start it again? | yes / no |

## Commands

### `/keel:configure`: set up keel

**What it does:**
- Scans the project (languages, parts of a monorepo, test, linter and type commands, CI, security
  scanners), runs the commands it found once as a trial and proposes settings. It writes them only
  after your "yes".
- Quick setup (11–18 questions, the rest comes from recommendations) or detailed setup (every
  section).
- `machine` sets up only this computer for all projects. `check` only says what is worth
  reconfiguring and why. A section name runs only that section: `languages`, `scan`, `gates`, `git`,
  `verification`, `code`, `planning`, `plugins`, `docs`, `migration`, `settings`, `usage`, `prices`.
- There are three languages: the conversation language (any), the language of files in the
  repository (commits, notes) and the language of tickets. keel's own texts (the cost report,
  warnings, pages) come in English and Ukrainian.
- Sets up Claude Code (context compaction at 300k, output limit, no AI signature, verification
  commands without asking permission) with backups.
- Sets up cost tracking: what you pay with on this computer, the usage page, prices, the status
  line. Claude Code gives out plan limit percentages only through the status line; you can keep your
  own line, keel wraps it and changes nothing in it.
- Recommends proven plugins for your stack and can move notes from another note system.
- Repairs incomplete or broken settings: asks only about new fields, or about each problem
  separately.

**What it asks** ("detailed" means quick setup does not ask but takes the recommended value):

| When | What it asks | Options |
|---|---|---|
| plugin installation | Conversation language; whether keel's agents may use the Opus model; where to turn keel on | language code; yes / no; for you / for the project / only for you in this project |
| a keel command (except `help` and `usage`) and there are no settings or they are broken | "Set up now? It is a few questions." | yes / no (the command does not run) |
| any keel command and there is no git | Create a repository and a first commit? | yes / no |
| the settings are on another branch | Switch to it or stop? | switch / stop |
| at the start, except `/keel:configure machine` | Set up this project or only this computer? | project / only the computer |
| a new project | Quick or detailed? | quick / detailed |
| settings already exist | What to change? | a section (keel names which are worth it) / a new scan / everything |
| languages | Conversation language and language of files in the repository | keep / another |
| verification commands | Accept, change or remove each found command; run them once as a trial? | accept / change / remove; yes / no |
| git | Git mode and base branch; detailed also: ask before merging, keep keel's notes and tasks in git | manual (for a first project) / autonomous |
| planning | Ticket prefix and where tickets live; detailed also the ticket language | in the repository / only on this computer |
| ADRs exist or will exist (short records of why an architectural decision was made) | ADR style | "living" (one record per topic, always current) / "journal" (old records are not edited, a new decision is a new record) / your own way |
| Claude Code settings | All recommended, one by one, or none | all / one by one / none |
| cost tracking (when this computer does not have it yet) | What you pay with; status line; keep a usage page (not with an API key) | subscription / API key / both; keel's line / wrap yours / skip (then no plan limit percentages); yes / no |
| the end | Shows the settings files and asks for a "yes"; asks whether to commit them now | yes / change; now / leave for the first task |

<details>
<summary>Questions of detailed setup only, and rare cases</summary>

| When | What it asks | Options |
|---|---|---|
| parts of the project (detailed) | Are the parts of the project detected correctly; the command to run the app | yes / fix / remove a part |
| a trial run of a command failed | Keep, fix or remove the command? | keep / fix / remove |
| scanners (detailed) | Which security scanners; gitleaks through Docker if it is not in the system? | for each |
| verification thresholds (detailed) | From what change size keel recommends a higher level and how many agents verify findings | keep / change |
| file size (detailed) | Warning at 700 lines, limit 1000 | accept / change |
| comments (detailed) | Comment level: only hard places / also a line on each public function / detailed | recommended for your code / the other two |
| references in code (detailed) | Which ticket prefixes to look for in comments; whether ADRs may be referenced | allowed / forbidden |
| plugins (detailed) | Which plugins for your stack (nothing is pre-selected) | several from a list |
| you chose a language server plugin and its program is not installed | Did you install it? | check again / skip for now |
| documentation (detailed) | Profile: 1 only keep documents true / 2 also ADRs / 3 also a description of each feature / 4 full documentation; for 3–4 also a template (Diataxis, arc42) | proposed / others |
| "living" style and old records have history | Prepare a one-time ADR cleanup as the first task? | prepare / not now |
| the template differs from existing documents (detailed) | Prepare moving the documents, with a price estimate? | prepare / not now |
| another note system found | Move notes now, later or never; then a move plan (old files to the trash or to an archive) | now / later / never; all / change |
| something in the moved notes looks like a secret | Remove the line? | remove / keep |
| a setting that applies to all projects of the computer (conversation language, Opus, compaction) | Keep the computer's value or set your own for this project? | keep / for the project |
| plan files | Keep them in the project and move the old ones there? Add `settings.local.json` to `.gitignore`? | yes / no |
| cost tracking (detailed) | Computer name and email; show the start of each request on the page (100 characters, secrets hidden) | yes / no |
| there is no usage page yet or there are several | Create a private page? Which of several to take? | create / choose |
| prices | Update model prices (shows the difference)? | update / skip |
| plugins or scanners chosen | Add a "Working with Claude Code" section to the README? | yes / no |
| the project's own hook does not let `node` run (for example, everything in containers) | Add a narrow exception only for keel's scripts, or stop? | exception (shows the change) / stop |
| a section name is not recognized | Which section? | list of sections |

</details>

### `/keel:start-task`: start or continue a task

**What it does:**
- Starts from a link (Jira, Linear, Asana, GitHub, Google Docs, any page), a ticket number, a file
  or your words. It reads a link itself; if it cannot, it asks you to paste the text and invents
  nothing. With no words it shows unfinished tasks and the next planned ticket.
- Retells the task in a few lines (goal, how to tell it is done, what is out of scope) and checks in
  the code that what the task relies on really exists.
- A simple plan (one module, 1–3 files, no new public interface) it shows right in the chat.
  Everything else it plans in Claude Code's plan mode (files do not change until you approve the
  plan), with a table of steps.
- Creates a branch and a task folder. Works here, through implementer agents, or in a new
  conversation from a saved plan.
- A planned ticket: checks its state, who else works on it and whether the tickets it depends on are
  ready (also in other repositories); takes the feature branch.
- Coming back to a task: switches to its branch, says if new commits appeared in the base branch,
  runs the gates once, rereads the task in the tracker and says what changed.
- A task too big for one it offers to plan first as a feature. For a new conversation it writes a
  short brief (goal, files, decisions, open questions) and gives a ready command, so that what was
  found is not lost.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| another task is active | Hand off the current one first or continue it? | hand off / continue / leave as is (when there are no uncommitted changes) |
| no words | Which task to continue, or what the new one is? | unfinished / next ticket / your own |
| new or continued | "This is the unfinished task X: continue?" or "New one, right?", with a name | continue / new / change the name |
| a vague goal or a real design choice | Turn on brainstorming (2–3 approaches, plan in parts)? | yes / no, the usual way |
| the usual way | 1–3 questions only about what the code does not show | free answer |
| a simple plan | "Start?" and the branch in the same question; on the main branch it warns | new branch / current / your own git steps |
| a complex plan | Approve the plan and the table of steps; if the plan is big (8+ steps or 15+ files), also how to carry it out | yes / change; new conversation / implementer agents / here |
| there are uncommitted changes before changing the branch | Hand off the current task or commit the changes? | hand off / commit |
| the ticket is already in progress | Continue, start over or take another? If nobody touched it for 30 days: treat as free? | continue / start over / another; yes / no |
| the ticket this one depends on is not ready | What to do? | depends on the case: take the next ticket / wait / merge its branch in (if it is in this repository) / start anyway |
| the task is too big (10+ steps or 40+ files) | How to go on? | new conversation from planning / plan here / do not split |

<details>
<summary>Rare cases</summary>

| When | What it asks | Options |
|---|---|---|
| only keel's settings files changed | Take them into this task's branch? | yes / no |
| the ticket is already done | Start again? | yes / no |
| the ticket branch was just created | Push it so others see that the ticket is taken? | yes / no |
| the task is too big and code already exists | The finished part works on its own: finish it and plan the rest. No: continue in the task branch as in a feature branch, or finish first? | depends on the case |
| the task goes to planning and has its own branch | Delete the branch? | yes / no |
| coming back: new commits in the base branch | Merge them into the task branch (commit unsaved work first)? | yes / skip |
| coming back: the task in the tracker changed | Says what changed; rewrites the goal or criteria only after a "yes" | yes / no |
| coming back in a new conversation with a big plan | Implementer agents or here? | implementers / here |

</details>

### `/keel:end-task`: finish or hand off a task

**What it does:**
- Finish: verifies the whole task (all its commits, not only this conversation's) at the chosen
  level. After your confirmation it moves the task folder to the trash, then commits, merges in the
  new commits of the base branch and pushes. So the task files will not be in the main branch.
- Hand off (park): gates only, writes the state into the task file, commits it as unfinished in the
  task branch and pushes, so you can continue on another computer or in another conversation. If
  tests or the linter fail, that goes into the open questions and is not fixed.
- The git steps above keel does itself in autonomous mode; in manual mode it gives ready commands in
  the report.
- After a passed verification it marks the planned ticket as done in the same commit; says when the
  whole feature is ready.
- If a git step stopped before the commit, it restores the task itself and says what happened.
- At the end the [report and costs](#report-and-costs).

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| no instruction | What do we do? | finish fully / hand off / your own instruction |
| the instruction is ambiguous ("just push") | Finish or hand off? | finish / hand off |
| finish, no level named | Verification level, with the price | see [Verification](#verification) |
| the task folder goes to the trash | Claude Code asks you to confirm the task is done | yes / no (the task stays active) |
| hand off, but the instruction says merge | Finish the task instead, or merge anyway? | finish / merge |
| there is no task file | Create it from the conversation or verify without a task? | create / verify without |
| several tasks and it is unclear which; or the task is on another branch and there are uncommitted changes here | Which one? What to do with the changes? | list; free answer |

### `/keel:start-session`: continue or start big work

**What it does:**
- Reads the note `.keel/next-session.md`, sums it up in 3–6 lines (goal, where we are, what is done)
  and names the next action.
- Carries out your instruction to the note ("only tests") and adds the extra work to the plan.
- Switches to the note's branch; shows what changed in git after the note.
- Starts a new line of work from a plan file, the feature's tickets, a link or a description.
- With no note and no instruction it looks for work itself (project memory, plans, TODOs,
  `git status`) and proposes 1–3 options. It never starts a task by itself.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| the instruction is about other work than the note | Continue the note's work or start new? If new: close the old or move its steps to "Later"? | continue / new; close / move |
| the plan is done, there is a "Later" list | Which 1–3 items to take into the new plan? | choice |
| there is no note and no instruction | Which of the 1–3 found to take? | choice / your own |
| the note is marked as blocked by open questions | They come first | answers |
| a new line of work | Shows the plan: "Start?" | yes / change |
| uncommitted changes before switching the branch | What to do with them? | free answer |
| a big plan (8+ steps or 15+ files) | How to carry it out? | new conversation / implementer agents / here |

### `/keel:end-session`: finish a session

**What it does:**
- With no instruction: verifies, prepares the note for next time and proposes "Next time: …".
- "Prepare" or "continue tomorrow": gates only, then the note.
- An action in the instruction ("push", "merge into main", "open a PR"): verification, note, then
  the action.
- "The work is finished": the note gets the status "done".
- Writes the note (goal, plan with marks, "Later", next action), the project memory and the session
  log. It compresses the note if it is larger than 150 lines or 12000 characters.
- Marks tickets whose steps are all done as done after the full verification.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| full verification with no level | Verification level, with the price; the level from the note is only advice | see [Verification](#verification) |
| an ambiguous instruction | Asks again | free answer |
| after the report | "Next time: … Agree or change?" | agree / change |

### `/keel:start-planning`: plan a feature

While you plan, the tickets lie in a draft (T1, T2…). The export at the end turns them into real
tickets with numbers (PROJ-12) in the feature folder.

**What it does:**
- Plans a feature in a separate conversation: one question at a time, decisions and short tickets in
  the draft. It writes no code: in this conversation keel blocks changes to project files except the
  plan files.
- Reads a link or file, retells the goal, who it helps and what is out of scope, and checks in the
  code that what the feature needs really exists.
- Before the first question it can collect a map of the project, look at other repositories and
  search the internet; it names the price of each step in words.
- Proposes 2–5 feature levels (tickets, price, risk) when there is at least one sign of complexity:
  several real options, a public API, data integrity, money or security, a change that is hard to
  roll back. Otherwise it gives one simple answer.
- Looks at the plan from three sides: product, architecture, operations and security.
- Writes tickets by a template: in plain words, acceptance criteria, how to verify, limits, where to
  look.
- Plans across several repositories of this computer. For a repository that is not here it can put a
  stub ticket: a short ticket that becomes a full one when the repository appears.
- Continues an already exported feature: edit tickets that are not started yet, add new ones.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| the first time | Where does the draft live? | on this computer / in the repository |
| no words | Which draft to continue or what do we plan? | list / new |
| the words matched a draft | "Continue X?" or which of several | yes / choice / new |
| a new feature | Name; where tasks will be merged (if there are several branches) | proposed / your own |
| a one-task feature | Recommends `/keel:start-task`; you decide | task / planning |
| briefly described, big or across several repositories | Gather information first (each with a price)? | all / part / nothing |
| there is a sign of complexity | Feature level | one of 2–5 / your own |
| a package could be used | Own code, an existing package or a new one; check up to 2 packages on the internet? | choice; yes / no |
| a risky data or API change | An option from [Risky changes](#risky-changes) | see there |
| before the tickets | Proposals from three viewpoints, each separately | take / skip |
| a draft in the repository | Create a branch for it or switch to it; then "Commit the planning files?" and "Push the branch?" | yes / no |

<details>
<summary>Several repositories, an exported feature and rare cases</summary>

| When | What it asks | Options |
|---|---|---|
| the feature seems to touch other repositories | Which other projects; what to do with a repository that is not here; ticket prefix of the new repository | yes / some / path / no; similar from the list / stubs / without it |
| a stub ticket, and the repository is now here | Make a full ticket from it? | yes / no |
| an exported feature | Switch to its branch; every ticket change; delete a ticket that is not started yet | yes / no |
| another conversation of this project has an active task | Draft stays on the computer for now, a separate copy of the repository (worktree) or at your own risk? | these three |
| a project rule contradicts keel's choice | Quotes the rule and asks | as in the project / keel's choice / your own |
| a new dependency, datastore, protocol, module boundary | Write a short ADR? | yes / no |
| over ≈15 tickets | Split the feature in two? | yes / no |
| an unresolved reviewer finding is left in the draft | What to do with it? | fix / park as a question / reject with a reason |
| the link cannot be read | Paste the text | text |
| you abandon the plan | Confirm | yes / no |

If planning is not set up yet, keel asks nothing: it asks you to run `/keel:configure planning` in a
new conversation.

</details>

### `/keel:end-planning`: park a plan or finish and export

**What it does:**
- Park: reviews the changed tickets, records the findings, updates the open questions and the next
  action.
- Finish: checks that there are no open questions, reviews the tickets (fixed ones again, up to 2
  rounds) and the whole plan once, then exports the tickets to the feature folder with numbers by
  prefix.
- A multi-repository feature: each repository's tickets go into it, with its prefix and numbers; all
  of them or none.
- Picks the mode itself from your words ("continue tomorrow" or "final") or from the state of the
  plan.
- Commits and pushes the planning files only after a "yes"; does not open a pull request.
- Always, even after a "no", frees the conversation from planning so that the task and session
  commands work again.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| no instruction and no open questions | Final and export, or park? | final / park |
| a reviewer finding | What to do with it? | fix / record as a question / reject |
| the final is blocked | Shows what blocks it; park? | yes / no |
| big fixes in the final | One more review of the plan? | yes / no |
| a fix after the second round | Accept as verified or park? | accept / park |
| export | Names where and with what prefix: "Export N tickets now?" | yes / no |
| the branch is not ready in one of the repositories | Create or switch it, wait, or export as is? | these options |
| commit and push | "Commit the planning files?", "Push the branch?" (one question for several repositories) | yes / no |

### `/keel:tasks`: list of tasks and tickets

**What it does:** shows unfinished tasks (on all branches) and planned tickets by feature, with the
state and the next ticket; one task in 3–6 lines; tickets of the same feature in other
repositories. keel reads the states (to do, in progress, waits for merge, done) from git and files,
with no tokens. So work that has not been pushed yet shows as "in progress" only on your computer.
`drop <id>` shows everything the task left behind (folder, branch, commits, code, documents) and
removes only what you choose; the folder goes to the trash.

**What it asks:**

| When | What it asks | Options |
|---|---|---|
| a task was handed off 30 or more days ago | Proposes to remove or finish it | remove / finish |
| all tickets of a feature are done or wait for merge, no stubs | Proposes to complete the feature | yes / no |
| the view of a feature differs across repositories | Which version is right; then commit and push | choice; yes / no |
| `drop` | What to remove; Claude Code confirms the folder and the task's own branch separately; roll back commits already in the base branch? | all / part; yes / no |

### `/keel:feature-page`: feature page

**What it does:** creates a private page of a planned feature in your claude.ai account (overview,
tickets with states, research) and on a repeat run updates the same page from any computer. It
first fetches the fresh state from the remote repository. `--lang` sets the page language,
translations are kept. It never overwrites someone else's page. With only an API key and no
claude.ai there will be no page.
The page opens dark, and a switch in the header turns on the light theme; the choice is remembered in
this browser. On the left are the feature, the ticket in work and the list of tickets, on the right the
chosen ticket; decisions, terms, research and the Markdown file open in a window in the centre. On a
phone a ticket opens as its own screen with a back button.

**What it asks:** which feature (if there are several; it does not offer a feature from another
branch but says to switch); which of several pages to update or create a new one; if no page was
found among the recent ones: give a link or create a new one.

### `/keel:usage`: usage page

**What it does:** gives the link to the private "keel usage" page and opens it. The page has tabs:
"Overview" (week and 5 hours as a percent of the limit, forecast, costs by day and by model, where
the money went), "Analysis" (filters and grouping by project, computer, model, agent; a table and
"Save CSV"), "Sessions" (search, filters, CSV export; a session shows the cost of each of your
messages and, once opened, what was done: tools, agents, tokens) and "Plan limit" (what 1 % of the
plan costs and how it is counted). The page opens dark, and a switch in the header turns on the
light theme. `off` turns off sending from this computer. `on`
turns it on again, and the next end of work sends what is still in Claude Code's logs (30 days by
default). `clear` deletes this computer's data on the page. When the page is set up, at the end of
every task, session and planning a small agent on Haiku updates it.

**What it asks:** turn off sending (first says that a long break will leave a gap); which page to
take or create a new one; update the page template; `clear`: "Delete this computer's data on the
page?" ("No" comes first; says this cannot be undone, and the data of other computers stays), and
Claude Code confirms every deletion.

### `/keel:cleanup`: clean up the extra

**What it does:** finds extra things (temporary files, copies, caches, traces of an old note
system) and splits them into three groups: safe, check, do not touch. Moves only the chosen ones to
the trash; does not touch secret files. When needed, after the move it runs the checks and puts
everything back by itself if the move broke them. `restore` brings back what was moved.
`empty-trash` deletes for good what has lain in the trash for over 30 days (or one named move, or
everything); keel never proposes it itself.

**What it asks:** "Move the safe ones? Add or remove numbers?"; for each "do not touch" item a
separate question about what could break; if tests were failing even before the move: move again?;
`empty-trash`: only Claude Code's confirmation.

### `/keel:help`

A short table of commands and how they relate. Asks nothing and runs nothing.

## Shared by several commands

### Verification

The levels and their prices are in the table [at the top](#what-keel-20-does-and-what-it-asks-you);
the fifth option is "no verification". keel proposes a level by the size and place of the change
(for example, a file that many others import raises the level) and shows the price before and
after. A separate agent checks serious findings, and everything is merged into one list. The code
does not change until you say what to fix. Exception: comments that break the rules, and tests or a
linter that this change clearly broke, keel fixes at once. After the fixes it runs the gates again,
and a separate agent checks each fix once.

| When | What it asks | Options |
|---|---|---|
| no level named | Level, with the price and the agent set | gates only / Basic / Standard / Maximum / none (the proposed one is marked); you can add or remove agents |
| this same code was already verified at the same or a higher level | "The result will be the same, and so will the price. I do not advise it. Do it anyway?" | no / yes |
| there are "must fix" or "should fix" findings | What to do with each item? | fix / skip / not a problem |
| tests or the linter were failing even before the change | Fix first or continue with a note in the report? | fix / continue |

<details>
<summary>Rare cases</summary>

| When | What it asks | Options |
|---|---|---|
| new files and there is no record of the start of the task | Do they all belong to the task? | yes / name the exceptions |
| there are task requirements and the verification has no documentation group | Add it? | yes / no |
| an agent changed files | Revert the files or look together? | revert / together |
| an agent crashed or did not finish in time | Retry once? Continue or accept as is? | yes / skip; continue / as is |
| while fixing, an item turned out to be false, or the re-check sees a problem further on | Stops and asks | your decision |
| not a git repository | Create a repository with a first commit of the state before the task? | yes / no |

</details>

### Risky changes

Before changes to data tables (renaming, deleting, changing a type, NOT NULL with no value, mass
UPDATE/DELETE) or to an API that others use, keel stops, explains the options for exactly this
change and does the chosen one. It records the choice. If a rule in CLAUDE.md or AGENTS.md already
settles it, keel names the rule instead of asking (a second question about something very dangerous
is still asked).

| When | What it asks | Options |
|---|---|---|
| a change to a data table | How to roll it out? (the recommended one is marked) | three releases / two / one with a maintenance mode (if the project has one) / one, just apply |
| a change to a data table | How to roll back? | migration back / fix forward |
| data may disappear | How to keep it? | project backup / archive table / one-time export / nothing (says what is lost) |
| an API that others use changes | How to change it? | do not change / new version / both fields for a while / deprecated with a date / at once and tell the clients |
| a very dangerous choice (data lost for good, cascade delete, a long lock and so on) | A second question with the project's numbers | recommended / another / "Do as I said, all risks are on me" (there is no third question) |

### Git

Two modes. Autonomous: keel itself commits, merges in new commits of the base branch, pushes and
switches branches. It commits and pushes unfinished work into its branch so that it does not stay on
one computer. Manual: keel gives the files, messages and ready commands and itself runs only the
step you asked for. In both modes it does not add secret files to a commit.

| When | What it asks | Options |
|---|---|---|
| autonomous git is not yet allowed on this computer | Let keel do git steps without asking each time? | yes / ask at every step |
| verification failed, and the instruction says push or merge | Stops and asks before any git step | your decision |
| a conflict while merging in the base branch's commits | Resolve together or leave it to you? | together / you |
| after that tests or the linter fail | Fix now or stop? | fix / stop |
| the branch is protected | Create a pull request now? | yes / no |
| the feature is ready (one question at a time) | Switch to the feature branch; keep or delete the tickets; merge the feature; delete the branch after merging | yes / no; keep / delete |

### Implementer agents

When a plan has 8+ steps or 15+ files (the thresholds can be changed), keel advises a new
conversation from a saved plan or an implementer agent for each step (Haiku, Sonnet or Opus by
complexity). keel runs the tests itself. If Opus for agents is turned off, such steps go to Sonnet,
and keel says so.

| When | What it asks | Options |
|---|---|---|
| the table of steps | Confirm or change? | confirm / change |
| a step is not accepted after two fixes | What next? | once more / again on Opus / finish here / stop |
| the implementer did not finish in time | What is done and what is not, and advice: continue or finish by hand? | continue / finish by hand |
| the implementer cannot decide alone | Its question in plain words with options | your answer |

### New packages

Before a new dependency keel shows a link to the documentation, the license, how the package is
maintained and its size, comparing it with writing it yourself. In planning the comparison is
fuller: up to 3 options (your own code is always among them), and packages that are abandoned, have
a serious vulnerability with no fixed version, or have an incompatible license are not proposed at
all.

### Report and costs

Every `/keel:end-task`, `/keel:end-session` and `/keel:end-planning` ends with a report: what was
done, verification, git, what next, and a table of costs. The table has the main conversation and
every agent: model, requests, tokens, dollars and the share of the total. Below it are the time, the
number of your requests and the three most expensive of them.

| What you pay with | In the report | Usage page |
|---|---|---|
| API key only | exact dollars | none |
| subscription only | dollars at list prices and roughly how many percent of the weekly and 5-hour limit that is | yes |
| both | everything together; sessions with an API key are marked | yes |

keel computes the percent from your own measurements (how many dollars make 1 % of the limit). While
there are no measurements, the report says there is no calibration yet and does not invent a number.

## What runs by itself, without a command

Almost everything here works only in projects where keel is set up. In others, cost tracking and the
commands `/keel:help`, `/keel:usage` and `/keel:configure` remain, when you type them yourself.

| What | What you notice |
|---|---|
| working standards | at the start of every conversation: ask instead of guessing, a source for every claim, the smallest solution, a test before a bug fix, documents together with code |
| comment rules | the project's comment level in every conversation and for implementer agents |
| context warning | at 90 % before automatic compaction Claude's first line advises `/compact` or a new conversation |
| separation of the ways to work | in a planning conversation the task, session, `configure` and `cleanup` commands do not run; in a task or session conversation planning does not run |
| planning protection | in a planning conversation keel blocks changes to project files except plan files. This protects against accidental changes, not against everything: it does not see an `rm` command in the terminal |
| models | keel's agents run only on Haiku, Sonnet or Opus; keel never changes the model of your conversation, for planning it advises Opus once |
| no AI signature | a commit or PR with "Co-Authored-By: Claude" or "Generated with" is rejected, Claude writes without it |
| skill hints | at the right moment (migration, Python, documents, a new file, dependencies, ADR, git) adds the rules of one of 6 skills, each once per conversation |
| unfinished ending | in autonomous git, if the task folder was removed and there is no commit, it returns keel to work once: do the git or restore the task |
| language protection | in a Ukrainian conversation a reply with Russian letters or words is sent back to be rewritten |
| separate copies (worktree) | a conversation in a separate copy of the repository keeps its own task, note and git apart; plan drafts, the trash and settings are shared by all copies |
| own scripts | most of keel's own scripts run without permission prompts; steps that change Claude Code settings or move files ask |
| safeguards in scripts | work even with hooks off: do not delete the main or current branch, do not rewrite history, do not finish a task without verifying the current code |
| secrets and agents | secret files (`.env`, keys, certificates) keel knows only by path: it does not show their content to agents and does not commit them. Reviewer agents only read; after agents that run code, keel compares the files and stops if anything changed |

**Eight keel steps confirmed by Claude Code itself:** a finished task's folder to the trash, remove a
task, empty the trash, delete a branch, merge a branch (except in autonomous git with "ask before
merging" off), allow autonomous git, commit planning files, push planning files. Separately, Claude
Code confirms each deletion in `/keel:usage clear`.

**With no human** (`claude -p`, a mode without prompts): such steps are rejected, and keel counts
that as a "no": the task stays active, git does not run, `/keel:start-planning` does not start. If
you turn off all hooks there are no confirmations at all, but the safeguards in scripts remain.

## What keel stores and what leaves the computer

| Where | What | In git |
|---|---|---|
| `.keel/config.json`, `.keel/profile.json` | project settings and the scan result | yes, shared by the team |
| `.keel/tasks/<id>/` | an unfinished task: goal, state, next step | yes, only in the task branch (can be turned off) |
| `.keel/next-session.md`, `.keel/memory/`, `.keel/sessions/` | session note, project memory, log | yes (can be turned off) |
| `tickets/<feature>/` | planned tickets and the feature overview | yes, in the feature branch, after your "yes" |
| `.keel/local/` | the trash, plan drafts, temporary files | no, only this computer |
| `~/.claude/keel/` | computer settings, usage data, prices | no |

What leaves the computer:
- usage data to your private page: names of the computer, projects and branches, the email from git;
  task names and the first 100 characters of each request, unless you turned that off; never code or
  replies;
- the feature page (overview, tickets, research) to your claude.ai account;
- git to your server and reading the task link you gave;
- on your "yes": an internet search by package names and price updates.

## Agents and skills

Verification agents: reviewer, bug hunter, QA and "try to break it", architect, test reviewer,
context map, specialist groups (security, data and API, documentation, environment), a finding
verifier and a judge that merges them into one list. An implementer agent does one step of a plan.
In planning there work a ticket reviewer, a plan reviewer and, only on your "yes", a researcher
(documentation, package registries, the internet; it does not send project code). The full table
with models: [Under the hood](under-the-hood.md).

Advisory skills the model pulls in by itself in a configured project: `architecture`,
`adr-required`, `documentation-philosophy`, `git`, `migration-safety`, `performance-review`,
`postgres-best-practices`, `production-readiness`, `python-conventions`, `root-cause-analysis`,
`when-tests-are-owed`. They can ask too: whether to write an ADR, whether your uncommitted change
was intentional, whether to fix old failing tests first or continue.
