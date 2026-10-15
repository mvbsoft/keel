# keel usage: sync and cost report

Used by `/keel:end-task` and `/keel:end-session`. Costs about $0.01–0.04: the data goes
through files, never through the conversation. `<session>` is this session's id (the calling command
gives it). Run each command exactly as written (preflight.md).

1. **Limits snapshot, desktop app only.** When a tool named `mcp__ccd_session_mgmt__get_usage`
   exists (load it with ToolSearch if it is deferred), call it once and run
   `node "<keel>/scripts/usage.js" snapshot --src desktop --session <session> --five-hour <5-hour percentUsed> --seven-day <weekly all-models percentUsed> --five-hour-resets <its resetsAt> --seven-day-resets <its resetsAt>`.
   Its status `not_applicable` or `unavailable`, or no such tool → skip this step.
2. Run `node "<keel>/scripts/usage.js" prepare --project "<project>" --session <session>` plus, after
   a verification, `--level <level> --findings <must>/<should>/<nice> --gates <pass|fail|none>`.
   It prints JSON: `artifact_url` and `batches`. A `note` (with `not_approved`) means the project's
   committed URL is not approved on this machine: nothing is sent; tell the user in one line (they approve
   it in `/keel:configure`, usage section) and go on without syncing.
3. **Sync** (skip to step 5 when `artifact_url` is null or the ArtifactData tool does not exist, for
   example an API-key session: the next session with the tool syncs the backlog):
   - for each batch, in order (n = 1, 2, ...): one `ArtifactData` call, `action: "batch"`, `url` =
     `artifact_url`, `writes` = that batch's `writes` exactly as printed (with `file_path`; never read
     or paste the files); when it succeeded, at once run
     `node "<keel>/scripts/usage.js" ack --batch <n>` (the last ack closes the sync);
   - a batch refused because a document changed → `ArtifactData get` that document, then run
     `prepare` again with `--version <collection>/<doc_id>=<its version>` and write again (once; batches
     already acked are not sent again; if it fails again, run
     `node "<keel>/scripts/usage.js" ack --batch <n> --failed <doc_id>` and say the sync is incomplete).
4. **Read the other machines' data**: two `ArtifactData` calls with `action: "query"`,
   `url` = `artifact_url`, `out_dir` = `<project>/.keel/local/usage/in` (never without `out_dir`):
   collection `days` with `query: { where: [["date", ">=", "<today minus 35 days, YYYY-MM-DD>"]], limit: 1000 }` (35 days: the calibration looks back that far),
   and collection `machines` with `query: { limit: 100 }`.
5. **Not now: last, right before you write the final report** (after git and every other step, so
   the long output of those steps does not bury it), run
   `node "<keel>/scripts/usage.js" report --project "<project>" --session <session> --in "<project>/.keel/local/usage/in" --lang <the conversation language code>`
   (without `--in` when step 4 was skipped). Its text goes into the final report as
   `<keel>/skills/_shared/final-report.md` block Costs says. Do not add numbers of your own.
