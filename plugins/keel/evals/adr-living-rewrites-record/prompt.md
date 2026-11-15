---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
tags: [adr-style, standards]
---

We are moving background jobs off Redis: they go into a jobs table in PostgreSQL itself, taken with SELECT ... FOR UPDATE SKIP LOCKED, so we can drop the Redis service. Record this decision; no code yet.
