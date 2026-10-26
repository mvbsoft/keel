---
name: end-session
description: End a long-work session as you say - verify, prepare the next session's note, then git and any action you named (push, merge). Single tasks: /keel:end-task.
disable-model-invocation: true
argument-hint: "[what to do, e.g. we continue tomorrow, prepare | push and merge into main]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: end-session

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. Run `node "<keel>/scripts/notes.js" "<project>" check --session <sid>`. `active task:` is not `none`,
   or this conversation ran `/keel:start-task` → say "This conversation works on a task: end it with
   /keel:end-task." and stop. A `lane conflict:` line → show it, ask which lane leads that key and
   stop. The line of work is the note's goal and plan, plus what this session
   worked on and this conversation. Task files are not part of this lane.
3. **What to do**, from the instruction:
   - none → verification, prepare the next session, then "Next time: ..." for the user to agree or correct;
   - prepare only ("we continue tomorrow, prepare") → gates only, then prepare;
   - an action ("push", "merge into main", "open a PR") → verification, prepare, then the action;
   - the line is finished (the user says so) → the note gets `status: done`;
   - a level word (gates, basic, standard, maximum, none (no verification); quick means basic) standing alone or
     after "level" → that level.
   Ambiguous → ask, never guess.
4. Verification: read `<keel>/skills/_shared/verify.md` and follow it (gates only: its steps 1, 2 and
   12). Prepare only: gates only, no question. Otherwise, without a level in the instruction the user
   chooses it (verify.md step 3): ask it as your next message and end your turn; never fall back to
   gates only on your own. When `session start:` shows commits since, step 1 uses `--base <that commit>`: verify this
   session's work, committed or not.
5. Prepare: read `<keel>/skills/_shared/handoff.md` and write the note (update, do not rewrite; new
   items for the future go into **Later**), memory and session log; with `git.state_in_git` before
   step 6, otherwise after it.
6. Git: read `<keel>/skills/_shared/git.md` and follow it: **finish** when the line is finished, else
   **handoff**, with the actions from the instruction (merging and red verification: as git.md says).
   Planned tickets first: a passed full verification (not gates only, not red) → for each key in the
   note's `keys:` whose Plan items are all ✅, `node "<keel>/scripts/plans.js" "<project>" done <KEY>`
   (`done: <KEY> (<path>)`; `done: none (no ticket <KEY> here)` for a key `plans.js tickets <KEY>`
   knows → warn that its status is not written). git.md's `commit` then adds `--tickets <those keys>`
   (comma-separated), so their ticket files go into the commit; `done: feature <f> complete (<n> tickets)`
   → git.md "End of feature" after the push. Gates only or red → no `plans.js done` call.
7. Costs: read `<keel>/skills/_shared/usage-sync.md` and follow its steps 1-4 with session id
   `${CLAUDE_SESSION_ID}` and the level and findings from step 4; its step 5 runs in step 9, right
   before the report.
8. Run `node "<keel>/scripts/cleanup.js" "<project>" reminder`; its line goes into the report only
   when it names `/keel:cleanup`.
9. Report: run usage-sync.md step 5 (the cost report), then read
   `<keel>/skills/_shared/final-report.md` and follow it. An answer to "Agree, or change
   it?" that changes the plan → update the note (in git: commit it as git.md says, manual mode: say so).
