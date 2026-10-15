# keel documentation

[Українська](README.uk.md)

keel is a plugin that plans, builds and independently verifies your work. Today it runs in Claude Code;
support for other coding agents is planned. The project overview is in the [main README](../README.md).

Where to start: read [How keel works](overview.md) for the whole picture, follow
[Getting started](getting-started.md) once, then use the other pages as reference.

## Start here

| Page | What you find there |
|---|---|
| [How keel works](overview.md) | The whole system on one page: the two lanes, starting and ending work, the report, the handoff, verification, delegation, git, what runs in the background. |
| [Install](install.md) | Requirements, installing and install scopes, where keel acts and what it changes, updating and removing keel, troubleshooting. |
| [Getting started](getting-started.md) | A walkthrough: set up a project, run a first task, hand a task off, continue long work, clean up. |

## Daily work

| Page | What you find there |
|---|---|
| [Two ways of working](workflows.md) | Tasks and sessions: when to use which, every case as "you type → keel does", the final report, the task list, the handoff format, where the files live, git. |
| [How keel behaves](behavior.md) | What keel does in each situation and what guarantees it: Claude Code's confirmations, script guards, the Stop hook, the behaviour tests; `claude -p` and bypass mode; what is not guaranteed. |
| [Verification](verification.md) | The four levels: who checks what, how a level is proposed, the report, what it costs, which to choose. |
| [Cost optimization](cost-optimization.md) | Spending less without losing quality: model choice, levels, compaction, delegation. |

## Reference

| Page | What you find there |
|---|---|
| [Commands](commands.md) | Every command, how to call it and what happens in each case. |
| [Settings](settings.md) | Every setting, its values, defaults and where it is stored, with example configurations. |
| [Usage dashboard](usage-dashboard.md) | The cost report, the "keel usage" page, plan-limit percentages, what leaves your machine. |

## Under the hood

| Page | What you find there |
|---|---|
| [Under the hood](under-the-hood.md) | What runs by itself (hooks), the 14 agents and their models, delegation, what keel keeps in your project, safety, overhead, advisory skills, languages, moving from another notes system. |
