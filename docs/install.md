# Install, update and remove keel

[Українська](install.uk.md)

keel is a Claude Code plugin; you install it once per machine (or per project, see
[scopes](#install-scope)). This page covers the requirements, installing, what keel changes, updating,
removing and fixing common problems. Setting up a project after the install:
[Getting started](getting-started.md).

## Requirements

1. **[Node.js](https://nodejs.org) 22 or newer.** Every keel script and hook runs on Node. Claude Code
   itself does not need Node, so check with `node --version`. With an older Node, keel's commands stop
   with a one-line message on how to update it; with no Node at all, keel's hooks and commands simply
   fail.
2. **[Claude Code](https://code.claude.com/docs) 2.1.296 or newer** (the version keel was tested on).
   keel's confirmations and agent reports rely on recent hook features; on an older version they may
   not work, and keel does not check the version itself. keel runs in Claude Code today; other coding agents are planned.
3. **git.** Each task lives on its own branch, and verification looks at what changed in git: for a
   task, everything on its branch since the base branch; for a session, everything since the session
   started. In a folder that is not a git repository, keel offers `git init` and a first commit, or
   stops.
4. **Windows, macOS or Linux.** keel is developed and used daily on Windows 11; the test suite also
   runs on Linux (Node 22 in Docker), and CI runs it on all three. keel's status line runs in
   PowerShell on Windows and in bash elsewhere; its icons also show in bash 3.2 (the one macOS ships)
   and without a UTF-8 locale. On macOS and Linux it needs [jq](https://jqlang.org); without it the
   line shows less, and the limit recording still works.

Optional, used when present:

- **[gh](https://cli.github.com)**, to read a GitHub issue or pull request link given to
  `/keel:start-task`.
- **A Claude Code connector** for Jira, Linear or Asana, to read a ticket link. Without it, or with any
  link keel cannot read, keel asks you to paste the text.
- **Security scanners** such as [gitleaks](https://github.com/gitleaks/gitleaks) and
  [semgrep](https://semgrep.dev). A scanner the project's setup names but this machine does not have
  is a loud warning in every report, not a failed check.

## Install

In Claude Code (it asks for the two settings below and for the [scope](#install-scope)):

```
/plugin marketplace add mvbsoft/keel
/plugin install keel@keel
```

If the keel commands do not appear, run `/reload-plugins` or restart Claude Code.

Or in a terminal, with the settings given as options:

```bash
claude plugin marketplace add mvbsoft/keel
```

```bash
claude plugin install keel@keel --config conversation_language=en --config allow_opus=true
```

| Setting | What it does | Default |
|---|---|---|
| `conversation_language` | the language keel talks, reports and writes plans in (`en`, `uk`, `de`, ...); asking for another language in a conversation wins for that conversation | `en` |
| `allow_opus` | off: every keel agent that would run on Opus runs on Sonnet instead | on |

Every other setting is asked by `/keel:configure`: [settings](settings.md).

Then open your project and run `/keel:configure`
([Getting started](getting-started.md#3-set-up-a-project-keelconfigure)).

### Install scope

The scope decides where Claude Code turns keel on. The `/plugin` panel asks for it; in a terminal add
`--scope project` or `--scope local` (the default is user).

| Scope | Who gets keel | Where Claude Code records it |
|---|---|---|
| user (default) | you, in every project on this machine | `~/.claude/settings.json` |
| project | everyone who works in this repository, once the file is committed; each teammate still installs keel once with the same command | `.claude/settings.json` |
| local | only you, only in this repository | `.claude/settings.local.json` |

The two settings above are kept for the whole machine in every scope; how one project gets its own
values: [settings](settings.md#installing-for-one-project).

## What keel changes on your machine and in projects

**Where keel acts.** keel works only in a project you set up with `/keel:configure` (it has
`.keel/config.json`). In any other project:

- its hooks add nothing to the conversation: no working standards, no language line, no comment
  rules, no context warning, no skill hints, no AI-attribution check;
- its agents and advisory skills are refused, so Claude Code uses its own (keel's agents run again as
  soon as the project has a `.keel/` folder, for example while `/keel:configure` runs);
- `/keel:configure` and `/keel:help` still work.

Two things run in every project, because they belong to the machine: the usage recording (one line
per conversation start in `~/.claude/keel/sessions.jsonl`, nothing for the model to read) and keel's
status line, if you installed it. Installed for your user, keel's commands, agents and skills are still
listed by Claude Code in every project (their short descriptions). For no trace at all in other
projects, install with `--scope project` or `--scope local`.

**On this machine**, keel writes:

- `~/.claude/keel/`: the machine's usage settings (`usage.json`), plan-limit snapshots
  (`limits.jsonl`, its previous part `limits.1.jsonl`, `limits-last.json`), the usage data read from
  transcripts for the dashboard (`usage-cache/`, `usage-index.json`, `keel-tasks.jsonl`,
  `sync-state.json`, the last plan-limit calibration `calib-latest.json`), which wallet each conversation paid from (`sessions.jsonl`),
  the projects where you confirmed autonomous git (`trusted-git.json`), your updated price table
  (`prices.json`, only after a price update you accepted in `/keel:configure`; the previous one as `prices.json.bak`), the status line script (`statusline.js`) and
  the plugin's folder for it (`plugin-root.txt`);
- `~/.claude/settings.json`, only after your yes in `/keel:configure`: the Claude Code settings you
  accepted, keel's two settings (`pluginConfigs`) and the status line, with a backup copy
  `settings.json.keel-backup-*` next to it.

**In a project**, only after your yes in `/keel:configure`: the `.keel/` folder, your personal Claude
Code settings for the project in `.claude/settings.local.json` (backed up in `.keel/local/backups/`),
a line for that file in `.gitignore` when git does not ignore it yet, and a short "Working with Claude
Code" section in the README. What is inside `.keel/`:
[under the hood](under-the-hood.md#what-keel-keeps-in-your-project).

## Update

```bash
claude plugin marketplace update keel
```

```bash
claude plugin update keel@keel
```

Then start a new conversation. A project whose `.keel/config.json` is older than the new version is
repaired by `/keel:configure`: it asks only about the new fields and keeps everything else.

## Uninstall

```bash
claude plugin uninstall keel@keel
```

```bash
claude plugin marketplace remove keel
```

Installed with `--scope project` or `--scope local`: add the same `--scope` to the uninstall command.

keel also leaves these, which you can remove by hand:

- **The status line.** If keel installed or wrapped it, `statusLine` in `~/.claude/settings.json` still
  points at `~/.claude/keel/statusline.js`, which then runs your previous command (kept in
  `~/.claude/keel/usage.json` as `statusline.original`) or prints nothing. Put your old command back,
  or delete the `statusLine` key.
- **`~/.claude/settings.json`**: the Claude Code settings you accepted during `/keel:configure`
  (`showClearContextOnPlanAccept`, `autoCompactWindow`, `bashOutputMaxChars`, `attribution`), keel's
  entry under `pluginConfigs`, and the backup copies `settings.json.keel-backup-*` next to the file.
- **`~/.claude/keel/`**, with every file listed [above](#what-keel-changes-on-your-machine-and-in-projects).
- **In each project**: `.keel/`; in `.claude/settings.local.json` the values keel wrote (`plansDirectory`,
  the gate commands under `permissions.allow`, and any project values of the settings above; the
  backup is in `.keel/local/backups/`); the `.claude/settings.local.json` line keel may have added to
  `.gitignore`; and the "Working with Claude Code" section in the README.
- **The "keel usage" page** in your claude.ai account, if you created it.

## Troubleshooting

- **"keel needs Node.js 22 or newer"** (your Node is older), or keel's hooks and commands fail with
  no Node at all: install Node 22+ from [nodejs.org](https://nodejs.org) and start a new conversation;
  check with `node --version`.
- **The status line is empty or shows little on macOS or Linux**: install [jq](https://jqlang.org).
  The plan-limit recording works without it.
- **The report shows no plan percentages**: keel learns the price of 1 % of your limits from the
  status line's measurements; until there are some, it says so. In the desktop app, which has no
  status line, keel asks the app at the end of a task. Details:
  [usage dashboard](usage-dashboard.md#plan-limit-percentages-and-calibration).
- **keel stops because git does not trust the folder** ("dubious ownership", `git: refused`): the
  project folder belongs to another user than the one running git. keel names git's own fix; run it
  yourself if you trust the folder:
  `git config --global --add safe.directory "<folder>"`.
- **A keel command asks to run `/keel:configure`**: the project has no `.keel/config.json` yet, or it
  is out of date; configure repairs only what is missing.
- **keel does nothing in a project** (no standards at the start of a conversation, its agents are
  refused): the project is not set up; run `/keel:configure`.
- **An update does not arrive**: run the two update commands above and start a new conversation.
- **A project hook refuses keel's scripts**: keel stops and explains; it offers a narrow exception for
  `node` running a file in keel's own `scripts/` folder, or you keep the hook as it is.
- **Claude Code asks for permission to run a keel step.** keel's scripts run without a prompt only in
  the plain form keel uses (`node "<keel>/scripts/<name>.js" "<project>" ...`); any other form (node
  options, `env`, `bash -c`, joined commands, in PowerShell `--%` or an empty argument) is refused, and
  keel sends it again in the plain form ([under the hood](under-the-hood.md#safety)); reading a keel
  script with `grep` or `sed` follows your normal permissions. Some steps ask on purpose, every time:
  - steps that write outside keel's own folders: applying Claude Code settings, moving another notes
    system into keel, and the usage setup (its settings, a price update, installing the status line);
  - in autonomous git, the git steps until you confirm autonomous git for the project on this machine
    (and again after the project's git settings change), and a push from the main branch;
  - confirmations that start with "keel:": finishing or dropping a task (its folder goes to keel's
    trash), deleting a branch, emptying the trash, confirming autonomous git, and a merge (unless
    `git.ask_before_merge` is off in a confirmed autonomous mode).

  Why each step is guarded: [how keel behaves](behavior.md).
