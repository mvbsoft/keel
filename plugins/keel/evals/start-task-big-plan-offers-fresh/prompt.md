---
model: sonnet
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task]
---

/keel:start-task the monthly CSV report we settled above. It is a new task, csv-report, in a new branch from main; nothing is left to ask, so go straight to the plan.
