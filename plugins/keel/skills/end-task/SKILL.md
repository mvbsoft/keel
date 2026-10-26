---
name: end-task
description: End this session's task as you say - finish it (verify, git, its folder to keel's trash) or hand it off for another session; no instruction shows a menu.
disable-model-invocation: true
argument-hint: "[what to do, e.g. finish and merge into main | hand off | gates only]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: end-task

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. **Lane.** This conversation ran `/keel:start-session` and the note is not `done` → say "This
   conversation leads a long-work line: end it with /keel:end-session." and stop.
   Run `node "<keel>/scripts/notes.js" "<project>" check --session <sid>`. The task is the
   `active task:`. `none` → run `node "<keel>/scripts/notes.js" "<project>" tasks --session <sid>` and take
   the task whose files are on the current branch, else ask which one. The task is only on another
   branch (`Files: ... (on branch ...)`) → switch to it first: `node "<keel>/scripts/git-flow.js" "<project>" status`,
   uncommitted changes → ask what to do with them; then its branch (the task's `branch`, without a
   remote prefix: `origin/x` → `x`): autonomous `git-flow.js switch --name <branch>`, manual: give
   `git switch <branch>` and wait; then `node "<keel>/scripts/notes.js" "<project>" task activate <id> --session <sid>`.
   No task at all → offer: create one from what this conversation did
   (`node "<keel>/scripts/notes.js" "<project>" task new <id> --title "<title>" --source text --session <sid>`,
   then fill its Goal and Acceptance criteria), or verify without a task file (a hand off needs the
   file; without one, skip the step 7 deletion). Read the task's `task.md` and
   the folder's `plan.md` if any.
3. **What to do.** No instruction → ask (AskUserQuestion when it exists): 1) finish fully: verify,
   git, the task folder to keel's trash; 2) hand off: gates only, update the task file, git; continue
   in another session; 3) your own instruction. A clear instruction does not ask WHAT to do (it still
   asks the level when none is given, and Claude Code still confirms the folder in step 7): finishing words → **finish**; handing
   off in any words ("handoff", "park it for later", "prepare for a new session") → **hand off**; a
   level word (gates, basic, standard, maximum, none (no verification); quick means basic), standing alone or
   after "level", is the verification level;
   actions ("create branch bug/FIX-123, push, merge into main") run in step 8, after
   verification. Ambiguous (e.g. only "push": finish or hand off?) → ask, never guess.
4. Verification. **Finish**: read `<keel>/skills/_shared/verify.md` and follow it, with the task's goal
   and acceptance criteria and the level from the instruction; without one (a menu choice is not a
   level) the user chooses it (verify.md step 3): ask it as your next message and end your turn.
   The task is verified as a whole: when it has its own branch (`branch:` differs from `base:` and we
   are on it), step 1 uses `--base <the task's base branch>`, so commits of earlier sessions are
   covered; a task whose `branch:` equals its `base:` (a planned ticket on its feature branch) and
   that has `started:` (not a task step 2 created just now: that one uses `session start:` below) →
   `--base <started>`: say in one line that teammates' commits pulled into
   that branch since are covered too; only without a task branch (manual git on the main branch) and
   when `session start:` shows commits since, `--base <that commit>`.
   **Hand off**: gates only, no agents: read only the
   sections "1. Overview of the change", "2. Gates" and "12. Result" of verify.md, unless the
   instruction names a level. Red gates are never fixed in a hand off (section 2 step 4 is skipped,
   also for failures this change caused): the work is unfinished by definition.
   A handoff never stops on red gates: write
   `gates failing: <which>` under the task's "Open questions" and go on (the git step's rule for red
   verification with an instruction to push or merge still applies).
5. **Finish**: do not ask "fully done?" in the chat: Claude Code itself asks it when step 7 runs
   `task delete` (keel's hook makes it confirm, also when allow rules would let it run).
6. **Hand off**: update the task file as the section "The handoff format" of
   `<keel>/skills/_shared/handoff.md` says (read only that section; its language rule too): front matter
   `status: handed-off`, `updated` (today), `after_commit` (`git rev-parse --short HEAD` now; the file's
   own commit follows), `branch`. Then `notes.js check`; the task `over the limit` → compress as that
   section says. Before the git step, so the file is in the commit.
7. Costs: read `<keel>/skills/_shared/usage-sync.md` and follow its steps 1-4 with session id
   `${CLAUDE_SESSION_ID}` and the level and findings from step 4 (it reads the task title, so it runs
   before the deletion); its step 5 runs in step 11, right before the report.
   **Finish**: say in one line "Claude Code will now ask you to confirm: the task is done and its
   folder `<folder>` goes to keel's trash." Then run
   `node "<keel>/scripts/notes.js" "<project>" task delete <id> --session <sid>` (before git, so the
   deletion is in the final commit and the folder never reaches the main branch). It runs only after
   the verification is recorded (verify.md step 12; no verification chosen: `save --tier none`).
   - A line starting `notes:`, or a denial from keel's hook, is a refusal: tell the user its reason
     and do what it says; never work around it.
   - The user declines (a non-interactive run denies it): that is the user's "no". Never run it again
     or another way. The task stays as it is (active, on its branch): skip steps 8 and 9; the report
     says the work is verified and the task stays active (go on, or run /keel:end-task again).
   - Right after `task delete`, only when the verification passed (gates green, no must item left;
     no verification is not a pass): `node "<keel>/scripts/plans.js" "<project>" done <id>` marks a
     planned ticket done in the same commit as its code. `done: <KEY> (<path>)` or
     `done: <KEY> (already)` → go on; then `done: feature <f> complete (<n> tickets)` → git.md "End of
     feature" after the push. `done: none (no ticket <KEY> here)` → `plans.js tickets <id>`:
     `tickets: none ...` → not a ticket, go on; else warn that the ticket's file is not in this working
     tree, so its status is not written, put the task back
     (`node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>`) and stop before git
     (ask what to do). `plans: done refused (invalid key ...)` → the id is no key, not a ticket: go
     on. Any other `plans: done refused (...)` (e.g. two files with the key) → warn with its reason,
     put the task back the same way and stop before git. Red verification or a hand off → no
     `plans.js done` call.
8. Git: read `<keel>/skills/_shared/git.md` and follow it: **finish** or **handoff**, with the actions
   from the instruction. On a hand off, after any `start` of git.md (a branch the instruction names
   or one git.md makes) → set the task file's `branch:` to the `branch:` that `start` printed, before
   the commit.
   **Finish after the deletion**: add `--finish <id> --session <sid>` to every `start`, `commit`,
   `sync` and `push`. A step that stops puts the task back by itself (`restored:` lines): the report
   says what stopped and that the task is back and active (fix it, then /keel:end-task again). A
   declined or protected merge does not count: the work is committed and pushed. The folder never
   stays in the trash without a commit: keel's Stop hook keeps the turn going and names the step.
   Manual: keel runs no git, so the report gives the commit command that includes the deletion; when
   the user says they did not commit (or will not), run
   `node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>`.
   Any `restored:` line, or that manual `task restore`, after step 7 marked a ticket done → also
   `node "<keel>/scripts/plans.js" "<project>" done <id> --undo` (the ticket is `todo` again).
   The user commits by hand (manual git, or declines keel's commit) after step 7 marked a ticket
   done → one line: "The ticket file <path> is marked done: commit it with the code."
9. Hand off: `node "<keel>/scripts/notes.js" "<project>" task deactivate --session <sid>`.
10. Run `node "<keel>/scripts/cleanup.js" "<project>" reminder`; its line goes into the report only
    when it names `/keel:cleanup`.
11. Report: run usage-sync.md step 5 (the cost report), then read
    `<keel>/skills/_shared/final-report.md` and follow it.
