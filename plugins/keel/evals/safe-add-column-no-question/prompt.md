---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write, Edit]
tags: [standards, risky-change]
---

Add a nullable last_login_at timestamptz column to users.
