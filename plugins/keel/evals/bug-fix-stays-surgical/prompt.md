---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash]
tags: [standards]
---

reset() in src/auth.js crashes with a TypeError when the token is unknown. Fix it.
