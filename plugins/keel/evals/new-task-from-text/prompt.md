---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task]
---

/keel:start-task Add a CSV export of orders for the accountant: a toCsv(orders) function in src/report.js with the columns id, date, total.
