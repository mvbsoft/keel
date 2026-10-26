---
name: usage
description: Give the link to your private keel usage page (what each session, agent and model cost, from every machine) and open it.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *)
---

# keel: usage

Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)

This machine's usage settings:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" "${CLAUDE_PROJECT_DIR}" show`

Use only the `artifact_url` line above; run nothing else and read nothing.
- A URL (or `not set` with approved project urls: the first of them) → give it as a link on its own
  line, then one line: the page shows what every session cost, by participant, model and request,
  from every machine, and keel adds to it at each `/keel:end-task`, `/keel:end-session` and
  `/keel:end-planning`. Then open it with the Artifact tool (`action: open`, that `url`) when you have
  that tool; otherwise say to open the link in a browser (in the terminal, `/artifacts` lists it too).
- `not set` and no approved urls → say this machine has no usage page yet and `/keel:configure usage`
  sets it up (it also finds a page made on another machine of the same account).
