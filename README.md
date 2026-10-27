<p align="center">
  <img src="docs/images/keel-mark.png" alt="" width="260"><br>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/keel-wordmark-on-dark.svg">
    <img src="docs/images/keel-wordmark-on-light.svg" alt="keel" width="230">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/mvbsoft/keel/actions/workflows/test.yml"><img src="https://github.com/mvbsoft/keel/actions/workflows/test.yml/badge.svg" alt="test"></a>
  <a href="https://github.com/mvbsoft/keel/releases"><img src="https://img.shields.io/github/v/release/mvbsoft/keel" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="license: MIT"></a>
</p>

<p align="center"><a href="README.uk.md">Українська</a></p>

**Plan, build and independently verify your work with an AI coding agent.**

keel is for people who build a real project with Claude Code, alone or in a team. It removes three
everyday problems of that work: explaining the context again in every conversation, AI changes that nobody
checked, and costs you learn about too late.

At the start keel understands the task and makes a plan; while you work it writes code to your
standards; at the end separate agents verify the change, keel does the git steps (or gives you the
commands, in manual mode) and reports what it all cost. Independent verification at a level you
choose, with its price shown before and after ([measurements](docs/verification.md#cost)).

keel runs in **Claude Code** today; support for other coding agents is planned.

## The idea: spend where it pays

keel exists to make building with an AI agent cheaper without making the result worse. Every choice in
it follows one rule: **find the point where spending more stops buying real quality, and stop there.**

- **A trade must be worth it.** Giving up a couple of percent of quality for 20-30 % less cost is a
  good trade; giving up 5 % for 10 % is not. Where there is no measurement, keel does not trade.
- **A false alarm is a cost, not a bonus.** A "bug" that is not real costs your time and a fix that
  can break working code. So serious findings go to separate verifiers that try to refute them (as
  many as the level allows); a finding that QA "proved" is re-run by keel and becomes "unclear" when
  the problem does not show again; and anything that was not checked is labelled "not verified".
- **The right model for each job.** Haiku for mapping and mechanical work, Sonnet for most of it,
  Opus only where a miss is expensive (security, architecture, the deepest level). keel proposes the
  verification level from the real risk of the change; you choose.
- **A long conversation is a growing bill.** Every request re-reads the whole conversation, so
  keel keeps it short: a handoff note instead of a long chat, earlier compaction, long command output
  in files.
- **You always see the price.** Every end of work shows who ran, the tokens, the dollars and the share
  of your plan limits.
- **What must hold is code, not a prompt.** Confirmations before keel's own steps that are hard to
  undo, the verification record before a finish, and keel's own git step (no secret files, no AI
  attribution, no commit on the main branch) are hooks and scripts, which a model cannot talk its way
  around. Git or shell commands the model runs by itself go through your Claude Code permissions as
  usual. The rest is instructions; [How keel behaves](docs/behavior.md) says which is which.

What this looks like in numbers. These are measured, not estimated: real keel runs on a test set of 8
changes with 17 known defects, each scored blind against an answer key; the cost is Claude Code's own
count of every request's tokens at Anthropic's list prices, for the verification only. Basic and
Standard: 3 runs per change, Maximum: 1 run per change (October 2026, keel 1.0); the plain reviewer:
one earlier run per change. The numbers are re-measured from time to time, so they will change
([method and details](docs/verification.md#cost)).

| | Cost per change (verification only) | Defects found (of 17) | False alarms in "must or should fix" |
|---|---|---|---|
| one plain AI reviewer, no keel (earlier run) | ≈$0.22 | 15.5 | 4 in 8 runs |
| keel Basic | ≈$0.34 | 15.3 | 0 in 24 runs |
| keel Standard | ≈$2.4 (median $2.0) | 16.3 | 0 in 24 runs |
| keel Maximum | ≈$5 (median $4.7) | 17 | 0 in 8 runs |

"Defects found" counts a defect named at any severity, also as an unverified nice-to-fix item;
counting only the must or should list, Basic and Standard each found 15 of 17, Maximum 14. 14 of
the 17 were found in every run of every keel level, so the levels differ mainly on subtle defects.

So keel does not make a review cheaper than one plain AI review; it makes it cleaner. Basic found about
as many known defects as a plain review, with a short fix list and no false alarms in it (2.7 items a
run, against 5.5 a run in the plain review, 4 of them false over its 8 runs), for about 1.5 times its cost. Standard costs
about 7 times Basic; its extra finds were subtle defects reported as nice-to-fix. Maximum (one run per
change) was the only level to find all 17, though it listed 3 of them as nice-to-fix. keel proposes
the deeper levels where a missed bug costs more than that: money, access, data migrations, code many
files depend on. That is a judgement, not a measurement: on the test set Basic's fix list matched
Standard's on every change.

## What it does for you

- **You never explain the context twice.** A task or a long plan lives in a short handoff file, so the
  next conversation, yours or a teammate's, continues where the last one stopped.
- **You juggle tickets without losing track.** Each task has its own branch and folder; park one, take
  another, come back later. A big job that runs for weeks keeps its place the same way.
- **You talk in plain words.** `/keel:end-task hand off` or `/keel:end-session push and merge into
  main`; keel asks when it is not sure and says what it will do before each step.
- **You ship changes that were checked.** You choose the depth by price: from the project's own tests
  and linters (about $0.2) to a full team of agents (about $2.7-7.6) where the change is risky. Before you
  see the serious findings, verifier agents try to refute them (as many as the level allows), so you
  fix real problems, not false alarms.
- **Your git stays clean.** Branches, commits that leave out secret files and files from before the task and carry no AI attribution, updates from main and
  pushes, done the same way every time; merging into main only when you say so (or on every finish, if you set that up).
- **You know what the work cost.** Every end of work shows a table of who ran, the tokens and the
  dollars, and on a subscription the share of your plan limits (once keel has measured it). An
  optional private dashboard collects every machine.
- **Your team works one way.** The project's keel settings live in git, so everyone plans, checks and
  commits by the same rules.

<p align="center">
  <img src="docs/images/usage-dash.png" alt="The keel usage dashboard (sample data)" width="720"><br>
  <em>The private usage dashboard (sample data): <a href="docs/usage-dashboard.md">what it shows</a></em>
</p>

## In use

Verification has four levels you pick by price: gates only (≈$0.2), Basic (≈$0.25-0.5), Standard
(≈$1.4-4.3) and Maximum (≈$2.7-7.6). A task, with autonomous git:

```
you:  /keel:start-task reset() falls over on an unknown token
keel: Goal: reset() throws on an unknown token; it should return "invalid link".
      Done when: a test with an unknown token passes. Not doing: token expiry.
      Plan: reset.js returns "invalid link", a test in reset.test.js.
      New task fix-reset-token "Reset with an unknown token": start, in a new branch
      fix-reset-token from main (recommended)? Or stay on main, your own git steps, another name.
you:  yes
      … keel creates the branch and the task folder, codes, runs the tests …
you:  /keel:end-task finish, level basic
keel: Basic: 2 should-fix items, explained in full, and 1 nice-to-fix. Fix, skip or not a problem?
you:  fix 1 and 2, skip 3
      … keel fixes them, runs the tests, a verifier re-checks each fix …
Claude Code: keel: task fix-reset-token is done? Its folder .keel/tasks/fix-reset-token/
             goes to keel's trash. → you: yes
keel: Verification: should fix: found 2, fixed 2, left 0; nice to fix: 1 left. Tests 212 pass.
      Git: committed on fix-reset-token, pushed; merge it when ready.
      Costs: a table, one row each for the main conversation, the reviewer and every
      verifier; $2.30 in this example for the whole task (coding and verification),
      about 0.1 % of the weekly limit.
```

Long work is the same two commands a day: `/keel:start-session` picks up from the note, and
`/keel:end-session we continue tomorrow, prepare` writes the note for the next day.

## How it works in a minute

keel has three lanes of work, and they never mix in one conversation. (A *conversation* is one Claude
Code chat; *sessions* is the name of keel's long-work lane, which runs across many conversations.)

| | Tasks | Sessions | Planning |
|---|---|---|---|
| For | point changes: a bug, a ticket, a small feature; many at once | one big job from a plan, day after day | a feature thought through before any code: decisions and short tickets |
| Like | a stack of cards | a book with a bookmark | a blueprint before the build |
| Start | `/keel:start-task <link, key or your words>` | `/keel:start-session [plan, link, description or feature]` | `/keel:start-planning [idea, link, file or feature]` |
| End | `/keel:end-task [instruction]` | `/keel:end-session [instruction]` | `/keel:end-planning [instruction]` |
| Lives in | `.keel/tasks/<id>/`, on the task's branch | `.keel/next-session.md` | a draft in `.keel/local/plans/keel/<feature>/` or in the repository; the result is a feature folder of tickets |

**Choose:** "done" within 1-3 sittings → a task; a plan for weeks with items for "later" → a session;
a feature that needs several tasks → plan it first, then build its tickets as tasks or in a session.

**Every end of a task or session:** verification at the level you pick → the fixes you choose → git →
one report: done, verification, git, what next, costs. Planning writes no code: it ends with reviews
of its tickets and a short report of its own.

The whole system on one page: [How keel works](docs/overview.md).

## Install

You need [Claude Code](https://code.claude.com/docs) 2.1.296 or newer, [Node.js](https://nodejs.org) 22+ and git on
Windows, macOS or Linux ([requirements](docs/install.md#requirements)).

Once per machine. In Claude Code:

```
/plugin marketplace add mvbsoft/keel
/plugin install keel@keel
```

If the keel commands do not appear, run `/reload-plugins` or restart Claude Code. keel acts only in
projects you set up with `/keel:configure`. Terminal install, scopes, updates and uninstall:
[Install](docs/install.md).

## Quick start

1. **Set up the project:** `/keel:configure`, quick (about six questions) or detailed. keel scans the
   project, proposes the test and lint commands, git mode and code rules; it can also set up
   machine-wide Claude Code settings, a status line and a private usage page, each only after your
   yes. Commit the setup on main with the commands keel gives, or let the first task take it into its
   branch.
2. **Start a task** in a fresh conversation (`/clear`): `/keel:start-task reset() falls over on an
   unknown token` (your own words, a key such as `CAN-123`, or a link). keel retells it, asks what is
   unclear, plans, and codes after your yes.
3. **End it:** `/keel:end-task`. Finish (verification, fixes, git, report) or hand it off for later.

The full walkthrough: [Getting started](docs/getting-started.md).

## Commands

| Command | What it does | Example |
|---|---|---|
| `/keel:configure [section \| machine]` | set up or change keel for this project or this machine | `/keel:configure git` |
| `/keel:start-task <link, key or words>` | start a task, continue one or take the next planned ticket: retell, plan, code | `/keel:start-task password reset returns 500` |
| `/keel:end-task [instruction]` | finish the task (verification, git) or hand it off; no instruction: a menu | `/keel:end-task finish and merge into main` |
| `/keel:tasks [id \| drop id]` | list the unfinished tasks and the planned tickets, show one, or drop one with what it left | `/keel:tasks drop fix-reset-500` |
| `/keel:start-session [instruction]` | continue the long line of work from its note, or start one | `/keel:start-session only write the tests today` |
| `/keel:end-session [instruction]` | verify the session, write the note for next time, git | `/keel:end-session we continue tomorrow, prepare` |
| `/keel:start-planning [idea, link, file or feature]` | plan a feature in its own conversation: one question at a time, decisions and short tickets, no code | `/keel:start-planning CSV export of invoices` |
| `/keel:end-planning [instruction]` | hand the plan over for later, or review it and export the tickets into the feature folder | `/keel:end-planning final review and export` |
| `/keel:cleanup [restore \| empty-trash]` | move leftovers to keel's trash, put them back, or empty old trash | `/keel:cleanup` |
| `/keel:help` | a short table of the commands | `/keel:help` |

Every variant: [Commands](docs/commands.md).

## Where to read next

| I want to… | Read |
|---|---|
| see the whole system on one page | [How keel works](docs/overview.md) |
| install, update or remove keel, or fix a problem | [Install](docs/install.md) |
| set up a project and run a first task | [Getting started](docs/getting-started.md) |
| know what to type in each situation | [Ways of working](docs/workflows.md) |
| know what keel does in each situation and what guarantees it | [How keel behaves](docs/behavior.md) |
| look up a command and its variants | [Commands](docs/commands.md) |
| pick a verification level | [Verification](docs/verification.md) |
| spend less | [Cost optimization](docs/cost-optimization.md) |
| understand the cost report and the dashboard | [Usage dashboard](docs/usage-dashboard.md) |
| change a setting | [Settings](docs/settings.md) |
| know what runs by itself, what keel stores and how it keeps things safe | [Under the hood](docs/under-the-hood.md) |
| contribute (`npm test` runs the suite) or report a security issue | [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) |
| see what changed between versions | [CHANGELOG.md](CHANGELOG.md) |

All pages: [docs](docs/README.md).

## License

[MIT](LICENSE)
