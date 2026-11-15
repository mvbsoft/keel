---
model: sonnet
runs: 3
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, Bash, Write, Edit]
tags: [start-session, worktree]
---

/keel:start-session Before step 1 of this command, run `cd .claude/worktrees/wt` as a Bash command of its own: this session works in that git worktree from now on. Then run the command's steps and propose work as usual.
