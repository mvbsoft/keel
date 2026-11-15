---
model: sonnet
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash]
tags: [standards, adr-style, review]
---

Review the uncommitted change with the keel:docs agent (topic: docs; keel's folder, with its protocols, is .keel/local/tmp/keel in this project) and show me its findings.
