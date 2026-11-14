# keel usage: clear this machine's data on the page

Used by `/keel:usage clear`. `<show>` is the output of
`node "<keel>/scripts/usage-setup.js" "<project>" show`.

The page is `artifact_url` in `<show>`. None → say there is nothing to clear and stop. `wallet of this
session: api` → the page lives in the claude.ai account, which an API-key session cannot reach: say so
(the costs on this machine and the end reports are untouched) and stop. No `ArtifactData` tool among the
tools (deferred counts) → say this session has no page tools (Anthropic decides per session which tools
it gets) and stop. Run each command exactly as written; never read the saved files, and never paste
document contents into the conversation.

The clear deletes only **this machine's** data (`pc` in `<show>`); other machines' data on the page
stays. To clear the whole page, the user runs `/keel:usage clear` on every machine.

1. Run `node "<keel>/scripts/usage-clear.js" start --project "<project>"`; it prints the folder. Every
   file below is saved into it.
2. Three `ArtifactData` calls, `action: "query"`, that `url`, `out_dir` = that folder,
   `query: { limit: 1000 }`: collections `days`, `machines`, `calib` (a result with `next_cursor` → the
   same call with that cursor).
3. Run `node "<keel>/scripts/usage-clear.js" plan --in "<the folder>"`.
   `missing_versions` → run it again with one `--version <key>=<n>` per listed key, n from that
   document's line in the query result (days by their id, the others as `machines/<id>`, `calib/<id>`).
   No `summary.documents` → this machine has nothing on the page: say so and stop.
4. **Warn and ask.** In plain words, what will be deleted, all of it this machine's: from `summary`, the
   day documents from `first_day` to `last_day`, `days_with_data` days, `sessions` sessions for
   `sessions_usd` $, all usage in them `all_usd` $, the calibration, `kilobytes` KB. Then what it costs
   and affects:
   - the deletes take `delete_calls` calls in this chat, each asked for approval, each about the price of
     one short turn (the end report shows the real cost);
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
5. Right after the yes, before any delete, run `node "<keel>/scripts/usage-clear.js" done`. It makes this
   machine send only what happens from the clear on, so a clear cut short after this point never sends
   the old data again.
6. Each batch of the plan, in order: one `ArtifactData` call, `action: "batch"`, `url`, `writes` exactly
   as printed (Claude Code asks you to approve each). An entry refused because its version changed → run
   step 3 again (it lists every version as missing now: give each from the query listing), and send only
   the batches not written yet. A declined call → stop: say what is already deleted and that
   `/keel:usage clear` finishes it later.
7. Report in 3-5 lines: deleted — the numbers of step 4; what stays; the next sync of this machine starts
   from the clear. Delete the page itself only if the user asks (then `/keel:usage on` makes a new one).
