---
name: configure
description: Set up or repair keel for this project - scan it, propose settings, confirm with you, then write .keel/config.json and .keel/profile.json. `check` says what to reconfigure since the last run, and why.
disable-model-invocation: true
argument-hint: "[check | section[,section...] | machine]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/config-check.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/config-check.js" *)
---

# keel: configure

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- Current conversation language (section 1 confirms or changes it): the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (`check`: only say what to reconfigure; one or more sections to change in a
  configured project, separated by commas; `machine`: only this machine's settings, for every project;
  empty: ask what to set up)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/config-check.js" "${CLAUDE_PROJECT_DIR}"`

**The first word of the arguments is `check`** → only answer from the output above; do not read the
configure flow, run nothing, write nothing. No output above (a policy can turn off the shell lines in
skills) → run `node "<keel>/scripts/config-check.js" "<project>"` once. Then, in the conversation
language and plain words, at most about 15 lines:
- `keel-config:` is not `ok`, or a `git:` line → what it says, and that `/keel:configure` sets keel up
  or repairs it; stop.
- `result: nothing to reconfigure` → say so in one line and why: nothing keel's settings depend on
  changed since that date (package versions alone do not count).
- otherwise: first the answer (which sections need it, which are only worth a look); then one line per
  `- ` reason, needed first: what changed (the fact before `|`) and why it matters (after `|`), with
  file names, commands and section names as printed; then the command to copy from `run:` and, when
  there is one, the optional `also:` one, saying that it runs only those sections, asks before it
  changes anything, and writes the files once at the end.
- a `not checked` line → one line: those checks need a configure record on this machine; the first
  configure run here makes one.
- `config-check: error:` → say the check failed with that line; `/keel:configure` still works.

Otherwise read `<keel>/skills/_shared/configure-flow.md` and follow it from the start. When it is
finished, stop: `/keel:configure` has no command to continue.
