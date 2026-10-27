# Under the hood

[Українська](under-the-hood.uk.md)

What keel does without being asked: what it adds to every conversation, which hooks run, which agents
exist and on which models, what it stores in your project, and how it keeps you safe. You do not need
any of this to use keel; it is here so you know what is going on.

## Where keel is active

keel works only in a project that has `.keel/config.json`, the file `/keel:configure` writes. In any
other project its hooks add nothing to the conversation, Claude cannot load keel's skills on its own
(configure and help run only when you type them), and keel's agents are refused until `/keel:configure` has created the
`.keel/` folder; a keel command you type there offers to run `/keel:configure` first. Two things keep
working in every project: the record of which wallet a session pays from, and the status line. They
cost no tokens and Claude does not see them. The hook for keel's own files also runs everywhere, but it
acts only on keel's plugin folder and scripts.

Installed for your user, keel's agents and skills are still listed in every project, because Claude
Code lists them. To turn keel on in one repository only, install it with `--scope project` or
`--scope local` ([settings](settings.md#installing-for-one-project)).

## What runs by itself

keel has 14 hooks. They run at fixed moments of a Claude Code conversation, and every hook fails soft:
if it breaks, the conversation goes on as if keel were not there. "Set-up project" below means a
project with `.keel/config.json`.

| When | Hook | What keel does |
|---|---|---|
| A conversation starts, resumes, after `/clear` and after compaction | `session-start` | Set-up projects only. Adds keel's **working standards** (ask instead of guessing, a source for every claim, a fix never breaks what worked, no secrets in git, merge only when you ask...), the language to talk in, and the project's **code-comment rules**. On a fresh start, warns once when Node is older than 22. |
| A conversation starts, resumes and after `/clear` | `session-wallet` | Every project. Notes which **wallet** the conversation pays from (subscription, API or credit) for the cost report, and keeps the plugin folder that keel's status line runs from up to date. Adds nothing to the conversation. |
| Every prompt you send | `context-warning` | Set-up projects only. **Context warning**: at 90 % of the point where Claude Code would compact the conversation on its own, Claude is told to start its reply with one warning line (also sent as a message for you), so you can run `/compact` with a focus or start a new conversation first. That point is `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when it is set, else `autoCompactWindow` from the project's `.claude/settings.local.json`, its `.claude/settings.json` or `~/.claude/settings.json` (a per-model value wins), else Claude Code's own (about 967k with a 1M model, 200k with a model that has a 200k window). A value of your own counts only from 100k up and at most the model's own point above: the environment variable is raised to 100k, a settings value below 100k is ignored. Your prompt itself is not changed. |
| Every prompt you send | `lane-gate` | Set-up projects only. **Lanes** for a command you type: in a conversation that plans a feature, `/keel:start-task`, `/keel:end-task`, `/keel:start-session`, `/keel:end-session`, `/keel:configure` and `/keel:cleanup` are blocked with the reason; in one that works on a task, `/keel:start-planning` and `/keel:end-planning`; `/keel:start-planning` also when nobody is there to answer (`claude -p`). The bare name (`/start-task`) counts too ([how keel behaves](behavior.md#planning)). |
| Before an agent starts | `agent-model` | **Agent model**: keel's agents run only on Haiku, Sonnet or Opus, whatever model your conversation runs on: an agent without an explicit model runs on Sonnet (not on your conversation's model), one asked to run on a Fable model runs on Opus; with `allow_opus` off, Sonnet takes Opus's place. In a project without a `.keel/` folder keel's agents are refused, so Claude uses another agent. Other plugins' agents and your own are left alone. |
| Before Claude loads a skill | `skill-gate` | In a project without `.keel/config.json`, keel's skills are refused (the hook lets configure and help through; you type those two yourself), so Claude goes on without them. The same lane refusals as `lane-gate`, for a command Claude runs by itself. A command you type yourself does not pass this hook; keel's commands check the setup themselves, and `lane-gate` checks the lane. |
| Before a write, an edit or a shell command | `planning-guard` | Only in a conversation that plans a feature. **Planning guard**: a change to a project file is refused; the draft, the feature folder, the planning settings, `.keel/local/tmp/`, Plan Mode files and files outside the project stay writable. It reads shell commands for redirections, `sed -i`, `cp`, `mv` and PowerShell's write commands, not `rm`, `git checkout` or `node -e`: a safeguard against slips, not a wall. |
| Before a read, search, write or shell command | `own-files` | Every project. **keel's own files**: reading keel's plugin folder and running keel's own scripts need no permission prompt, within strict rules ([safety](#safety)). The steps that remove something (a finished or dropped task's folder to keel's trash, a task branch, emptying the trash), confirming autonomous git, a commit or push of planning files, and a merge (unless autonomous mode is confirmed on this machine and `git.ask_before_merge` is off) get **Claude Code's own confirmation** with keel's reason, even when your allow rules would let them run ([how keel behaves](behavior.md)). Such a step named with any project but the current one's exact absolute path, a keel script command that holds such a step's words but does not read as that step, a keel script whose arguments the hook cannot read safely, and a keel script run in any form but the plain one (node options, `env`, `bash -c`, a wrapper) are refused with the plain form to use. keel's QA agents may write only in the project's `.keel/local/tmp/qa/` (there without a prompt). |
| Before a `git commit` or `gh pr create/edit` | `no-ai-attribution` | Set-up projects only. **No AI attribution**: a commit or pull request whose text (the command, or a message file it names with `-F`, `--file` or `--body-file`) carries an AI co-author trailer or "Generated with ..." is refused with the reason, and Claude sends it again without. A co-author counts as AI when its address is a tool's or its name is a tool's name, alone or with model or version words (`Claude`, `Claude Opus 5.5`, `Claude Code`); a person such as `Claude Martin` is not refused. |
| Before a file read, edit or command | `skill-hints` | Set-up projects only; the main conversation and keel's implementer. **Skill hints**: when the conversation touches something one of 6 advisory skills covers (reading or editing a database migration, editing Python code or docs, writing a new source file, editing a dependency manifest, a git command such as commit, merge, rebase, push, tag or `gh pr create`), one line reminds Claude to load that skill; each skill at most once per conversation. |
| An agent hands back its report | `handback` | Projects with a `.keel/` folder. In auto mode an agent delivers its report through Claude Code's `SubagentHandback` tool instead of its last reply; keel saves that report to `.keel/local/tmp/agents/<name>-<id>.md`, where the verification scripts read it. |
| keel's implementer agent starts | `subagent-start` | It gets the working standards, without the parts on talking to the user and on rules the user states, and the comment rules. |
| An agent finishes | `ledger` | Projects with a `.keel/` folder. **Token ledger**: one line per agent in `.keel/local/ledger.jsonl` (the implementer's cost after delegated steps comes from it). Each keel agent's final reply is saved to `.keel/local/tmp/agents/` for the verification scripts, unless `handback` already saved its report there; then that report is kept. In a conversation that plans a feature the replies go to `.keel/local/tmp/planning/<conversation id>/`, and each ticket review's task and reply are also kept in `.keel/local/plans/keel/samples/`. |
| keel is about to end its answer | `finish-check` | **Finish check**: in autonomous git, when this conversation moved a finished task's folder to keel's trash (keel records it with the conversation's id) and nothing committed it or put it back, keel goes on working (git, or putting the task back) instead of stopping. Never while keel is asking you something. |

Not a hook, but also automatic: on every status line refresh keel's status line (or yours, wrapped)
records the plan-limit percentages Claude Code gives it, so keel can tell you the share of your limits
([usage dashboard](usage-dashboard.md#plan-limit-percentages-and-calibration)). It works in every
project.

## Agents and models

keel has 16 agents. Read-only agents cannot write; the ones that run code are checked after each run
(see [safety](#safety)). The level decides who runs and sometimes on which model:
[verification](verification.md#the-four-levels).

| Agent | What it does | Model |
|---|---|---|
| reviewer | one broad pass over the change against its task | Haiku at Basic; Sonnet at Standard |
| bug-hunter | logic errors, load problems, framework duplicates, API misuse | Sonnet; two on Opus at Maximum |
| qa | runs the changed functionality and checks the acceptance criteria | Sonnet; Opus at Maximum |
| qa-break | tries to break the change: boundaries, empty input, permissions, concurrency | Sonnet |
| architect | where each new thing sits, size, duplication, dead code, names | Sonnet; Opus at Maximum, and at Standard with architecture signals |
| test-reviewer | whether the tests would catch the change breaking; proves key tests by reverting the change | Sonnet |
| context | maps the files related to the change for the others | Haiku |
| security | traces input to dangerous operations, tries to bypass business rules | Opus |
| data | database changes and migrations, API compatibility, input validation, performance | Sonnet |
| docs | docs and comments match the code; the task's requirements are done without extras | Sonnet |
| env | dependencies and infrastructure: Docker, CI, deploy, configuration, secrets | Sonnet |
| verifier | tries to prove or refute a serious finding, with `file:line` evidence | Sonnet; Opus for some findings at Standard and all at Maximum |
| judge | merges the findings into one ranked list, adds none of its own | Sonnet; Opus at Maximum |
| implementer | does one planned step when the work is delegated | the step's model: Haiku, Sonnet or Opus |
| ticket-reviewer | in planning: reviews up to 4 draft tickets each against a checklist and checks in the code what they rely on | Sonnet |
| plan-reviewer | in planning: reviews the whole plan once at its final end (coverage, contradictions, order) | Sonnet |

With `allow_opus` off every Opus agent above runs on Sonnet. keel never switches your conversation's model;
which main model to use: [cost optimization](cost-optimization.md#1-choose-the-main-model).

## Delegation

When a plan passes the thresholds (8 steps or 15 files by default, `delegation.min_plan_steps` and
`min_plan_files`), keel asks whether to do it in the conversation or hand the steps to implementer agents:
one fresh agent per step, each on the model the step needs (Haiku when nothing is left to decide,
Sonnet when the step leaves a decision, Opus for work that should not be split). The main conversation
accepts each step after running its tests. Why steps should not be cut too small:
[cost optimization](cost-optimization.md#4-do-not-split-a-plan-into-tiny-steps).

## What keel keeps in your project

| Path | What | In git |
|---|---|---|
| `.keel/config.json`, `.keel/profile.json` | settings and the project profile (secret files by path only) | yes |
| `.keel/.gitignore` | keeps `.keel/local/` out of git, and the note, memory and session logs when `git.state_in_git` is off | yes |
| `.keel/next-session.md`, `.keel/memory/`, `.keel/sessions/` | the session note, project memory, session logs | yes (`git.state_in_git`) |
| `.keel/tasks/<id>/` | one folder per unfinished task, on the task's own branch | yes, on the task branch only; with `tasks.in_git: false` the folder is `.keel/local/tasks/<id>/`, not in git |
| `.keel/local/options.json` | this project's own values of `conversation_language`, `allow_opus` and `prompt_preview` (personal) | no |
| `.keel/local/plans/claude/` | Claude Code's Plan Mode files | no |
| `.keel/local/plans/keel/` | planning: drafts kept on this machine, the planning settings, which conversation plans which feature (`sessions/`), ticket review samples (`samples/`) | no |
| `<draft_dir>/<feature>/`, `<export_dir>/<feature>/` | a feature's draft in the repository, and its exported tickets with their overview (`tickets/` by default) | when you commit them, on the feature's branch |
| `.keel/local/` | temporary agent files and saved agent reports, the token ledger, backups, the trash | no |

On each machine keel also keeps `~/.claude/keel/`:

- `usage.json`: this machine's usage settings ([settings](settings.md#this-machine));
- the wallet of each conversation, limit snapshots, the usage cache and the sync state of the usage page, the last plan-limit calibration (`calib-latest.json`);
- `trusted-git.json`: the projects where you confirmed autonomous git, each with a fingerprint of its
  `git` settings;
- `prices.json`: your own price table, when you updated it, with the previous one as `prices.json.bak`;
- `statusline.js` and `plugin-root.txt`, when keel's status line is installed: the command Claude Code
  runs, and the plugin folder it loads keel's status line from.

Skill hints keep one empty marker file per skill per conversation in the OS temp folder, so each hint
comes only once; nothing is written into the project for them.

The note, memory and each task file have a limit of 150 lines; a script measures them and reports a
file over it. keel never writes passwords, keys, tokens or connection strings into them. How task
folders and the note move with git: [ways of working](workflows.md#where-the-files-live).

## Safety

- **You decide** the level, what gets fixed, the commit and the merge. keel merges a task branch into
  the main branch (or another target) only when your instruction asks for it, or on a finish when
  `git.ask_before_merge` is off. Claude Code asks before every such merge (`git-flow.js merge`), unless
  autonomous mode is confirmed on this machine and `git.ask_before_merge` is off; then a finish merges
  without asking. In manual mode keel runs no git step nobody asked for; you get a ready commit
  message. What you ask for is run in both modes: the branch you choose at a task's start, your answer
  to a handoff without the task's own branch, your own git steps. Updating the task branch from the main branch (`sync`, which merges the main branch
  into the task branch) runs without a prompt in confirmed autonomous mode, like commit and push.
- **Autonomous git needs your yes on each machine.** The mode is stored in the project config, so a
  cloned repository cannot switch it on for you: keel's git steps run without a prompt only after you
  confirm autonomous mode once on your machine (always in Claude Code's own prompt), and again after
  the project's `git` settings change (a branch that edits them gets your normal permission prompt for
  every git step). A push from the main branch is left to your normal permissions; keel's own push step refuses it (the main branch is published only by a merge). The git steps stop
  when the project folder is not the top folder of its git repository, and a merge stops when the local
  target branch has commits the remote lacks. They never force-push, rebase pushed work or commit to the
  main branch directly; only `/keel:tasks drop` deletes a branch, after Claude Code's confirmation.
- **keel never writes through a link** in its own folders: a link (or Windows junction) anywhere under
  `.keel/local/`, or inside a trash batch, makes the step stop instead of writing, moving or deleting
  outside the project.
- **keel's own scripts run without a prompt** only as one plain command,
  `node "<keel>/scripts/<name>.js" "<project>" ...`, whose project folder is the current project's
  exact absolute path. A relative path, a sub-folder or a different project goes through your normal
  permissions; a step that always asks, or a command that holds one of its words (for `plans.js` only
  `commit` and `push`), is refused instead, so no allow rule can run it unconfirmed.
  `usage.js` takes no project folder first: its `--project`, when given, must be the current project,
  and it writes only under that project's `.keel/local/`; its `prepare` and `report` run without a
  prompt only with `--project`. Refused, with the plain form to use:
  - a command joined with shell operators (`;`, `&&`, `|`, redirection, `$(...)`, a line break) that
    names keel's folder;
  - a keel script with `$`, a backquote, `~`, curly quotes, control characters, an unquoted backslash
    (Bash), a backslash before a quote or a space, a special space (such as a non-breaking one) outside
    quotes, a double quote inside single quotes or an unquoted comma list of anything but numbers in its
    arguments, in Bash an unquoted backslash path to the script or a double backslash (Claude Code's
    Bash tool folds it into one, so a network path is written `//server/share`), or in PowerShell `--%`,
    an empty argument or a bare word starting with one dash (`-`, or the en dash, em dash or horizontal
    bar PowerShell also reads as one) that holds a dot or ends with a colon (PowerShell would not pass
    them on as written);
  - a keel script command that holds the words of a step Claude Code must confirm (`delete`, `drop`,
    `empty-trash`, `merge`, `delete-branch`, `trust`) as a word without quotes but does not read as that
    step (in quotes it is plain text, such as a title "drop"); `plans.js`
    confirms only its own `commit` and `push` (its search takes free words such as `drop`), and
    when either word stands anywhere else in its command, Claude Code asks instead of refusing;
  - a keel script run with `node`, `nodejs`, `bun` or `deno` in any other form (node options, `env`,
    `bash -c`, a wrapper), which the hook cannot judge, so a broad allow rule cannot run a step that
    must be confirmed. A command that only reads a script (`grep`, `sed`, `cat`) runs nothing and is
    left to your normal permissions;
  - a step that must be confirmed, run with keel's step script named through another path
    (`$CLAUDE_PLUGIN_ROOT`, `~`, another copy of keel): the hook cannot tell it from keel's own. Other
    scripts named that way are left to your normal permissions, as the hook cannot tell them apart
    from your project's own;
  - a `node`, `nodejs`, `bun` or `deno` command that names keel's library (`scripts/lib/`) by keel's
    folder or `$CLAUDE_PLUGIN_ROOT`, or, in another copy of keel, its modules that hold the steps
    (`tasks.js`, `trash.js`, `trust.js`, `finish.js`): their functions drop or delete without the step
    scripts' checks, and no keel step runs them directly. A project's own `scripts/lib/` is not
    affected.

  The steps that change your Claude Code settings, move your files in a migration or set up usage
  (`apply`, `prices-apply`, `install-statusline`) are left to your normal permissions too.
- **Secrets are handled by path only**: `.env`, keys, certificates and credential files are listed by
  path, the diff that agents get leaves their content out, and keel's git script never commits them. Agents are instructed never to open them; that is an instruction, not something a hook
  enforces.
- **Nothing is deleted** by cleanup or by finishing a task: files and finished task folders go to
  keel's trash. Cleanup never moves a secret file, nor a folder that holds one, because emptying the
  trash would delete it for good. The trash is never emptied by itself, only through `/keel:cleanup empty-trash`, after
  Claude Code's confirmation.
- **No AI attribution** in commits and pull requests (the hook above refuses them in set-up projects).
- **Agents that only read cannot write**; agents that run code are checked: after each one keel
  compares the working tree (tracked files and untracked files git does not ignore) and stops if
  anything changed; the QA agents may write only in `.keel/local/tmp/qa/` (a hook enforces it). The same check runs around the QA
  reproduce commands keel re-runs, and keel's command check refuses one that would discard work (such
  as `git restore`, `git stash`, `git reset`, `git rm`, `git mv`, `git checkout --`, `git switch -f`,
  `find -delete`, `rm`, `mv`).
- **Critical steps are scripts, not text**: config checks, secret scanning, vote counting, token
  accounting, merge questions, and in planning the draft's structure check, ticket keys and ticket
  states (`plans.js`).
- **Data that leaves the machine.** Usage data goes only to the usage page you set up: your own
  private page, or a team page you approved
  ([what goes there and what never does](usage-dashboard.md#what-goes-to-the-page-and-what-never-does)).
  Other network use: keel's git steps fetch from and push to your remote (in autonomous mode, or in
  manual mode when you ask for that step); a task link you give is read with a connector, `gh` or a
  web fetch;
  `/keel:configure` runs Claude Code's `claude plugin list --json --available` to look for stack
  plugins in the marketplaces you added; a price update, only when you ask for one, has an agent read
  the official pricing page.

Reporting a vulnerability: [SECURITY.md](../SECURITY.md).

## Overhead

In a set-up project keel adds about 3.6k tokens to every conversation: its working standards and the
project's comment rules (about 2.3k) and the skill and agent descriptions (about 1.3k). The standards
are added again after `/clear` and after compaction. In a project keel is not set up in, only the
skill and agent descriptions remain, because Claude Code lists them wherever keel is installed.
Each end of work syncs the cost data for about $0.01-0.04 when the dashboard is set up.

## Advisory skills

In a set-up project the model loads these by itself when they apply; for 6 of them the skill hints
above remind it:
`architecture`, `adr-required`, `documentation-philosophy`, `git`, `migration-safety`,
`performance-review`, `postgres-best-practices`, `production-readiness`, `python-conventions`,
`root-cause-analysis`, `when-tests-are-owed`. `/keel:configure` also suggests checked plugins for your
stack (you run the install commands yourself).

## Languages

The model talks in any language you set (`conversation_language`). keel's own fixed texts (the cost
report, the context warning, the usage dashboard) come in English and Ukrainian; other languages fall
back to English. A new language for the report and the warning is a new catalog in
`plugins/keel/locales/`; the usage dashboard itself chooses only between English and Ukrainian today.
How to add one: [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-language). What keel writes into the
repository (commit messages, the note, task files) follows the project's `repo_language`.

## Moving from another notes system

If `/keel:configure` finds another system of notes, memory or session logs (or you name its folder),
it proposes a migration plan: what moves, what is converted, which references in your docs change
(shown as a diff), what stays. Project data and secrets are never moved. Nothing happens without your
yes, and an interrupted migration continues where it stopped. Run it later with
`/keel:configure migration`.
