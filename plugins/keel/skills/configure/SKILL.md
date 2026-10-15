---
name: configure
description: Set up or repair keel for this project - scan it, propose settings, confirm with you, then write .keel/config.json and .keel/profile.json.
disable-model-invocation: true
argument-hint: "[section to change | machine]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: configure

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- Current conversation language (section 1 confirms or changes it): the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (a section to change in a configured project; `machine`: only this machine's
  settings, for every project; empty: ask what to set up)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

Read `<keel>/skills/_shared/configure-flow.md` and follow it from the start. When it is finished,
stop: `/keel:configure` has no command to continue.
