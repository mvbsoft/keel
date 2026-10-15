---
name: start-task
description: Start or continue one task (ticket, bug, small feature) from a link, a key or your own words - retell, new or continuation, plan, then code. Finish or hand off with /keel:end-task.
disable-model-invocation: true
argument-hint: "<link | task key | what to do, in your words>"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: start-task

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. Read `<keel>/skills/_shared/intake.md` and follow it from step 1 with the instruction (empty: an
   unfinished task or a new one, the user chooses).
