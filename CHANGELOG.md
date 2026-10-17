# Changelog

All notable changes to keel are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/mvbsoft/keel/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/mvbsoft/keel/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/mvbsoft/keel/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/mvbsoft/keel/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/mvbsoft/keel/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/mvbsoft/keel/releases/tag/v1.0.0
