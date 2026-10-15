---
name: start-session
description: Continue long work from the note in .keel/next-session.md, or start a line of work from a plan file, a link or a description. Single tasks: /keel:start-task. Finish with /keel:end-session.
disable-model-invocation: true
argument-hint: "[plan file | link | description | how to continue, e.g. only write the tests]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: start-session

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS` (empty: continue from the note, or find
  work; a plan file, a link or a description starts a new line; anything else says how to continue)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. Run `node "<keel>/scripts/notes.js" "<project>" check --begin --session <sid>`.
3. Read `<keel>/skills/_shared/handoff.md`, section "Resume", and act on the case that fits.
