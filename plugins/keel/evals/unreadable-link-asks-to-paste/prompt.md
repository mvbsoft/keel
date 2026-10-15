---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task]
---

/keel:start-task https://company.atlassian.net/browse/CAN-555
