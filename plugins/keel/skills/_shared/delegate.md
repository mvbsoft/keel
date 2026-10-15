# keel delegation (a plan's steps done by implementers)

The calling flow gives you `<keel>`, `<project>`, the plan file and the language to talk in. You are
the main session: you brief, accept and report; the `keel:implementer` agents write the code. Do not
do a step's work yourself while its implementer runs.

Run each check as its own plain command too, like keel's scripts (preflight.md); change the plan file
with Edit, not with shell tools.

## 0. Before the first step
1. Run `node "<keel>/scripts/plan-steps.js" "<project>" "<plan file>" --remaining`. `problems` other
   than `none` → fix the plan's Steps section (it is your plan) and run it again.
2. The step table with models and efforts is the user's to confirm. Already confirmed with the plan →
   go on. Otherwise (e.g. start-session "do it through subagents") show the table and ask "Confirm or
   change?"; wait.
3. `SendMessage` may be a deferred tool: load it now with ToolSearch (`select:SendMessage`).
4. keel's hook notes "runs on sonnet because \"Allow Opus for agents\" is off" when an Opus step
   starts → tell the user once that Opus steps run on Sonnet.

## 1. Each step, in order (only steps not `done`)
**Brief.** Spawn `keel:implementer` with the Agent tool: `name` = `step-<n>` (taken → `step-<n>-b`),
`model` and `effort` = the step's (the user confirmed them, so pass both explicitly), in the
foreground when you can choose. The prompt, self-contained:
- `<project>` and the plan file path;
- the step block copied whole (files, do, done when);
- what earlier steps produced: files and the names they added (functions, routes, tables), from
  their accepted reports;
- the ready APIs with documentation links (plan section "Libraries and framework");
- the test commands of the touched part (`.keel/config.json` `gates.checks`).

Add `- implementer: <agent id from the Agent result>` to the step's block in the plan file. Messages
go to the name; when the name is not reachable (the session was resumed or cleared since), use that
agent id.

Wait for its report (in an interactive session it may arrive later as a notification).

**Accept.** From the report and your own checks, not from the report alone:
1. Run the step's tests yourself (the narrow command from the criteria or the touched part's check).
2. `git diff --stat`; read only the key hunks (`git diff -- <file>`) of the files central to the step.
3. Run `node "<keel>/scripts/comments.js" "<project>"`. Each note about this step's files goes into
   the repair message, except a long comment that explains tricky code and is kept for that reason
   (notes about earlier accepted steps are settled).
4. Each "done when" criterion → confirmed (by what) or not confirmed (why).
5. Files changed outside the step: look at why; unexplained → treat as a problem.
All criteria confirmed and tests green → set the step's status to ✅ in the plan file and tell the
user one line: "Step <n>/<total> accepted: <what>; tests <passed>/<total>."

**Repair.** Something is not confirmed → `SendMessage` to the same `step-<n>` with exactly what is
wrong: the criterion, the command, the failing output lines, the file:line. Then accept again. After 2
repair rounds the step is still not accepted → ask the user: one more repair, re-run the step fresh on
Opus, you finish it here, or stop.

**Turn limit.** The Agent result says the agent "stopped at its <n>-turn limit before finishing"
(keel's implementer: 350), or the report says `status: partial` → this is the user's decision, not
yours: Claude Code's note suggests messaging the agent to continue, but do **not** send anything yet.
Check the criteria as in Accept (run the tests yourself: there may be no report) and end your turn
with this, at the end of the step:
```
Step <n> stopped before finishing: <reason, e.g. the turn limit of 350>.
Done: <c> of <t> criteria (<c/t as %>): <criterion - confirmed by what>; not done: <criteria>.
Advice: <continue: the same implementer picks up where it stopped (what is left is <...>)
        | finish: what is left is small (<...>), I do it here or it becomes a small step>.
```
The percentage counts only criteria you confirmed. Wait for the user's answer, even when continuing
looks obvious. Continue → `SendMessage`
"continue from where you stopped" to the same `step-<n>`. Set the plan's step to
◐ <c/t as %> until it is done.

**Blocked.** `status: blocked` → put its question to the user in plain words (with its options and
recommendation); send the answer to the same `step-<n>` by `SendMessage`.

**Model.** A Sonnet step fails twice for a reason of difficulty (not missing information) → propose
re-running it fresh on Opus; only on the user's yes.

## 2. After the last step
1. Run the gates of the touched parts once (`gates.checks`).
2. Cost (always, also when nothing went wrong): `notes.js check` shows `session start: ... at <time>`; run
   `node "<keel>/scripts/ledger-report.js" "<project>" --since <time> --agent implementer --session <sid>` and
   show its total line in the final message.
3. Tell the user the steps are done and what comes next: `/keel:end-task` (a task) or
   `/keel:end-session` (long work). No commits per step: git happens at the end, as usual.

**A change to an accepted step.** The user asks to change what a step already made → `SendMessage`
the change to that step's implementer (it knows the code), then accept again, including the steps
that build on it.

## The user's word wins
"Do step 4 here", "skip step 5", "switch step 2 to Opus", "stop delegating" → do that, update the
plan's Steps section to match, and go on.
