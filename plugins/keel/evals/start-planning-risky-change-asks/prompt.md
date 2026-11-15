---
model: sonnet
runs: 3
max_turns: 25
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-planning, risky-change]
---

The e-mails greet people by their full name, so as part of this rename users.name to full_name.
