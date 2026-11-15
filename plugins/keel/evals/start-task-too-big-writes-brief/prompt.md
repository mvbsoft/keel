---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task, planning]
---

/keel:start-task the order notifications we talked about above. It is too big for one task: plan it as a feature, in a new chat.
