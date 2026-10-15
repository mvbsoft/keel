---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task]
---

/keel:start-task reset() in src/auth.js throws a TypeError when the token is unknown. It should throw new Error('invalid token') instead. Add a test for it.
