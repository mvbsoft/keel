# keel configure flow

Sets up or repairs keel for one project, or only this machine's settings: languages → scan →
propose → confirm → write. `<keel>` is the plugin folder and `<project>` the project folder the
calling command gave you.

**The first question, always** (also on a fresh project, before languages or the scan): "Set up this
project, or only this machine's settings (for every project)?" The argument `machine` answers it.
Section 0 says what each answer runs.

## Ground rules
- Nothing is written without the user's explicit yes. Show what will be written first.
- **Explain before you ask**, in quick setup too, and also when all questions go in one message.
  Before each group of questions, in the conversation language and in plain words, write these four
  short lines from the section's text below, each label translated, each on its own line and all four
  in every group (never folded into one line or a parenthesis):
  - **What it is:** the setting in one sentence, without keel's terms;
  - **What it changes:** what keel will do differently with each answer;
  - **Example:** one concrete case from this project (its commands, its branch, its files);
  - **Change later:** `/keel:configure <section>`.
  Then the options with pros and cons and your recommendation, then the question (AskUserQuestion,
  recommended option first, up to four questions at once). Each option's description says what it
  does in plain words, so the user can also write their own answer under "Other". The user asks for
  more → give the section's full text in plain words.
  **Quick** setup (section 0) asks only the questions that need the user and takes the
  recommendation for the rest; **detailed** setup asks every section, and the user may skip the
  optional ones (see "Required and optional").
- **One decision per question.** "In one question group" or "in one call" means several separate
  questions in one AskUserQuestion call, never one question whose options combine two decisions:
  combined options leave room for only some of the choices. Every option a section names is offered,
  the recommended one first and marked; a recommendation never removes the other options.
- Every recommendation comes from the section's script output (scan, `comments.js --project`,
  `stack-skills.js`, `claude-settings.js show`), never from a guess. When you cannot ask
  interactively (no AskUserQuestion), first run the scripts of every section, then ask all questions
  in one message, numbered by section.
- Talk in the conversation language from section 1; write files in `repo_language`.
- Never open secret files (the scan lists them under `secret_paths`); mention them by path only.
- Never run deploy, publish, migration or data-changing commands. Only tests, linters and type checks,
  and only after `safe-command.js` says `safe` and the user agreed.
- Temporary files go to `<project>/.keel/local/tmp/`.
- Run keel's scripts exactly as written here, one plain command each (no `;`, `&&`, pipes or
  redirections): keel lets these run without a permission prompt. In Bash, write a path that starts
  with `\\` (a network or WSL share) with forward slashes: `//server/share/...`. Do not explore the
  plugin folder.
- A keel script refused by a project hook (a reason that does not start with `keel:`): follow
  "A keel script refused by a project hook" in `<keel>/skills/_shared/preflight.md`.
- **Where each setting lives.** Every question names it in plain words:
  - *this machine*: every project on this machine (the status line, how the machine pays, its name,
    the usage page);
  - *this project*: the `.keel/` config, shared with the team in git (gates, git, verification, code,
    docs);
  - *machine or project*: a value for every project on this machine, which one project may replace for
    itself (the `[machine or project]` rows of `claude-settings.js show`). In project mode show both
    values and which one applies; the options are "keep the machine value" / "set for this project".
    A project value is personal and stays outside git.
- **Required and optional.** Sections 1.2, 3, 4, 5, 6 (file sizes and the comment level) and 8 are
  required: the user may accept the proposal but not skip them. Everything else may be skipped: the
  default or the machine value then applies.

## 0. Starting point
**What to set up** (the first question above). The argument `machine` → machine mode. Otherwise ask
it as your first message: this project (recommended; machine settings are asked only where this
machine has none yet) / only this machine's settings, for every project.
- **Machine mode** runs only: 1.1 (the conversation language for every project), the machine values of
  section 10, and section 11. It writes no `.keel/` files and ends with a short summary.
- **Project mode** is everything below.

**Quick or detailed** (project mode, fresh setup only; a second question in the same call as the first
one): quick (recommended: about six questions, every other value is the recommendation and can be
changed later with `/keel:configure <section>`) / detailed (every section asked). Both explain each
question group first. Quick runs:

| Section | Quick |
|---|---|
| 1 Languages | asked: both, two questions in one call |
| 2 Scan | runs as written; the profile is shown in a few lines, not confirmed part by part; the gaps still go to the context agent; `run_command` asked only when a part serves something |
| 3 Gates | asked: the commands and the one dry run; scanners: those already on PATH, without a question; the missing ones are named in the summary |
| 4 Git | asked: mode (both modes offered) and main branch, two questions in one call; `ask_before_merge` yes, state and task folders in git |
| 5 Verification | the defaults, stated in one line |
| 6 Code | file sizes 700 / 1,000; the comment level `comments.js --project` recommends; ticket prefixes it lists from git history; `adr_refs` `allowed` |
| 7 Stack plugins | skipped; the summary says `/keel:configure plugins` |
| 8 Documentation | the suggested profile and pattern, stated with the reason; existing docs are kept up to date in every profile |
| 9 Moving | asked only when `migrate.js find` finds another system |
| 10 Claude Code settings | asked (never taken without a question: they change Claude Code's own settings) as one question: the recommended values from `show` (listed, each with what it does), written for the machine where it has none, else for this project only where they differ; options: yes to all / choose one by one (then as in section 10) / none |
| 11 Usage and costs | asked when this machine has no usage settings: how it pays, the status line and the dashboard page in one group; names and prompt previews take the defaults from `show` |
| 12 Write | as written, and the summary lists every value with the section to change it |

Read the check output the command showed. A `git: none` line → before anything else, say that keel
needs a git repository and offer `git init` and a first commit of the current state (as
`<keel>/skills/_shared/preflight.md` says); no → stop the setup. `git: not installed` → say so and stop.
Then by the first line:
- `keel-config: missing` → a fresh setup: every section from 1.
- `outdated` → **repair path**: load the existing config, ask only about fields the current schema
  added, keep everything else, then go to section 12.
- `broken` or `invalid` → **repair path**: list each problem in plain words, propose a fix per
  problem, apply only confirmed fixes, then go to section 12. If the file is not valid JSON, offer to
  start fresh, keeping a copy in `.keel/local/tmp/config.broken.json`.
- `ok` → the project is configured: ask what to change (a section, a re-scan, or everything); when
  the `config-check:` block above names sections, recommend those first, each with its reason in one
  line. An argument that names sections (numbers or `languages`, `scan`, `gates`, `git`,
  `verification`, `code`, `plugins`, `docs`, `migration`, `settings`, `usage`, `prices`; several
  separated by commas or spaces, such as `gates,git` or `3,4`) runs only those, in section order
  whatever order they were given in, then section 12 once for what they changed. A name that is no
  section → list the sections and ask; run nothing before the answer.

Existing AI instruction files (`profile.ai_rules` from the scan: AGENTS.md, CLAUDE.md, Cursor or
Copilot rules...) are read first: they state the project's own conventions and win over keel's guesses.

## 1. Languages (first, so the rest is in the user's language)
1. **Conversation language**: the language keel talks, asks, reports and plans in; the command shows
   the current one. Ask in it, in one short question: keep it, or name another. A new one is used from
   this question on; where it is saved (this project only, or every project on this machine) is part of
   section 10.
2. **Repository language** (`repo_language`, a code such as `en` or `uk`): the language of what keel
   writes into the repository: the note, project memory, session logs, commit messages and new
   documents. Propose the language of the project's README and recent commit messages (English when
   there is neither). Existing documents keep the language they are written in. The product's own
   language (texts for the app's users) comes from the project and the task, not from here.

## 2. Project scan (3 layers)
1. **Layer 1, script:** run
   `node "<keel>/scripts/scan.js" "<project>" --out "<project>/.keel/local/tmp/scan.json"`.
   It prints a short summary (languages, parts with their best commands, secret files by path, gaps)
   and writes the full result to that file; read the file only for the details a question needs.
2. **Layer 2, `keel:context` agent (Haiku), whenever `findings.gaps` is not empty**, also when you
   will ask the user about a gap anyway: the agent reads the files behind it (is a lock file empty,
   what an unclear folder holds) so your question comes with a recommendation and its evidence, and
   your own context stays small. One agent call (`run_in_background: false`: wait for it) with the gaps as numbered questions, the parts list
   and the secret paths. Pass no other context. Fold its answers into the proposal and say which came
   from the agent.
3. **Layer 3, the user confirms the profile**, part by part in a monorepo: what each part is, its
   ecosystems, and which parts are real parts (an "unclear part" may be bundled third-party code: drop
   it from `parts` if the user says so).

Then ask once for the **command that starts the app** (used by QA later; may be "none") per part that
serves something; store it as `run_command`.

If the scan found other notes or memory systems (`findings.other_systems`), mention them in one line;
moving them into keel is section 9.

## 3. Gates
For every part, propose test, lint and type-check commands from `findings.command_candidates`
(best source first: CI, then scripts and task runners, then hooks, then tool configs, then
conventions) and say where each came from. The user can accept, change or drop each.

Then offer **one dry run** of the confirmed commands, so a wrong command is caught now:
1. For each command run `node "<keel>/scripts/safe-command.js" "<project>" "<part>" -- <command>`.
   `refused:` → do not run it; tell the user why and that they can run it themselves.
2. Show the safe commands together and ask before running them. Run them one at a time from the
   part's folder; bring back only pass or fail and the first error lines.
3. A failing command is not an error of the setup: ask whether to keep it (tests may be red today),
   fix it, or drop it.

**Security scanners are a separate question**, never bulk-confirmed. Propose `gitleaks` (secrets) and
`semgrep` (risky code patterns) plus the ecosystem's audit command (npm/pnpm audit, composer audit,
pip-audit, cargo audit, govulncheck, dotnet list package --vulnerable, bundle audit). Which are
installed comes from the scan's "scanners on PATH" line; do not run them to find out. A scanner that
is not installed stays in the list and becomes a loud warning in reports, not a red gate; say so.
- **gitleaks is two scanners** (`<keel>/data/catalog.json`, `security.scanners`), because keel verifies
  before the user commits: `gitleaks detect --no-banner --redact --log-opts=<main>..HEAD` (the commits
  of this branch) and `gitleaks protect --no-banner --redact` (uncommitted changes). A plain
  full-history `detect` took 2.5 minutes on every task in a project with 9,701 commits (the branch
  scan took 17 s) and misses what is not committed yet. `<main>` is the main branch confirmed in
  section 4: you substitute it (a name taken from the repository, never from user text) before the
  commands go to the config in section 12.
- **gitleaks not on PATH but Docker is:** the same two scanners can run in the official image, for
  example `docker run --rm -v ./:/repo zricethezav/gitleaks:<pinned version> detect --source /repo ...`
  (the same flags after it; on Git Bash prefix `MSYS_NO_PATHCONV=1`). Pin the version, never `latest`.
  Say that the first run downloads the image; the user decides.

## 4. Git
- **Mode:** manual (keel gives a report and a ready commit message; you commit, push and merge) or
  autonomous (keel commits, updates the branch from main, re-runs tests and pushes the branch; it
  merges only when your instruction asks, or on a finish when "ask before merging" is off). Its own
  question with both modes as options; recommend manual for a first project (the user sees each git
  step before it happens) and say that autonomous saves the git work on every task and can be turned
  on later with `/keel:configure git`. Autonomous → after the config is written,
  run `node "<keel>/scripts/git-flow.js" "<project>" trust` once (Claude Code asks the user to confirm).
- **Main branch:** propose the repository's default (`git symbolic-ref refs/remotes/origin/HEAD`, else
  the current branch). Confirm.
- **Ask before merging** (`ask_before_merge`, autonomous only): yes by default: keel merges only when
  your instruction asks, and Claude Code asks you to confirm each such merge. No: a finish also merges
  into the target, without a confirmation.
- **Keep keel's state in git** (`next-session.md`, `memory/`, `sessions/`): yes by default; for a team
  repository the user may prefer no.
- **Task folders in git** (`tasks.in_git`; default: yes; no keeps them only on this machine). Write
  `"tasks": { "in_git": false }` only for a no.

## 5. Verification
Thresholds the level-proposal script uses (the user always picks the level): gates only up to 1 file;
Basic up to 1 module; large change from 400 changed lines (suggests Standard), very large from 1,000
(suggests Maximum); core code (a changed file that 5 or more other files import) suggests Maximum.
Verifier caps 2 / 5 / 8 for Basic / Standard / Maximum. Show them in one table and ask whether to keep them; each default has its reason in the
schema descriptions; give it if asked. Turn caps are not asked: state them in one line (60 for review
agents, 350 for implementers, fixed in each agent's own file, not in the config).

## 6. Code: file sizes and comments
**File sizes:** warning at 700 lines and limit at 1,000 lines. These are signals to look, not rules
to split; keel splits by responsibility, never by line count.

**Code comments** (`comments.level`). First run `node "<keel>/scripts/comments.js" "<project>" --project`:
it gives the share of comment lines in the code now and the closest level; recommend that level
(`short` when the project has no code yet). Explain:
- Tricky code always gets a comment, as long as needed (formulas, hidden behaviour of called code, an
  order that matters, legacy or compatibility rules, code that looks wrong but is right), and unclear
  values and names get one (one line at `short`). The level decides plain code. Show the same small
  function at each level, as in `<keel>/hooks/comments.md` (open it with the Read tool):
  - `short`: tricky and unclear spots only, plus one line of "why" for a decision a reviewer would
    question;
  - `functions`: plus a 1-3 line doc comment on each public function, class and method;
  - `detailed`: a short doc comment on every function and headings for the blocks of a long one.
- Comments cost tokens on every later read: in keel's measurements new code was about 9 % comments at
  `short`, 20 % at `functions`, 27-38 % at `detailed`. There is no level without comments: at `short`
  comments cost a fraction of a cent per session, while a tricky spot without one costs a debugging
  session.
- keel checks new code with `comments.js` at the end of a task and when it accepts a delegated step.

**Ids in comments and docs** (`comments.ticket_prefixes`, `comments.adr_refs`, `comments.refs_exempt`).
A ticket id, a commit hash or a record code in a comment or doc points at something that may be
deleted; `comments.js` reports them in new comment and doc lines (commit hashes always). Ask, in one
question:
- ticket prefixes: propose the ones the `--project` run lists from git history and ask for the ones
  it cannot see (register or debt rows such as `D-12`, acceptance criteria). None: ticket ids are not
  checked;
- decision records (`ADR-12`): `allowed` (default) when the project keeps them for good; `forbidden`
  when they may be removed or renamed, so a comment states the reason itself and a doc links the record;
- files where ids are the subject besides the built-in ones (decision records, task and ticket
  folders, changelogs, `.keel/`): a debt register, generated run records.

## 7. Stack plugins
1. Run `node "<keel>/scripts/stack-skills.js" "<project>"`. It matches the project against keel's
   checked list and searches the marketplaces the user has added (never the Anthropic Directory: most
   of its 3,000+ entries are not about code, and it exists only with a claude.ai account).
2. Show, per plugin: what it is, why it helps here, the author, and what it runs or needs (an MCP
   server, a program, an account). Keep the groups apart: **checked by keel**; **marketplace not
   added** (a reputable marketplace keel knows; the user adds it with the printed command);
   **found in your marketplaces, not checked by keel** (drop any that clearly does not fit this
   project, saying why in a few words); **nothing reliable found** for a framework.
3. The user picks (multi-select; nothing is preselected). Also on "accept all" or "your
   recommendation": list the plugins by name, none marked recommended or preselected, and wait for
   the user's picks; this step is the exception to "recommended option first".
4. **A language server plugin (LSP):** explain it plainly: after every edit Claude sees type and
   compile errors at once, and finds definitions and callers exactly instead of by text search; the
   cost is a program to install (the command comes from the script). The program is installed
   together with the plugins, after the files are written; section 12 waits for it.
5. **Installing:** Claude Code refuses plugin installs that Claude runs, so give the user the commands
   to run in their own terminal, in order: `claude plugin marketplace add ...` first when needed, then
   `claude plugin install <plugin>@<marketplace> --scope project` per plugin. Project scope records the
   plugin in `.claude/settings.json`, but another machine does not fetch or offer it from there (Claude
   Code only reports it as enabled in project settings and not installed), so each developer runs the
   same commands; section 12 writes them into the project's docs. A plugin from a custom marketplace
   also needs `extraKnownMarketplaces` committed in `.claude/settings.json`. New plugins load in the
   next session.
6. **Nothing reliable for a framework** (for example Yii2): install nothing, say so, and offer to
   write a project skill from the project's own conventions later, as a separate task
   (`/keel:start-task`).
7. Store the picked plugin ids in `stack_skills`.

## 8. Documentation
From the scan (`findings.docs`): the doc files, ADR and spec folders, a Diátaxis-like `docs/`, arc42
or C4 files, and the files Claude Code loads into every session with their line counts.
1. **Profile** (`docs.profile`), always asked; recommend `findings.docs.suggested_profile` (an ADR
   folder → 2, a spec folder → 3, else 1) and say why. Explain each with its cost (keel's
   estimates per task):
   - **1, maintenance only:** writes nothing new; every existing doc the change makes untrue is
     updated fully. About 0.2-0.5k tokens per task.
   - **2, standard:** plus an ADR for an architecturally significant decision (one to two pages).
     ADRs come in about one task in five to eight; about 2k tokens each.
   - **3, spec per feature:** plus a short spec before the code of a non-trivial feature. About 8k
     tokens for such a feature; small changes get none.
   - **4, heavy:** plus task files, a decision log, state registers. About 8k tokens written and 20k
     read per task.
   The profile is the most a task may write; the task size decides. Details for the user if asked:
   `<keel>/skills/_shared/docs-profiles.md`.
2. **Pattern** (`docs.pattern`), only for profiles 3-4: none / Diátaxis / arc42 / arc42 + C4;
   recommend `findings.docs.suggested_pattern` when the project already follows one. Existing docs are
   never restructured as a side effect of other work; moving them is its own task (next item).
   Quick setup takes the suggested profile and pattern: keel keeps the docs the way they are.
3. **Moving the existing docs** (detailed setup, when the chosen pattern is not the one the docs
   follow now, `findings.docs.suggested_pattern`; a profile alone needs no move: its first ADR or spec
   creates the folder). Same pattern → say "your docs already follow it; nothing to move". Otherwise:
   - count the doc files and their lines (`findings.docs.files` and the docs folders; sizes only, no
     need to read them) and say what would move where, in a few lines;
   - give the cost as an **estimate** and how it was made: tokens ≈ the docs' characters ÷ 4 × 3
     (read, write, check), at the Sonnet price in `<keel>/data/prices.json`, plus the Standard
     verification estimate from `changes.js`; a range, never one number;
   - say how it would run: as a keel task on its own branch: a plan to approve, mechanical moves by
     Haiku implementers, content and links by Sonnet, then Standard verification (lost text, broken
     links, navigation), and a pull request or merge the user decides;
   - ask: prepare the move (recommended when the docs are larger than a few pages) / not now (new docs
     follow the pattern, old ones stay where they are).
   Prepare → write `<project>/.keel/local/docs-migration.md` with the Write tool: goal (move the docs
   to `<pattern>`), the current docs (files, folders), the target layout, acceptance criteria (every
   page's content kept, every link resolves, the navigation and README point to the new places), out
   of scope (rewriting content), and the estimate. Section 12 then names it as the first task.
4. **Growth guard:** each file in `findings.docs.always_loaded` over 200 lines → say so: it is loaded
   into every session, costs context each time and is followed less reliably; propose moving detail into files loaded on demand, as a separate task.

## 9. Moving from another system
Run `node "<keel>/scripts/migrate.js" "<project>" find` (with `--from "<folder or plugin>"` when the
user named one). No other system → skip this section without a question. Otherwise explain in plain
words: two systems would give conflicting instructions (two notes, two memories), so keel offers to
move the old notes, memory and logs into `.keel/`; project data and secrets stay. Ask: move now
(recommended) / later (`/keel:configure migration`) / never (the old system stays); the user who ran
`/keel:configure migration` has already chosen "now", so do not ask. On "move now"
read `<keel>/skills/_shared/migrate.md` and follow it; its config proposals are compared with the
answers already given (an answer changes only on a yes), and its git step waits for section 12.

`/keel:configure migration` (or `9`) in a configured project runs only this section.

## 10. Claude Code settings
Run `node "<keel>/scripts/claude-settings.js" "<project>" show`. It lists every key twice: the `user`
row is the machine value, the `project` row this project's own value and which one applies. A machine
value that already matches keel's recommendation is not asked again. Then, in one question group:

*Machine or project* (project mode: "keep the machine value" / "set for this project"; a machine with
no value yet is asked for the machine value first; machine mode: only the machine value):
- **"Yes, clear context" after approving a plan** (`showClearContextOnPlanAccept`): keel turns it on by
  default. Approving a plan can then start the work from the plan alone, without the planning
  conversation.
- **Compact the conversation at about 300k tokens** (`autoCompactWindow: 300000`): without it Claude
  Code compacts only at about 967k. Every request re-reads the whole conversation, so on Opus a request
  at 600k costs about $0.12 in cache reads and at 300k about $0.06; the cost is that details of early
  conversation are lost at each compaction more often. Options: yes / no / another number. If `show`
  lists a per-model value, say that it wins for that model.
- **Command output limit 15,000 characters** (`bashOutputMaxChars`): longer output goes to a file with
  a preview instead of filling the conversation (the default is 30,000).
- **No AI attribution in commits and pull requests** (`attribution`).
- **Conversation language** (`conversation_language`), when section 1 changed it.
- **Opus for keel's agents** (`allow_opus`): off runs them on Sonnet; ask only when the user raises
  cost or the machine value is off.
- **Prompt previews on the usage page** (`prompt_preview`, project row only; the machine value is in
  section 11): a project with sensitive requests can turn them off for itself.

*This project* (project mode only):
- **Plan files in the project** (`plansDirectory: ./.keel/local/plans/claude`, outside git, beside
  keel's planning drafts in `.keel/local/plans/keel/`). When `show` lists old Plan Mode files in
  `.keel/local/plans/` (keel recommended that folder before), offer to move them into `claude/` with
  the new value; on a yes run `node "<keel>/scripts/claude-settings.js" "<project>" move-plans` after
  `apply` (Claude Code asks first; a name already in `claude/` stays where it is, say which).
- **Gate commands without a prompt** (`permissions.allow`): for each confirmed gate command
  `Bash(<command>)` and `Bash(<command> *)`, and the same with `PowerShell(...)` on Windows, so tests
  and parallel agents do not stop on a prompt.

The changes file has a `user` part (machine values) and a `project` part (this project's values and
gate permissions); in `project`, `null` removes the project's value so the machine value applies again.
Write the confirmed keys with the Write tool to `<project>/.keel/local/tmp/claude-settings.json` as
`{ "user": { ... }, "project": { ... } }`, show it, and after the user's yes run
`node "<keel>/scripts/claude-settings.js" "<project>" apply "<project>/.keel/local/tmp/claude-settings.json"`.
Claude Code asks the user before this command runs; that is expected. The script keeps a backup copy
of each file it changes (the project file's in `<project>/.keel/local/backups/`, the machine file's
next to it); say where. `claude-settings: stopped, nothing more written (<why>)` after `written` lines:
the files in those lines were changed (backups kept), the rest were not; say both and the reason.
The project values go to `.claude/settings.local.json`: personal, never for git. When `apply` wrote
it, run `git check-ignore .claude/settings.local.json` in the project folder; no output (not ignored)
→ say so and offer to add the line `.claude/settings.local.json` to the project's `.gitignore`
(Edit, on a yes; that file goes into the setup commit of section 12).

Then one line of advice, no question (keel never sets the model; the user picks it with `/model`):
Sonnet as the main model by default; Opus for big or risky tasks. Measured on whole tasks with keel:
Opus cost about twice as much, both passed every acceptance check, and Opus wrote tests that catch more
regressions and handled more edge cases.

## 11. Usage and costs (this machine)
Asked once per machine: when `show` says `not configured on this machine yet`, or when the user asks
for `usage` or `prices` (`/keel:configure prices` runs only step 6). Run
`node "<keel>/scripts/usage-setup.js" "<project>" show`.
Explain first: at the end of every `/keel:end-task`, `/keel:end-session` and `/keel:end-planning` keel
shows what the session cost: each participant (the main session, each agent run), its model, tokens
and dollars at list price; on a subscription also about how many percent of the weekly and 5-hour
limits that is. A private page "keel usage" in the user's claude.ai account collects this from every
machine (charts, filters, every keel session with its agents and the cost of each request; other
conversations count only in the hourly totals the limit calibration needs). Everything is read from Claude
Code's own local logs; nothing leaves the machine except into that private page.
Then, in one question group:
1. **How this machine pays** (`wallet_default`): subscription (Pro/Max/Team; recommended when `show`
   says the session wallet is `subscription`) / API key / both (`also_api: true`: sessions keel did
   not mark are shown as "unknown" and left out of the limit calibration). **Cloud sessions**
   (`cloud_wallet`, Claude Code on the web): separate credit (default) / subscription / API.
2. **Names**: this machine (`pc`, default from `show`; letters, digits, `-`, `_`) and the user email
   (`user`, default from `show`). With an API key the page groups by user, so a team sees who spent.
3. **Prompt previews** (`prompt_preview`): the first 100 characters of each request, secrets masked,
   so the session page shows which request cost what. On (recommended) / off.
4. **Status line**: Claude Code passes the plan-limit percentages only to the status line, so keel
   records them there (the desktop app has no status line; there keel asks the app at the end of a
   task). From `show`: `offer: install` → keel's line (folder, branch, model, context, session $,
   limits); `offer: wrap` → the user's line stays exactly as it is and keel only records the
   percentages; `now: keel` → nothing to ask. Options: the offer (recommended) / skip (no percentages
   in the terminal).
5. **Dashboard page**: `artifact_url` in `show` → keep it. Otherwise look with the Artifact tool
   (`action: list`, mine, then shared) for one titled "keel usage"; found → use it. None → offer to
   create it (step 7). When the user says the team shares one page, its URL can also go to the project
   config (`usage.artifact_url`, committed). A machine uses that URL only after its user approves it
   (`approved_artifact_urls`, step 7), so a cloned repository cannot choose where usage data goes; a
   machine `artifact_url` always wins.
6. **Price update** (offer; about $0.1–0.3): start a `general-purpose` agent with `model: "sonnet"`:
   "Find the current Claude API pricing page in the official docs (it was
   platform.claude.com/docs/en/about-claude/pricing) and read it. Write
   `<project>/.keel/local/tmp/prices-new.json` in the shape of `<keel>/data/prices.json`: `about`,
   `source` (URL and date), `models` [{ `match` (model id prefix), `input`, `cache_write_5m`,
   `cache_write_1h`, `cache_read`, `output` (USD per million tokens), `note` (long-context or other
   surcharges) }] for every current and legacy model on the page. Reply with the file path and any
   price you were unsure of." Then run
   `node "<keel>/scripts/usage-setup.js" "<project>" prices-diff "<project>/.keel/local/tmp/prices-new.json"`,
   show the changes and the `check:` lines, and after a yes run
   `node "<keel>/scripts/usage-setup.js" "<project>" prices-apply "<project>/.keel/local/tmp/prices-new.json"`.

7. **Write**, after showing it and the user's yes, in this order:
   - Machine settings first (`apply` accepts `statusline.original` only while it is still the status
     line in the user's settings): write the confirmed keys (`pc`, `user`, `wallet_default`,
     `cloud_wallet`, `also_api`, `prompt_preview`, `artifact_url`, `approved_artifact_urls` (the team
     page URL from the project config, when the user approves it), and `statusline`:
     `{ "mode": "keel" }`, `{ "mode": "wrap", "original": <object> }` or `{ "mode": "none" }`) to
     `<project>/.keel/local/tmp/usage-setup.json` and run
     `node "<keel>/scripts/usage-setup.js" "<project>" apply "<project>/.keel/local/tmp/usage-setup.json"`.
   - Status line `install`: run `node "<keel>/scripts/usage-setup.js" "<project>" install-statusline`;
     it prints the `statusLine` object. `wrap`: the same command, and keep the line `show` printed as
     `statusline.original`. Write `{ "user": { "statusLine": <printed object> } }` to
     `<project>/.keel/local/tmp/claude-settings.json` and run
     `node "<keel>/scripts/claude-settings.js" "<project>" apply "<project>/.keel/local/tmp/claude-settings.json"`
     (it keeps a backup next to the machine file; say where). Never put keel's own command into `statusline.original`.
     `install` on macOS or Linux: run `command -v jq`; nothing found → say that keel's line then shows
     less (the limit recording still works) and give the install hint (`brew install jq`, or the
     system's package manager, e.g. `sudo apt install jq`).
   - Create the page (only after a yes): run `node "<keel>/scripts/usage-setup.js" "<project>" page`,
     then publish with the Artifact tool: `file_path` `<project>/.keel/local/tmp/usage-page/index.html`,
     `files` `{ "pivot.js": ".../usage-page/pivot.js", "i18n.js": ".../usage-page/i18n.js", "i18n.uk.js": ".../usage-page/i18n.uk.js" }`,
     `title` "keel usage", `icon` "chart", `capabilities` `{ "db": {}, "user": {}, "downloads": true }`.
     Then write the page language with ArtifactData `set` to collection `meta`, doc `settings`,
     `{ "language": "<conversation language code>", "schema": 1 }`. Then save its URL on this machine:
     `{ "artifact_url": "<page url>" }` through the same `apply`.
   - The first sync happens at the next `/keel:end-task`, `/keel:end-session` or
     `/keel:end-planning` (the last 30 days of logs on this machine).

## 12. Write and summary
1. Build `.keel/config.json` (all required fields; defaults for anything not asked) and
   `.keel/profile.json` (the confirmed profile: `schema_version`, `manifest_fingerprint`, `languages`,
   `monorepo_tool`, `parts`, `triggers`, `secret_paths`, `ai_rules` from the scan, with the user's
   changes). Show both and ask for a yes.
2. Write them. Create `.keel/.gitignore` with the content of `<keel>/templates/keel/gitignore` (open
   it with the Read tool); if section 4 chose "state not in git", add `next-session.md`, `memory/` and
   `sessions/` to it.
3. Run `node "<keel>/scripts/config-check.js" "<project>" save` (it records what the sections that ran
   were based on, for `/keel:configure check`, then checks the files). When not every section ran, add
   `--sections "<those that did>"`, comma-separated in quotes: a run of chosen sections → those; quick
   setup → `"1,2,3,4,5,6,8,9,10,11"` (every section but 7, which it skips); a repair → the sections it
   asked about. Anything but `keel-config: ok` and `profile: ok` → fix it before saying the setup is
   done.
4. **Write the manual setup down for the next developer.** The plugin commands and programs of
   section 7 live only in this conversation, so propose a short section for the project's README (or
   its existing setup or getting-started doc, when it has one; in `repo_language`), titled like
   "Working with Claude Code". Show the text and write it only after the user's yes (a no leaves the
   docs alone). At most about 10 lines, only what applies:
   - the keel plugin;
   - the plugins picked in section 7, each with its exact command
     `claude plugin install <plugin>@<marketplace> --scope project` (Claude Code does not fetch or
     offer a plugin that is only enabled in the committed `.claude/settings.json`; every developer
     installs them), and the marketplace-add command when one is needed; a plugin from a custom
     marketplace also needs `extraKnownMarketplaces` committed in `.claude/settings.json`: mention
     that only when such a plugin was picked;
   - each program a picked plugin needs (a language server, for example), with its install command;
   - the security scanners from section 3 that the project uses, and how to install them.
   Nothing picked and no scanners → skip this step without a question.
5. Summarize (after step 6 when it applies; then steps 7 and 8): what was written (including the README section), the gates per part, git mode, the comment level and documentation
   profile, the Claude Code settings written (and backups), plugin commands still to run, a language
   server still to install, scanners that are not installed, and the move from another system (what
   moved, what stayed, the old plugin's disable command, the commit message or git result for the
   setup and the move together). After a quick setup also list every value that was not asked, each
   with the section that changes it (`/keel:configure git`, `/keel:configure verification`, ...).
   End with: start the first task in a fresh conversation (`/clear`): keel's working standards load
   at the start of a conversation in a project that has its config. A docs move was prepared (section
   8) → make it the first thing, on its own line: "First run `/keel:start-task .keel/local/docs-migration.md`:
   it moves your docs to <pattern> (about $X-Y); do it before other tasks, so new docs land in the
   new places."
6. **A picked LSP plugin whose program is not on PATH is a stop.** Give the install commands (the
   program and the plugin) and ask, as its own question: "installed, check again" or "skip for now".
   The setup is not finished before the answer: without AskUserQuestion, ask it in your message and
   end your turn there. "Check again" → run
   `node "<keel>/scripts/stack-skills.js" "<project>" --lsp <command>`: on PATH → say so; not yet → say
   what is missing and ask again. "Skip for now" → note it in the summary as not done.
7. **Commit the setup** (project mode): the new `.keel/` files, and README, CLAUDE.md, `.gitignore`
   or `.claude/settings.json` when this setup changed them. Two ways, say both: commit them on the
   main branch now (both git modes: give the ready commands, `git switch <main>` when not on it,
   `git add` with those paths, `git commit -m "<message in repo_language>"`, `git push`; keel's git
   steps never commit on the main branch, so the user runs them), or leave them uncommitted and the
   first `/keel:start-task` offers to take them into that task's branch, so they reach the main
   branch with its merge (for a main branch that takes changes only through pull requests).
8. **Instruction check, only when it is worth it** (fresh setup). Decide from the
   `other instructions:` line of the scan (section 2): it ends with `audit: advise` (50 or
   more lines in those files, or 3 or more rules, skills, commands, agents or output styles) or
   `audit: not needed`. Not needed → say nothing about it, not even that it is not needed. Advise →
   it is the last part of the summary, after the commit step: a heading such as
   "Recommended: check your instructions" and these four points as a list, each starting with its
   label (translated), never folded into one paragraph:
   - **Why:** before keel this project (or this machine) already had its own instructions for Claude;
     name what the line lists ("CLAUDE.md, 120 lines; 4 rules; 6 skills in ~/.claude"). The more of
     them, the likelier two say opposite things (one rule "a doc comment on every function", another
     "small functions, no comments"): Claude then picks one arbitrarily and behaves differently from
     day to day. Outdated lines (a removed folder, an old command) also cost context in every
     conversation;
   - **What it does:** Claude Code's own check `/doctor prompt-audit` reads the CLAUDE.md, AGENTS.md,
     rules, skills, commands and agents of this project and of `~/.claude` (not keel's rules: their
     conflicts with yours are the ones this setup raised), and lists contradictions, outdated
     instructions and references to missing files, each with a proposed edit. It changes nothing until
     you agree;
   - **The effect:** one consistent set of instructions that Claude follows the same way every time,
     and fewer lines loaded into every conversation;
   - **How:** type `/doctor prompt-audit` in a new conversation (`/clear` first); keel cannot start a
     Claude Code command for you. It runs on the current model. A report that is hard to read → ask
     Claude to retell it as a short list: what was, what it will become, why it was a problem.
