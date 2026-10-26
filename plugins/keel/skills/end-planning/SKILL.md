---
name: end-planning
description: End this conversation's planning as you say - hand over to continue later (review changed tickets), or the final review and export of the tickets into the feature folder; git only with your yes.
disable-model-invocation: true
argument-hint: "[what to do, e.g. we continue tomorrow | final review and export]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: end-planning

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. Run `node "<keel>/scripts/plans.js" "<project>" mark get --session <sid>`. `planning: none` → say
   "This conversation plans nothing: /keel:start-planning starts or continues a feature." and stop.
   Otherwise `<f>` is the feature. Read `<keel>/skills/_shared/planning.md`, section "Rules"; the
   other sections when a step names them.
3. Run `plans.js check <f>` first.
4. **Mode**, from the instruction: handing over in any words ("we continue tomorrow", "save for
   later") → **A**; final words ("final", "done", "export the tickets") → **B**. No instruction →
   by the state: open questions (the `open Q` of `plans.js list`) or `check` problems → **A**, say why
   in one line; else ask "Final review and export, or hand over?". Ambiguous → ask, never guess.
5. **A. Hand over.**
   1. Reviews of the changed tickets only: planning.md "Reviews", steps 1-3, 5 and 6 (no plan
      review). Nothing changed → no review.
   2. Each finding: fix now or record it as a Q.
   3. Update `plan.md`: Open questions; Next action (where planning stands and the next step, so the
      next conversation starts from it); front matter `after_commit` = `git rev-parse --short HEAD`.
   4. A repository draft → planning.md "Commit and push".
6. **B. Final.**
   1. **Gates**: `open Q 0`, `check: clean`, and every finding in `reviews/` has a decision. Else
      show what blocks and offer mode A (yes → A; no → go to step 7).
   2. Reviews: planning.md "Reviews", all steps: the ticket reviews, then one plan review.
   3. Fixed tickets: `plans.js check <f>`, then their ticket review again; at most 2 rounds per
      end-planning. Big plan fixes (a new ticket, a changed decision) → offer the plan review once
      more. A finding deferred to a Q → the gates fail: offer mode A. Fixes after the last round →
      the user chooses: accept them as reviewed (`plans.js reviewed <f> <tickets>`) or mode A.
   4. `plans.js state <f> ready` → `status: ready`; refused → show its reason and offer mode A.
   5. **Export.** `plans.js settings`. `export: -` (the first time) → ask where: the repository (a
      ticket folder the project has, else `tickets`; the feature lands in `<folder>/<f>/`) or this
      machine only; then planning.md "Project rules" for that choice. `prefix: -` → propose the first `comments.ticket_prefixes`
      of `.keel/config.json`, else 3-4 capital letters from the repository name; the user confirms.
      Save with `plans.js settings set --export <pc|repo> [--export-dir <dir>] --prefix <PROJ>`. Set
      before → say the target and prefix in one line (the user may change them). Ask "Export the
      <n> tickets now?"; no → the plan stays `ready` for the next end-planning.
   6. `plans.js export <f>`: show `exported:`, its `- T<n> -> <KEY>: <file>` lines and `readme:`.
      Refused → its reason; the plan stays `ready`. On this machine → say "These tickets are seen on
      this machine only." In the repository → planning.md "Commit and push" (a draft's plan.md,
      `reviews/` and T-files leave with that commit; without it they stay).
7. **Always**, whatever happened above (also after a stop or a no):
   `plans.js mark clear --session <sid>` → `planning: none`.
8. Costs: read `<keel>/skills/_shared/usage-sync.md` and follow its steps 1-4 with session id
   `${CLAUDE_SESSION_ID}` (no level: planning has no verification); its step 5 runs in step 9.
9. Report, one message in the conversation language, short: **Done** (mode, the plan's state, tickets,
   what changed); **Reviews** (found, fixed, deferred to Q, rejected; failed reviews named; or "no
   review: nothing changed"); **Git** (commit, branch, pushed or not; or nothing); **What next** (A:
   "Continue with `/keel:start-planning <f>`: <Next action>"; B: the feature folder and "a ticket
   starts with `/keel:start-task <KEY>`"; both: "/clear before other work keeps it apart and costs
   less"); **Costs**: run usage-sync.md step 5 last and give its text as
   `<keel>/skills/_shared/final-report.md` block 5 says (read only that block).
