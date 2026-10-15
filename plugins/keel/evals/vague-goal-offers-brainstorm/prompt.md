---
model: sonnet
runs: 3
max_turns: 30
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-task]
---

/keel:start-task make the checkout nicer for customers. It is a new task, call it checkout-ux.
