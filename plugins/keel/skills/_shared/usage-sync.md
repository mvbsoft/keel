# keel usage: sync and cost report

Used by `/keel:end-task`, `/keel:end-session` and `/keel:end-planning`. Costs about $0.01–0.04:
the data goes through files, never through the conversation. `<session>` is this session's id (the
calling command gives it). Run each command exactly as written (preflight.md).

keel syncs through the page's database with the `ArtifactData` tool. A session without it (an API
key, `claude -p`) cannot sync: the next session with it sends the backlog.

1. **Limits snapshot, desktop app only.** When a tool named `mcp__ccd_session_mgmt__get_usage`
   exists (load it with ToolSearch if it is deferred), call it once and run
   `node "<keel>/scripts/usage.js" snapshot --src desktop --session <session> --five-hour <5-hour percentUsed> --seven-day <weekly all-models percentUsed> --five-hour-resets <its resetsAt> --seven-day-resets <its resetsAt>`.
   Its status `not_applicable` or `unavailable`, or no such tool → skip the snapshot.
   In the same step find the page tool: `ArtifactData` among the tools (deferred counts) → `<tools>`
   is `db`, otherwise `none`.
2. Run `node "<keel>/scripts/usage.js" prepare --tools <tools> --project "<project>" --session <session>`
   plus, after a verification, `--level <level> --findings <must>/<should>/<nice> --gates <pass|fail|none>`;
   plus, from `/keel:end-planning`, `--feature <feature>`. Keep these flags for every `prepare` of
   this sync. It prints JSON with `action`:
   - `skip` → nothing to send now (`reason`: no page yet, sync off, no page tool, an API key): go to
     step 4; the report says what to do, once.
   - `write` → step 3.
3. **Sync through the database**:
   - for each batch, in order (n = 1, 2, ...): one `ArtifactData` call, `action: "batch"`, `url` =
     `artifact_url`, `writes` = that batch's `writes` exactly as printed (with `file_path`; never read
     or paste the files); when it succeeded, at once run
     `node "<keel>/scripts/usage.js" ack --batch <n>` (the last ack closes the sync);
   - a batch refused because a document changed → `ArtifactData get` that document, then run
     the same `prepare` again, plus `--version <collection>/<doc_id>=<its version>` and write again
     (once; batches already acked are not sent again; if it fails again, run
     `node "<keel>/scripts/usage.js" ack --batch <n> --failed <doc_id>` and say the sync is incomplete);
     refused because the document does not exist (it was deleted, for example by `/keel:usage clear`) → the same,
     with `--version <collection>/<doc_id>=0` (it is created anew).
   - Then read the other machines' data and the page settings: three `ArtifactData` calls with
     `action: "query"`, `url` = `artifact_url`, `out_dir` = `<project>/.keel/local/usage/in` (never without `out_dir`):
     collection `days` with `query: { where: [["date", ">=", "<today minus 35 days, YYYY-MM-DD>"]], limit: 1000 }` (35 days: the calibration looks back that far),
     collection `machines` with `query: { limit: 100 }`, and collection `meta` with `query: { limit: 10 }`
     (it says which keel page the page runs; `report` keeps this machine's copy in step). Go to step 4.
4. **Not now: last, right before you write the final report** (after git and every other step, so
   the long output of those steps does not bury it), run
   `node "<keel>/scripts/usage.js" report --project "<project>" --session <session> --lang <the conversation language code>`
   plus `--in "<project>/.keel/local/usage/in"` after step 3. Its text goes into the
   final report as `<keel>/skills/_shared/final-report.md` block Costs says. Do not add numbers of
   your own.
