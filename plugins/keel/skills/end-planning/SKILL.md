---
name: end-planning
description: End this conversation's planning as you say - hand over to continue later (review changed tickets), or the final review and export of the tickets into the feature folder; git only with your yes.
disable-model-invocation: true
argument-hint: "[what to do, e.g. we continue tomorrow | final review and export]"
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
   **An exported feature** (its tickets in the feature folder; planning.md "Exported feature") → neither
   mode: no plan gates and no plan review. `plans.js check <f>` (step 3) → `check: clean`, or fix its
   problems with the user (each write on a yes); then the repository → planning.md "Commit and push"
   (this machine: nothing to commit); then step 7.
5. **A. Hand over.**
   1. Reviews of the changed tickets only: planning.md "Reviews", steps 1-3, 5 and 6 (no plan
      review). Nothing changed → no review.
   2. Each finding: fix now or record it as a Q.
   3. Update `plan.md`: Open questions; Next action (where planning stands and the next step, so the
      next conversation starts from it); then `plans.js set <f> --after-commit` (`after_commit:`, and
      `after_commit_repos:` for the plan's other repositories).
   4. A repository draft → planning.md "Commit and push".
6. **B. Final.** A plan already `ready` in `plans.js list` (not "changed after ready") was reviewed
   as it is: go straight to Export (B.5).
   1. **Gates**: `open Q 0`, `check: clean`, and every finding in `reviews/` has a decision. Else
      show what blocks and offer mode A (yes → A; no → go to step 7).
   2. Reviews: planning.md "Reviews", all steps: the ticket reviews, then one plan review.
   3. Fixed tickets: `plans.js check <f>`, then their ticket review again; at most 2 rounds per
      end-planning. Big plan fixes (a new ticket, a changed decision) → offer the plan review once
      more. A finding deferred to a Q → the gates fail: offer mode A. Fixes after the last round →
      the user chooses: accept them as reviewed (`plans.js reviewed <f> <tickets>`) or mode A.
   4. `plans.js state <f> ready` → `status: ready`; refused → show its reason and offer mode A.
   5. **Export.** `plans.js settings`: say the target (`tickets: repo` → `<tickets_dir>/<f>/`;
      `tickets: pc` → this machine only) and the prefix (`ticket_prefix`) in one line, then
      planning.md "Project rules" for that target. `planning: planning is not set up ...` → say
      "Run `/keel:configure planning` in a new conversation (it does not run while this one plans),
      then `/keel:start-planning <f>` and `/keel:end-planning`." and go to step 7: the plan stays
      `ready`. A change of target or prefix is the team's setting: `/keel:configure planning`, the
      same way. A plan on several repositories: also name its other repositories; each takes its own
      settings. Ask "Export the <n> tickets now?"; no → the plan stays `ready`; later
      `/keel:start-planning <f>`, then `/keel:end-planning`.
   6. `plans.js export <f>`: show `exported:`, its `- T<n> -> <KEY>: <file>` lines, `readme:` and
      `research:`. Refused → its reason; the plan stays `ready`; `not ready:` lines → planning.md
      "Several repositories" item 8. On this machine → say "These tickets are seen on
      this machine only." In the repository → planning.md "Commit and push" (the files its `draft:` line names
      leave with that commit; without it they stay).
7. **Always**, whatever happened above (also after a stop or a no):
   `plans.js mark clear --session <sid>` → `planning: none`. A question waiting for the user's answer
   ends the turn, not the command: steps 7-9 run once the answer is handled.
8. Costs: read `<keel>/skills/_shared/usage-sync.md` and follow its steps 1-3 with session id
   `${CLAUDE_SESSION_ID}` and `--feature <f>` (`<f>` of step 2; no level: planning has no
   verification); its step 4 runs in step 9.
9. Report, one message in the conversation language, short: **Done** (mode, the plan's state, tickets,
   what changed); **Reviews** (found, fixed, deferred to Q, rejected; failed reviews named; or "no
   review: nothing changed"); **Git** (commit, branch, pushed or not; or nothing); **What next** (A:
   "Continue with `/keel:start-planning <f>`: <Next action>"; B or an exported feature: the feature
   folder and "a ticket starts with `/keel:start-task <KEY>`"; all: "/clear before other work keeps
   it apart and costs less"); **Costs**: run usage-sync.md step 4 last and give its text as
   `<keel>/skills/_shared/final-report.md` block 5 says (read only that block).
