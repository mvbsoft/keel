---
model: sonnet
runs: 3
max_turns: 50
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [end-task, verification]
---

/keel:end-task finish, level none
