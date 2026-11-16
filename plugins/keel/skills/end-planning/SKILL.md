---
name: end-planning
description: End this conversation's planning as you say - hand over to continue later (review changed tickets), or the final review that marks the plan and its tickets ready; commit and push only with your yes.
disable-model-invocation: true
argument-hint: "[what to do, e.g. we continue tomorrow | final review]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: end-planning

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`; a keel script's `project: <folder>` line (this session works in a worktree of it) replaces it from then on
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. The state above is exactly the two lines `keel-config: ok` and `profile: ok`, with no other line
   → go on without reading preflight.md. Any other line (such as `git: refused`), or no state above → read `<keel>/skills/_shared/preflight.md` and
   act on it. These rules hold for this whole command. Run every keel script (`node` with a file in
   keel's `scripts` folder) as its own plain command with full paths, never joined with `;`, `&&`,
   pipes or redirections. In Bash write a path that starts with `\\` as `//server/share/...`. Read
   keel's own files with Read, Grep and Glob, not the shell. Before each action say in one short
   line what it will do. An instruction you cannot read one way only: ask, never guess. Steps that
   need nothing from each other's output may go in one message as separate calls, where the command
   says so. A keel script refused by a project hook: follow preflight.md's rule for it.
2. Run `node "<keel>/scripts/plans.js" "<project>" mark get --session <sid>`. `planning: none` → say
   "This conversation plans nothing: /keel:start-planning starts or continues a feature." and stop.
   Otherwise `<f>` is the feature. Read `<keel>/skills/_shared/planning.md`, section "Rules"; the
   other sections when a step names them.
3. Run `plans.js check <f>` first.
4. **Mode**, from the instruction: handing over in any words ("we continue tomorrow", "save for
   later") → **A**; final words ("final", "done", "the tickets are ready") → **B**. No instruction →
   by the state: open questions (the `open Q` of `plans.js list`) or `check` problems → **A**, say why
   in one line; else ask "Final review and ready, or hand over?". Ambiguous → ask, never guess.
   **A plan already `ready` or `in-progress`** (edited after ready: planning.md "After ready") →
   neither mode: no plan gates. `plans.js check <f>` (step 3) → `check: clean`, or fix its problems
   with the user (each write on a yes); then `plans.js review <f>`: what needs review gets its review
   on a yes ("After ready" item 1), a new ticket reviewed → `plans.js status <f> <T> ready`; then
   B.5; then step 7.
5. **A. Hand over.**
   1. Reviews of the changed tickets only: planning.md "Reviews", steps 1-3, 5 and 6 (no plan
      review). Nothing changed → no review.
   2. Each finding: fix now or record it as a Q.
   3. Update `plan.md`: Open questions; Next action (where planning stands and the next step, so the
      next conversation starts from it); then `plans.js set <f> --after-commit` (`after_commit:`, and
      `after_commit_repos:` for the other repositories its tickets name).
   4. A feature in the repository → planning.md "Commit and push".
6. **B. Final.** A plan already `ready` in `plans.js list` (no `(needs review)`) was reviewed as it is:
   go straight to B.5.
   1. **Gates**: `open Q 0`, `check: clean`, and every finding in `reviews/` has a decision (none is
      `undecided`). Else
      show what blocks and offer mode A (yes → A; no → go to step 7).
   2. Reviews: planning.md "Reviews", all steps: the ticket reviews, then one plan review.
   3. Fixed tickets: `plans.js check <f>`, then their ticket review again; at most 2 rounds per
      end-planning. Big plan fixes (a new ticket, a changed decision) → offer the plan review once
      more. A finding deferred to a Q → the gates fail: offer mode A. Fixes after the last round →
      the user chooses: accept them as reviewed (`plans.js reviewed <f> <tickets>`) or mode A.
   4. `plans.js state <f> ready` → `status: ready` and `ready: <tickets>` (the plan and every reviewed
      draft ticket; a `draft: ...` line names those still waiting for a review: review them, then
      `plans.js status <f> <T> ready`). Refused (`not ready: ...`) → show its reason and offer mode A.
   5. **Share.** A feature in the repository → planning.md "Commit and push": ask "Commit the planning
      files?" and then "Push `<branch>`?". On this machine → say "These tickets are seen on
      this machine only." and that `plans.js move <f> --to repo` puts the folder into the repository
      on request (planning.md "Commit and push").
7. **Always**, whatever happened above (also after a stop or a no):
   `plans.js mark clear --session <sid>` → `planning: none`. A question waiting for the user's answer
   ends the turn, not the command: steps 7-9 run once the answer is handled.
8. Costs: read `<keel>/skills/_shared/usage-sync.md` and start its sync agent (steps 1-3) with session id
   `${CLAUDE_SESSION_ID}` and `--feature <f>` (`<f>` of step 2; no level: planning has no
   verification); its step 4 runs in step 9.
9. Report, one message in the conversation language, short: **Done** (mode, the plan's state, tickets,
   what changed); **Reviews** (found, fixed, deferred to Q, rejected; failed reviews named; or "no
   review: nothing changed"); **Git** (commit, branch, pushed or not; or nothing); **What next** (A:
   "Continue with `/keel:start-planning <f>`: <Next action>"; B or a plan already ready: the feature
   folder, "a ticket starts with `/keel:start-task <f>/T<n>`" and "`/keel:feature-page <f>` makes a page of
   the feature in your claude.ai account" (the user types it); all: "/clear before other work keeps
   it apart and costs less"); **Costs**: run usage-sync.md step 4 last and give its text as
   `<keel>/skills/_shared/final-report.md` block 5 says (read only that block).
