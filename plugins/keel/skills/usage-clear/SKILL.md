---
name: usage-clear
description: Delete this machine's data on your keel usage page (its days, sessions, calibration; other machines' data stays), after a warning with the period and what it affects, and only on your yes.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-clear.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-clear.js" *)
---

# keel: usage-clear

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)

This machine's usage settings:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-setup.js" "${CLAUDE_PROJECT_DIR}" show`

The page is `artifact_url` above. None → say there is nothing to clear and stop. `wallet of this session:
api` → the page lives in the claude.ai account, which an API-key session cannot reach: say so (the costs
on this machine and the end reports are untouched) and stop. Run each command exactly as written;
never read the saved files, and never paste document contents into the conversation.

The clear deletes only **this machine's** data (`pc` above); other machines' data on the page stays. To
clear the whole page, the user runs `/keel:usage-clear` on every machine.

The page keeps its data in page files (`data/index.json` and one file per machine and month) and, from
older keel versions or sessions with the built-in tools, in its database. Find the tools: one ToolSearch
`+claude-artifacts publish_files` → found: the **files** tools (they clear the page files); `ArtifactData`
among the tools (deferred counts) → the **built-in** tools (they clear the database). Neither → say this
session has no page tools (Anthropic decides per session which tools it gets) and stop. Only one of the
two → clear what it can, and say in the warning that this machine's other part stays visible on the page
until a session with the other tools runs `/keel:usage-clear` (after a clear with the built-in tools, the
next sync with the files tools removes this machine's old page files by itself).

1. Run `node "<keel>/scripts/usage-clear.js" start --project "<project>"`; it prints the folder. Every
   file below is saved into it.
2. Read what is there:
   - files tools: in one message, `get_artifact` of that `url` (keep its `version` for the first publish of
     step 6) and `read_file` of that `url` with `paths` `["data/index.json"]` (none → there are no page
     files);
   - built-in tools: three `ArtifactData` calls, `action: "query"`, that `url`, `out_dir` = that folder,
     `query: { limit: 1000 }`: collections `days`, `machines`, `calib` (a result with `next_cursor` → the
     same call with that cursor).
3. Run `node "<keel>/scripts/usage-clear.js" plan --project "<project>"` plus `--page <the saved
   data/index.json>` (files tools; `--page none` when there was none) and `--in "<the folder>"` (built-in
   tools). `missing_versions` → run it again with one `--version <key>=<n>` per listed key, n from that
   document's line in the query result (days by their id, the others as `machines/<id>`, `calib/<id>`).
   `files.name` `taken` → the page's entry with this machine's name belongs to another PC (another install
   id): its page files are not this machine's and are not cleared; say so (renaming this machine in
   `/keel:configure` keeps the two apart). `files.name` `ask` → this machine has no install id yet, so keel
   cannot tell whether the entry is its own from before a reinstall: its page files are not cleared; say that
   one sync first (answering that it is the same PC) lets the clear take them.
   `files.machine` null and no `summary.documents` → this machine has nothing on the page: say so and stop.
4. **Warn and ask.** In plain words, what will be deleted, all of it this machine's: from `files.machine`,
   its months (`first_month` to `last_month`) and `last_35_days_usd` $ in its last 35 days; from
   `summary`, the day documents from `first_day` to `last_day`, `days_with_data` days, `sessions` sessions
   for `sessions_usd` $, all usage in them `all_usd` $, the calibration, `kilobytes` KB. Then what it costs
   and affects:
   - built-in tools: the deletes take `delete_calls` calls in this chat, each asked for approval, each about
     the price of one short turn (the end report shows the real cost); files tools: one publish per entry
     of `files.publishes`;
   - this machine's charts, sessions and calibration on the page start over from the next
     `/keel:end-task`, `/keel:end-session` or `/keel:end-planning`, with only what happens from the clear on;
   - other machines' data on the page stays; everyone the page is shared with sees the change;
   - it cannot be undone: keel keeps no copy of the page, and does not send this machine's data from before
     the clear again;
   - stays: this machine's Claude Code logs, limit records and calibration (so the cost report at the end
     of a task and the limit percentages keep working) and the page's own settings (its language).
   Then one question, AskUserQuestion when you have it: "Delete this PC's data on the page?" with "No, keep
   it" first and "Yes, delete it". Without AskUserQuestion ask it in your message and end your turn.
   Only an explicit yes goes on; anything else → nothing was deleted, say so and stop.
5. Right after the yes, before any delete, run `node "<keel>/scripts/usage-clear.js" done`. It deletes
   this machine's local month files and makes it send only what happens from the clear on, so a clear cut
   short after this point never sends the old data again (its next sync removes what is left of it).
6. Delete:
   - files tools: each entry of `files.publishes`, in order: one `publish_files` call to that `url` with
     the entry's `files` (each at its `path` from its local `file`) and `remove`, and `base_version` = the
     page's version (the first from `get_artifact`, each next one from the publish before it). Refused
     because the page has a newer version → `get_artifact` and `read_file` of `data/index.json` again, run
     step 3 again with the new file, and send the publishes of that plan.
   - built-in tools: each batch of the plan, in order: one `ArtifactData` call, `action: "batch"`, `url`,
     `writes` exactly as printed (Claude Code asks you to approve each). An entry refused because its
     version changed → run step 3 again (it lists every version as missing now: give each from the query
     listing), and send only the batches not written yet.
   A declined call → stop: say what is already deleted and that `/keel:usage-clear` finishes it later.
7. Report in 3-5 lines: deleted — the numbers of step 4; what stays; the next sync of this machine starts
   from the clear. Delete the page itself only if the user asks (then `/keel:usage on` makes a new one).
