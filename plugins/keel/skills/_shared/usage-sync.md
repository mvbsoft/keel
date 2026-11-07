# keel usage: sync and cost report

Used by `/keel:end-task`, `/keel:end-session` and `/keel:end-planning`. Costs about $0.01–0.04:
the data goes through files, never through the conversation. `<session>` is this session's id (the
calling command gives it). Run each command exactly as written (preflight.md).

Which page tools a session gets is Anthropic's choice, per session (a restart does not change it):
the `claude-artifacts` tools (the page's files), the built-in `ArtifactData` tool (the page's
database), or none (an API key, `claude -p`). keel syncs with whichever set is there; the page shows
the same numbers either way.

1. **Limits snapshot, desktop app only.** When a tool named `mcp__ccd_session_mgmt__get_usage`
   exists (load it with ToolSearch if it is deferred), call it once and run
   `node "<keel>/scripts/usage.js" snapshot --src desktop --session <session> --five-hour <5-hour percentUsed> --seven-day <weekly all-models percentUsed> --five-hour-resets <its resetsAt> --seven-day-resets <its resetsAt>`.
   Its status `not_applicable` or `unavailable`, or no such tool → skip the snapshot.
   In the same step find the page tools: one ToolSearch `+claude-artifacts publish_files`. Found →
   `<tools>` is `files`. Not found → `ArtifactData` among the tools (deferred counts) → `db`; else
   `none`.
2. Run `node "<keel>/scripts/usage.js" prepare --tools <tools> --project "<project>" --session <session> --lang <the conversation language code>`
   (a page without a language yet takes it) plus, after a verification, `--level <level> --findings <must>/<should>/<nice> --gates <pass|fail|none>`;
   plus, from `/keel:end-planning`, `--feature <feature>`. Keep these flags for every `prepare` of
   this sync. It prints JSON with `action`:
   - `skip` → nothing to send now (`reason`: no page yet, sync off, no page tools, an API key, the
     machine name): go to step 5; the report says what to do, once.
   - `write` (`db`) → step 3.
   - `index` (`files`) → step 4.
3. **Sync through the database** (`db`):
   - for each batch, in order (n = 1, 2, ...): one `ArtifactData` call, `action: "batch"`, `url` =
     `artifact_url`, `writes` = that batch's `writes` exactly as printed (with `file_path`; never read
     or paste the files); when it succeeded, at once run
     `node "<keel>/scripts/usage.js" ack --batch <n>` (the last ack closes the sync);
   - a batch refused because a document changed → `ArtifactData get` that document, then run
     the same `prepare` again, plus `--version <collection>/<doc_id>=<its version>` and write again
     (once; batches already acked are not sent again; if it fails again, run
     `node "<keel>/scripts/usage.js" ack --batch <n> --failed <doc_id>` and say the sync is incomplete);
     refused because the document does not exist (it was deleted, for example by `/keel:usage-clear`) → the same,
     with `--version <collection>/<doc_id>=0` (it is created anew).
   - Then read the other machines' data and the page settings: three `ArtifactData` calls with
     `action: "query"`, `url` = `artifact_url`, `out_dir` = `<project>/.keel/local/usage/in` (never without `out_dir`):
     collection `days` with `query: { where: [["date", ">=", "<today minus 35 days, YYYY-MM-DD>"]], limit: 1000 }` (35 days: the calibration looks back that far),
     collection `machines` with `query: { limit: 100 }`, and collection `meta` with `query: { limit: 10 }`
     (it says which keel page the page runs; `report` keeps this machine's copy in step). Go to step 5.
4. **Sync through the page files** (`files`). Every file the tools save goes to
   `<project>/.keel/local/usage/in` (keel reads page files only from there; a tool that saved one
   elsewhere → stop the sync and say where it went). Never read or paste the files.
   1. In one message: `get_artifact` of `artifact_url` (its version, and whether the page is shared)
      and `read_file` with `paths` `["data/index.json"]`. Run the same `prepare` again plus
      `--page <the saved data/index.json> --page-version <the version>` (`--page none` when the page
      has no `data/index.json` yet), plus `--shared` when the page is shared.
   2. `action: read` → `read_file` with the printed `paths`, then the same `prepare` as in 4.1 plus
      `--take <saved file>` for each saved file (any names: keel knows them by content), or
      `--take none` when none could be saved. Read once per sync: never repeat this step.
   3. `action: publish` → one `publish_files` call: `artifact_url`; `base_version` as printed; each
      entry of `files` published at its `path` from its local `file`; `remove` as printed; and
      `shared_live: true` when printed. Refused because the page has a newer version → once more
      from 4.1; refused again → say in one line that this sync did not go through and the next
      `/keel:end-*` sends it. Published → remember the page's new version for step 5.
   4. `action: skip` with `reason` `name_ask` → the page has a PC with this machine's name and this
      machine has no install id yet (a reinstall, or another PC with the same name). Ask, AskUserQuestion
      when you have it: "The page already has a PC named <pc>. Is it this PC before a reinstall?" with
      "Yes, this PC" and "No, another PC". Yes → the same `prepare` as in 4.1 plus `--same-pc`, and go on
      from there. No → say to give this PC another name in `/keel:configure usage`; go to step 5. Without
      AskUserQuestion ask it in your message and go to step 5 (the next `/keel:end-*` asks again).
      Any other `skip` → go to step 5.
5. **Not now: last, right before you write the final report** (after git and every other step, so
   the long output of those steps does not bury it), run
   `node "<keel>/scripts/usage.js" report --project "<project>" --session <session> --lang <the conversation language code>`
   plus `--in "<project>/.keel/local/usage/in"` after step 3, or `--page <the saved data/index.json>`
   after step 4, plus `--published <the new version>` when 4.3 published. Its text goes into the
   final report as `<keel>/skills/_shared/final-report.md` block Costs says. Do not add numbers of
   your own.
