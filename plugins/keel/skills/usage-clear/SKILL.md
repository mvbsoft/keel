---
name: usage-clear
description: Delete all data on your keel usage page (every machine's days, sessions, calibration), after a warning with the period and what it affects, and only on your yes.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-clear.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-clear.js" *)
---

# keel: usage-clear

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)

This machine's usage settings:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" "${CLAUDE_PROJECT_DIR}" show`

The page is `artifact_url` above (with `not set`, the first approved project url). None, or no ArtifactData
tool in this session → say there is nothing to clear from here and stop. Run each command exactly as
written; never read the saved files, and never paste document contents into the conversation.

1. Run `node "<keel>/scripts/usage-clear.js" start --project "<project>"`; it prints the query folder.
2. Three `ArtifactData` calls, `action: "query"`, that `url`, `out_dir` = that folder, `query: { limit: 1000 }`:
   collections `days`, `machines`, `calib` (a result with `next_cursor` → the same call with that cursor).
3. Run `node "<keel>/scripts/usage-clear.js" plan --in "<the folder>"`. `missing_versions` → run it again
   with one `--version <key>=<n>` per listed key, n from that document's line in the query result
   (days by their id, the others as `machines/<id>`, `calib/<id>`).
4. **Warn and ask.** From `summary`, in plain words: what will be deleted (the day documents from
   `first_day` to `last_day`, `days_with_data` days; `sessions` sessions for `sessions_usd` $; all usage in
   them `all_usd` $; the machines; the calibration; `kilobytes` KB), and what it affects:
   - the page is empty until the next `/keel:end-task`, `/keel:end-session` or
     `/keel:end-planning`; its charts, sessions and calibration start over from then;
   - it is deleted for every machine listed and for everyone the page is shared with; those machines
     keep sending only new days;
   - it cannot be undone: keel keeps no copy of the page, and does not send data from before the clear again;
   - stays: this machine's local logs, limit records and calibration (so the cost report at the end of a
     task and the limit percentages keep working) and the page's own settings (its language).
   Then one question, AskUserQuestion when you have it: "Delete all data on the page?" with "No, keep
   it" first and "Yes, delete everything". Without AskUserQuestion ask it in your message and end your
   turn. Only an explicit yes goes on; anything else → nothing was deleted, say so and stop.
5. Each batch of the plan, in order: one `ArtifactData` call, `action: "batch"`, `url`, `writes` exactly
   as printed (Claude Code asks you to approve each). A declined call → stop: say what is already
   deleted and that `/keel:usage-clear` finishes it later. An entry refused because its version changed
   → run step 3 again with `--version` for it, and send only the batches not written yet.
6. After every batch is written, run `node "<keel>/scripts/usage-clear.js" done`.
7. Report in 3-5 lines: deleted — the numbers of step 4 (documents, period, sessions and dollars,
   machines); what stays; the next sync starts from now. Delete the page itself only if the user asks
   (Artifact `delete`; then `/keel:configure usage` makes a new one).
