# keel settings

[Українська](settings.uk.md)

Every keel setting: what it does, its values, where it is stored, and who it applies to.

## Where a setting applies

Each setting has one of three homes:

| Home | Applies to | Stored in | In git |
|---|---|---|---|
| **This machine** | every project on this computer | `~/.claude/settings.json`, `~/.claude/keel/` | no |
| **This project** | this project, for everyone who works on it | `.keel/config.json` | yes, shared with the team |
| **Machine or project** | every project on this computer, unless a project sets its own value | machine: as above; project: `.claude/settings.local.json` or `.keel/local/options.json` | no, personal |

Planning keeps a file of its own, this project on this machine ([planning settings](#planning-settings)).

**Rule:** a project's own value wins over the machine value. Remove the project value and the machine
value applies again. One exception: `prompt_preview` can only be turned off for a project. When the
machine value is off, a project value of on has no effect.

Example: the machine compacts conversations at 300,000 tokens. One large project sets 500,000 for
itself. Sessions in that project compact at 500,000; every other project still compacts at 300,000.

## How you set them

| When | What it sets |
|---|---|
| Installing keel | the two plugin options below, as **machine** values |
| `/keel:configure` in a project | asks first: this project, or only this machine. Project mode sets the project's settings and, for "machine or project" settings, shows both values and lets you keep the machine value or set one for the project. A first setup also asks: **quick** (recommended, about six questions; every other value is keel's recommendation) or **detailed** (every section; both explain each question group first) |
| `/keel:configure machine` | only the machine values, for every project |
| `/keel:configure check` | which sections to run again since the last configure, and why; changes no setting |
| `/keel:configure <section>[,<section>...]` | those sections again, written once at the end (`gates,git`); sections: `languages`, `scan`, `gates`, `git`, `verification`, `code`, `plugins`, `docs`, `migration`, `settings`, `usage` or `prices` |

Nothing is written without your yes. The Claude Code settings files and the price table are backed up
before keel changes them (project files in `.keel/local/backups/`, the machine file next to itself).

### Installing for one project

keel works only in a project that has `.keel/config.json`, the file `/keel:configure` writes. In any
other project its hooks add nothing to the conversation, Claude cannot load its skills on its own
(configure and help run only when you type them), and its agents are refused until `/keel:configure` has created the
`.keel/` folder. A keel command you type there offers to run `/keel:configure` first. Two things keep
working everywhere: recording which wallet a session pays from, and the status line. Installed for
your user, keel's agents and skills are still listed in every project, because Claude Code lists them.

`claude plugin install keel@keel --scope project` (for everyone who works in the repository) or
`--scope local` (only for you, in this repository) turns keel on in one repository only. The scope
decides only **where keel is turned on**. The answers to the install questions (conversation
language, Opus) are still stored for the whole machine: Claude Code keeps plugin options in the user
settings and ignores them in project files, so a cloned repository cannot change them. To give one
project its own language or Opus choice, run `/keel:configure` in it and choose "set for this
project"; keel then keeps that value in the project's `.keel/local/options.json`.

## Required and optional

Detailed setup asks every section. **Required** sections cannot be skipped, but you can accept the
proposal with one answer: repository language, gates, git, verification thresholds, file sizes and the
comment level, the documentation profile. Everything else is **optional**: skipping it leaves the
default or the machine value.

Quick setup asks only what needs you (the languages, the gate commands, the git mode and main branch,
and a few more when they apply) and takes keel's recommendation for the rest. Its summary lists every
value it did not ask, with the section that changes it.

## Machine or project

| Setting | What it does | Values | Default | keel recommends |
|---|---|---|---|---|
| `conversation_language` | the language keel talks, asks, reports and plans in | a language code: `en`, `uk`, `de`... | `en` | your language |
| `allow_opus` | off: keel agents that would run on Opus run on Sonnet instead (cheaper, less thorough) | on / off | on | on |
| `autoCompactWindow` | at how many tokens Claude Code compacts the conversation; keel's [context warning](under-the-hood.md#what-runs-by-itself) comes at 90 % of it (of `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when that is set), at most the model's own window; a value below 100,000 here is ignored (the environment variable is raised to 100,000) | a number of tokens | Claude Code's own (about 967k with a 1M model) | 300,000 |
| `showClearContextOnPlanAccept` | after you approve a plan, offer to start the work from the plan alone, without the planning conversation | on / off | off | on |
| `bashOutputMaxChars` | command output longer than this goes to a file with a preview instead of the conversation | characters | 30,000 | 15,000 |
| `attribution` | the "generated with" line and co-author trailer in commits and pull requests | Claude Code's attribution object | Claude Code adds them | none |
| `prompt_preview` | send the first 100 characters of each request (secrets masked) to your usage page. A project can only turn it off: with the machine value off, a project value of on has no effect | on / off | on | your choice |

Why 300,000 for compaction: every request re-reads the whole conversation. On Opus a request at 600k
tokens costs about $0.12 in cache reads, at 300k about $0.06. The price of a smaller window is that
details from early in the conversation are lost at each compaction more often.

Where the values live: the machine value of the first two is the keel plugin option; of
`prompt_preview` it is `~/.claude/keel/usage.json`; the rest are in `~/.claude/settings.json`. A
project's own value of `conversation_language`, `allow_opus` and `prompt_preview` is in
`.keel/local/options.json`, of the others in `.claude/settings.local.json`.

## This machine

In `~/.claude/keel/usage.json` unless noted. Set in `/keel:configure` (section "Usage and costs") or
`/keel:configure machine`, except `history_days`: configure never asks it, you edit the file.

| Setting | What it does | Values | Default |
|---|---|---|---|
| `statusLine` (in `~/.claude/settings.json`) | the status line; keel's own, or yours wrapped so keel can record the plan-limit percentages | keel / wrap yours / none | none |
| `wallet_default` | the wallet of a session keel's hook did not mark at its start; a marked session is `api` with an API key, token or helper (or Bedrock, Vertex, Foundry, Mantle), `cloud_wallet` on the web, otherwise `subscription` | `subscription` / `api` / `credit` | `subscription` |
| `cloud_wallet` | how Claude Code on the web pays | `subscription` / `api` / `credit` | `credit` |
| `also_api` | this machine uses both a subscription and an API key. On: a session keel's hook did not mark is shown as `unknown` instead of `wallet_default`, and is left out of the limit calibration | on / off | off |
| `pc` | this machine's name on the usage page | 1 to 40 letters, digits, `-`, `_` | the computer name |
| `user` | your name on the usage page, to tell people apart on a team page | text | your git email |
| `history_days` | how far back the first sync to a usage page reaches (also the first sync after the page address changes); later syncs send what changed since the last one | days | 30 |
| `artifact_url` | the address of your private "keel usage" page | a claude.ai link | none |
| `approved_artifact_urls` | team page addresses from project configs that you allowed this machine to send to; used only while `artifact_url` is not set | claude.ai links | none |
| `page_template` | the fingerprint of keel's page files this machine last published to the usage page; when this keel's files differ, `/keel:usage` and `/keel:configure usage` offer to [update the page](usage-dashboard.md#updating-the-page) | written by `/keel:configure usage` | none |
| autonomous git (in `trusted-git.json`) | projects where you confirmed, in Claude Code's prompt, that keel may run its git steps (branch, commit, update from the main branch, push) without asking each time (a push from the main branch goes through your normal permissions; a merge still asks unless `git.ask_before_merge` is off), with a fingerprint of the project's `git` settings: when they change, keel asks again until you confirm once more | written by `git-flow.js trust` | none |
| prices (in `prices.json`) | your own price table, written by `/keel:configure prices` | a price table | keel's bundled table |

## This project

In `.keel/config.json`, committed and shared with the team. ★ marks a setting every config must have;
`/keel:configure` always writes it (quick setup takes the recommendation for some of them without asking).

| Setting | What it does | Values | Default |
|---|---|---|---|
| ★ `schema_version` | the version of the config format; written by `/keel:configure`, do not edit it | `1` | `1` |
| ★ `repo_language` | the language of what keel writes into the repository: commit messages, the note, memory, session logs, new documents | a lowercase language code, optionally with a region: `en`, `uk`, `pt-BR` | `en` |
| ★ `gates.checks` | the commands keel runs as gates: tests, linters, type checks, per part of a monorepo | commands | proposed from the project scan |
| ★ `gates.security_scanners` | security scanners run with the gates; one that is not installed is a loud warning, not a failure. A command may start with a path from the project folder (`./gradlew …`, `.venv/bin/bandit …`); a bare name is looked up on PATH | commands | proposed from the scan |
| ★ `git.mode` | who does git: you (keel writes a commit message and runs no git step nobody asked for) or keel (commit, update from the main branch, push; merge as `git.ask_before_merge` says). In both modes keel runs what you ask for: the branch you choose at a task's start, your own git steps | `manual` / `autonomous` | none: `/keel:configure` asks and recommends `manual` for a first project |
| ★ `git.main_branch` | the main branch | a branch name | from the repository |
| ★ `git.ask_before_merge` | autonomous mode. On: keel merges into the main branch only when your instruction asks for it (`/keel:end-task finish and merge into main`), and Claude Code asks you to confirm. Off: finishing a task or a line of work also merges; it runs without asking only once you confirmed autonomous mode on this machine, otherwise Claude Code asks | on / off | on |
| ★ `git.state_in_git` | keep the note, memory and session logs in git. `/keel:configure` applies it by listing them in `.keel/.gitignore`; the value alone does not change what git keeps, so change it with `/keel:configure git`, not by hand | on / off | on |
| ★ `verification.tier_rules.gates_only_max_files` | a change of up to this many files, none of which changes behavior (text, comments, docs), is proposed for gates only | files | 1 |
| ★ `verification.tier_rules.basic_max_modules` | a change in up to this many modules is proposed for Basic; more modules, Standard | modules | 1 |
| ★ `verification.tier_rules.large_change_lines` | from this size a change is large (Standard) | lines | 400 |
| ★ `verification.tier_rules.very_large_change_lines` | from this size a change is very large (Maximum) | lines | 1000 |
| `verification.tier_rules.core_fan_in` | a change in a file that this many files import is core code (Maximum) | files | 5 |
| ★ `verification.verifier_caps` | how many verifiers may check findings at each level | numbers for basic, standard, maximum | 2, 5, 8 |
| ★ `architecture.file_lines_warn` | a file longer than this gets a warning | lines | 700 |
| ★ `architecture.file_lines_max` | a file longer than this is a finding | lines | 1000 |
| `comments.level` | how much commenting keel writes: tricky code only, plus a line per public function, or more. Detailed setup always asks it; quick setup takes the level closest to the project's current code | `short` / `functions` / `detailed` | `short` |
| `comments.ticket_prefixes` | ticket id prefixes (ABC for ABC-123) reported when they appear in new comments and docs | prefixes: an uppercase letter, then uppercase letters or digits | none |
| `comments.adr_refs` | whether decision-record mentions (ADR-12) are allowed in comments and docs | `allowed` / `forbidden` | `allowed` |
| `comments.refs_exempt` | more files where ids are the subject and are not reported; the built-in ones (decision records, task and ticket folders, changelogs, `.keel/`) always apply | glob patterns | none |
| ★ `docs.profile` | how much documentation keel writes: 1 keep docs true, 2 + ADRs, 3 + a spec per feature, 4 heavy | 1-4 | 1 |
| ★ `docs.pattern` | where new docs go (profiles 3-4). Existing docs are not moved as a side effect: when detailed setup picks a pattern your docs do not follow yet, keel offers to prepare the move as its own task ([your existing docs](getting-started.md#3-set-up-a-project-keelconfigure)) | `none` / `diataxis` / `arc42` / `arc42-c4` | `none` |
| `delegation.min_plan_steps`, `min_plan_files` | from this plan size keel offers to hand the steps to implementer agents | steps, files | 8, 15 |
| `cleanup.trash_max_age_days` | `/keel:cleanup empty-trash` deletes batches this many days old or more by default | days | 30 |
| `tasks.in_git` | where unfinished task folders live: `true` in `.keel/tasks/<id>/`, committed on the task's branch so the team sees them; `false` in `.keel/local/tasks/<id>/`, this machine only. See [ways of working](workflows.md#where-the-files-live) | on / off | on |
| `stack_skills` | the stack plugins you chose (for information) | names | none |
| `usage.artifact_url` | a usage page the team shares. A machine sends to it only after its user approves it, and only while the machine has no `artifact_url` of its own. It then receives that machine's usage from **all** its projects (project folder names, branches, request previews unless turned off), not only from this one | a claude.ai link | none |

`.keel/profile.json`, also committed, holds what the project scan found and you confirmed: the parts of
the project, their languages and commands, and the secret files by path. Its `run_command` per part is
the command that starts the app, which the QA agent uses (or `null` when there is none). Change the
profile with `/keel:configure scan`.

Two more project settings are personal and live in `.claude/settings.local.json` (outside git; when
git does not ignore that file yet, `/keel:configure` offers to add it to `.gitignore`):

| Setting | What it does | keel writes |
|---|---|---|
| `plansDirectory` | where Plan Mode keeps plan files | `./.keel/local/plans/claude` (before keel 1.3: `./.keel/local/plans`; `/keel:configure` offers to move the old plans) |
| `permissions.allow` | commands that run without a permission prompt | your confirmed gate commands |

### Planning settings

Planning keeps its own settings in `.keel/local/plans/keel/settings.json` (outside git, this machine
only). `/keel:configure` does not ask them: the first `/keel:start-planning` asks the language and
where drafts live, the first export where tickets go and their prefix, and a change you name at any
start ("draft in the repo") is saved too.

| Setting | What it does | Values | Default |
|---|---|---|---|
| `language`, `draft`, `draft_dir` | the language of `plan.md` and the tickets; where a draft lives; its folder in the repository | a language code; `pc` (this machine) or `repo`; a folder | `repo_language`; `pc`; `tickets` |
| `export`, `export_dir`, `prefix` | where exported tickets go; their folder in the repository; the start of each ticket key (`PROJ` in `PROJ-12`) | `pc` or `repo`; a folder; 2-10 capital letters and digits, starting with a letter | none; `tickets`; none |

Places keel never uses: [export](workflows.md#export). How they are used:
[ways of working](workflows.md#planning).

## Examples

Four sample setups. They are examples, not recommendations to copy: the values are chosen to show how
the settings fit together. Each project snippet shows only the keys that matter; the other required keys
stay as `/keel:configure` wrote them.

### a) A solo developer on a subscription

Manual git, and a verification that stays at Basic for most changes.

`.keel/config.json` (excerpt):

```json
{
  "git": { "mode": "manual", "main_branch": "main", "ask_before_merge": true, "state_in_git": true },
  "verification": {
    "tier_rules": {
      "gates_only_max_files": 1,
      "basic_max_modules": 2,
      "large_change_lines": 600,
      "very_large_change_lines": 1000
    }
  }
}
```

Basic is proposed for changes in up to 2 modules (default 1), and Standard only from 600 lines (default
400).
Maximum still starts at 1,000 lines. keel gives a commit message and runs no git step you did not ask
for.

`~/.claude/settings.json` (this machine):

```json
{ "autoCompactWindow": 300000, "bashOutputMaxChars": 15000 }
```

Compaction at 300,000 tokens and command output cut at 15,000 characters: the values keel recommends.

### b) A team repository

Autonomous git with a confirmation before every merge, no decision-record mentions in code, and ticket
prefixes checked.

`.keel/config.json` (excerpt):

```json
{
  "git": { "mode": "autonomous", "main_branch": "main", "ask_before_merge": true, "state_in_git": false },
  "tasks": { "in_git": false },
  "comments": {
    "level": "short",
    "ticket_prefixes": ["PROJ", "SHOP"],
    "adr_refs": "forbidden",
    "refs_exempt": ["docs/debt-register.md"]
  },
  "docs": { "profile": 2, "pattern": "none" },
  "usage": { "artifact_url": "https://claude.ai/artifact/EXAMPLE" }
}
```

`ask_before_merge: true` means keel merges only when you ask for it, and Claude Code asks you to confirm
the merge. `state_in_git: false` keeps the note, memory and session logs out of git (the team's
repository stays clean); `/keel:configure git` sets it and lists those files in `.keel/.gitignore`. `tasks.in_git: false` does the same for task folders: they stay on each
developer's machine instead of travelling on the task branches. `ticket_prefixes` and `adr_refs` make
keel report `PROJ-123` and `ADR-12` in new comments and
docs. `refs_exempt` lists a file where such ids are the subject. Profile 2 adds an ADR for significant
decisions. `usage.artifact_url` is a placeholder for a usage page the team shares; each machine sends to
it only after its user approves it, and a machine that has its own `artifact_url` keeps sending there. An
approved machine sends its usage from all its projects, not only from this one, so the team sees those
projects' folder names and branches too (and request previews, unless they are off). Each developer
confirms autonomous mode once on their own machine.

### c) A large monorepo with its own settings

A project that needs a bigger compaction window and a different conversation language than the machine.

`.keel/config.json` (excerpt):

```json
{
  "gates": {
    "checks": [
      { "part": "services/api", "kind": "test", "command": "npm test --workspace services/api" },
      { "part": "services/web", "kind": "test", "command": "npm test --workspace services/web" },
      { "part": "services/web", "kind": "lint", "command": "npm run lint --workspace services/web" }
    ],
    "security_scanners": [{ "name": "npm audit", "command": "npm audit" }]
  },
  "verification": {
    "tier_rules": {
      "gates_only_max_files": 1,
      "basic_max_modules": 1,
      "large_change_lines": 400,
      "very_large_change_lines": 1000,
      "core_fan_in": 15
    }
  }
}
```

`.claude/settings.local.json` (personal, outside git):

```json
{ "autoCompactWindow": 500000 }
```

`.keel/local/options.json` (personal, outside git):

```json
{ "conversation_language": "de" }
```

Sessions in this project compact at 500,000 tokens and keel talks German here; every other project keeps
the machine values. The project value wins over the machine value. `core_fan_in: 15` raises the point
where a change in a widely imported file counts as core code (default 5), because in a monorepo many files
share a few libraries.

### d) A project that turns prompt previews off

For a project with sensitive requests: the usage page then gets no request text and no task title,
and step titles become "step 1", "step 2".

`.keel/local/options.json` (this project only):

```json
{ "prompt_preview": false }
```

To turn them off for every project on the machine, set `prompt_preview` to `false` in
`~/.claude/keel/usage.json`, or answer the question in `/keel:configure usage`. A project cannot turn
them back on while the machine value is off. See the
[usage dashboard](usage-dashboard.md#what-goes-to-the-page-and-what-never-does) for what is sent.
