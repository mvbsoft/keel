---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task, planning]
---

/keel:start-task CSV and PDF export of invoices, a nightly scheduler that e-mails them to each customer, delivery logs and an admin page to resend. This is too big for one task: let us plan it as a feature instead.
