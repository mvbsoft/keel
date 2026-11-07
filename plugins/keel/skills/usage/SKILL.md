---
name: usage
description: Give the link to your private keel usage page (what each session, agent and model cost, from every machine) and open it; `on` or `off` turns this machine's sync to the page on or off.
argument-hint: "[on|off]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *)
---

# keel: usage

Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- The user's instruction: `$ARGUMENTS`

This machine's usage settings:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" "${CLAUDE_PROJECT_DIR}" show`

`wallet of this session: api` (an API key, no claude.ai): the page lives in the claude.ai account, so
this session cannot reach it. Say that, that the costs are still collected on this machine and every
`/keel:end-*` report shows them in exact dollars, and that signing in to Claude Code with claude.ai
makes the page reachable. Stop (`off` still works: it only changes this machine's setting).

**No instruction**: use only the `artifact_url`, `sync` and `page template` lines above; run nothing else and read nothing.
- A URL → give it as a link on its own line, then one line: the page shows what every session cost,
  by participant, model and request, from every machine, and keel adds to it at each
  `/keel:end-task`, `/keel:end-session` and `/keel:end-planning`. `sync: off since <date>` → one line:
  this machine's costs have not gone to the page since that date (they are still collected here), and
  `/keel:usage on` sends them all. `page template` says `offer: update` → one line: the page runs
  another keel's page, usually an older one; the next sync (with the page-file tools, which never put
  an older page over a newer one) or `/keel:configure usage` updates it and keeps its data; update keel
  on every machine first. Then open it: the `Artifact` tool (`action: open`, that `url`) when you have
  it; otherwise say to open the link in a browser.
- `not set` → say this machine has no usage page yet and `/keel:usage on` sets it up (it also finds a
  page made on another machine of the same account).

**`off`**: first explain in plain words: from now on this machine sends nothing to the page; the page
and its data stay as they are; keel still collects this machine's costs locally, so nothing is lost;
`/keel:usage on` (or `/keel:configure`) sends everything collected meanwhile; deleting this PC's data on the page
is `/keel:usage-clear`. Ask "Turn the sync off?" (Yes / No). Yes → run
`node "<keel>/scripts/usage-setup.js" "<project>" sync off` and give its line.

**`on`**: run `node "<keel>/scripts/usage-setup.js" "<project>" sync on`. No `artifact_url` above →
read `<keel>/skills/_shared/usage-page.md` and follow it (find the account's page or offer to create
it). Then say the next `/keel:end-*` sends everything collected on this machine.
