# keel final report (/keel:end-task and /keel:end-session)

One message in the conversation language, plain words first, short, in this order. Leave out a block
only where this file says so.

1. **Done**: what changed, for a person who did not watch: 1-4 lines, no file lists.
2. **Verification**: the level and team in one line, then a table:

   | severity | found | fixed | left |
   |---|---|---|---|
   | must fix | 2 | 2 | 0 |

   one row per severity that had findings (must / should / nice to fix), then the left items by
   number and title. Under it the gates: what ran and the result (e.g. "tests 212 pass, lint 0").
   Only gates ran (or no verification) → no table: the gates line alone, plus "not verified" when
   nothing ran. Warnings from verify.md (missing scanners, red gates, incomplete agents) go here.
3. **Git**: commit, branch, pushed or not, merged or not, PR link; manual mode: the ready commands.
4. **What next**:
   - a task: "finished, its folder moved to keel's trash (batch <id from the `trash batch:` line of
     `task delete`>; `/keel:cleanup restore <that id>` brings it back)" plus
     "/clear before the next task keeps it apart and costs less"; or "handed off: continue any time with `/keel:start-task <id>` (`/keel:tasks` lists them)";
     or, when it is not fully done yet, "verified; go on, or run /keel:end-task again when it is done";
   - a session: "Next time: <the note's next action>" and the question "Agree, or change it?" (both in the conversation language) (an
     answer updates the note).
   The `cleanup.js reminder` line goes here as it is, only when it names `/keel:cleanup`; any other
   reminder output is left out.
5. **Costs**: the text of `usage.js report` (`<keel>/skills/_shared/usage-sync.md` step 5, run as the
   last action before this message). The user does not see tool output: paste its text into this
   message as it is: every column, row and line, as a table (not inside a code block), translated
   only when it came out in English for another conversation language (keel has no catalog for that
   language yet). Never "see above" and never leave it out. These are the only cost numbers in the
   report: no other total (no ledger `total:`, no estimate).
