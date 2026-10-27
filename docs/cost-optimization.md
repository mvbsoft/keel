# Spending less with keel

[Українська](cost-optimization.uk.md)

Cost grows with the number of requests and with the size of the conversation each request re-reads. keel gives you several levers: the model, the verification level,
cheaper models for mechanical work, a smaller conversation, and a report that shows where the money went.
This page lists them with their mechanism. The numbers are in [one table at the end](#summary), each
with what it was measured on, or marked as an estimate or a recommendation. Dollars are list prices; on
a subscription the same tokens count against your plan limits. Quality matters too, so each lever says
what it costs you.

## 1. Choose the main model

keel never switches your conversation's model; you pick it with `/model`. keel compared Sonnet and Opus
as the main conversation on whole tasks (planning, code, a verification by a bug hunter and QA, fixes), with the review
agents on their usual models:

- **Sonnet is the default.** It passed every hidden acceptance check, on a small and on a big task.
- **Opus for big or risky tasks.** It passed the same checks at about twice the cost. Blind judges
  preferred its result in most comparisons, mostly by a small margin, for tests that catch regressions
  and edge cases.

Trade-off: Opus costs about twice as much for tests that catch more. Use it where a missed regression is
expensive. The comparison covers one codebase and two tasks; see the [table](#summary).

## 2. Pick the right verification level

The level is the biggest single choice at the end of a task. keel shows an estimate for each level when
you choose; [verification: Cost](verification.md#cost) has the measured cost of each level and the
defects it found on keel's test set. Maximum costs many times more than Basic. On most changes of the
test set Basic found the same defects as the higher levels; the subtle ones were found by Standard in 2 of
3 runs, by Maximum in its one run, and by Basic at most in part. So a small ordinary change does not
need Maximum. The proposal is built from the change, so it is a good default; see
[verification](verification.md).

Related savings:

- keel advises against running the same level again on exactly the same code.
- Lock files, generated files and vendored files are **not counted** when keel sizes a change, so
  regenerating a lock file does not push a small change into a higher level.
- `verification.verifier_caps` limits how many verifiers run at each level (defaults 2, 5, 8 for
  Basic, Standard, Maximum). Lowering it saves money, but findings beyond the cap are shown as "not verified".
- `allow_opus` off makes every keel agent that would run on Opus run on Sonnet instead: cheaper, less
  thorough.

## 3. Haiku for mechanical implementer steps

When a plan is handed to implementer agents, each step has a model. When the plan names the files and the
place, and nothing is left to decide, keel plans the step on Haiku. In keel's test such Haiku
implementers passed the same hidden checks as Sonnet implementers, and the whole task cost less (the
Sonnet main conversation stays, so most of the task's cost remains). Renames across files, inventories
("find every call of X and classify it") and tests scored the same as Sonnet at a small fraction of the
cost.

Trade-off: Haiku is weaker when it has to decide where code belongs, so keel plans such steps on Sonnet.
Haiku's list price is five times higher for a prompt over 100,000 tokens, so it pays off for steps with a
small context; the Haiku requests in keel's tests stayed below that. You see the model of every step in
the plan and can change it. `effort: medium` is only for mechanical work.

## 4. Do not split a plan into tiny steps

Handing out and accepting a step costs the main conversation a fixed amount every time. So a plan cut
into many one-file Haiku steps cost more than a few Sonnet steps, and came out worse. Write steps as one
exact change each, with the files, the place and a checkable "done when".

## 5. Delegation thresholds

When a plan reaches 8 steps or 15 files, keel asks whether to do it in this conversation or hand the steps
to implementers (one fresh agent per step, each on the model the step needs). Settings:
`delegation.min_plan_steps` and `delegation.min_plan_files` (defaults 8 and 15). The defaults are a
starting estimate, not a measurement. Below both thresholds keel works in the conversation, unless you
ask to delegate. Delegation is not free: see section 4.

## 6. The compaction window

Every request re-reads the whole conversation, so a request in a long conversation costs more than one in
a short conversation (the table has the numbers for Opus). By default Claude Code compacts at about 967k
tokens with a 1M model. keel recommends `autoCompactWindow: 300000`.

Trade-off: details from early in the conversation are lost at each compaction more often.

When the context reaches 90 % of the compaction threshold, Claude starts each reply with a one-line
warning from keel's hook (the hook also sends it to Claude Code as a message for you), so you can run `/compact` with a focus (what to keep) or start a new conversation before Claude Code compacts on
its own. A large project can set its own window; see [settings](settings.md#examples).

## 7. `/clear` between tasks

A new conversation costs less than a long one, because there is less to re-read. After
`/keel:end-task`, run `/clear` before the next task. keel adds its working standards again after `/clear`.

Also consider `showClearContextOnPlanAccept` (keel recommends on): after you approve a plan, you can start
the work from the plan alone, without the planning conversation. keel writes plans so that they are
enough on their own.

## 8. The command output limit

`bashOutputMaxChars` (Claude Code's default 30,000 characters, keel recommends 15,000): the output of a
successful command that is longer than the limit goes to a file, and the conversation gets a short
preview and the file's path. This keeps test logs from filling the context. The setting does not cover
failing commands: Claude Code always cuts their output to a head-and-tail excerpt of about 10,000
characters.

## 9. keel's own overhead

In a project keel is set up in, keel adds its working standards and the project's comment rules to every
conversation. The plugin's skill and agent descriptions are listed in every conversation. The
end-of-task sync to the [usage page](usage-dashboard.md) costs a little too. All of these are small next
to the levers above (see the table).

## 10. Read the cost report

The report at the end of a task shows every participant with its model, requests, tokens and dollars,
and the three most expensive turns. Look for:

- the share of each participant: whether the main conversation or the verification agents spent the money;
- the model of each participant: a step or an agent on a more expensive model than it needs (sections
  1 to 3);
- tokens by kind: cache read counts every time a request re-reads the conversation (sections 6 and 7);
- the top turns: with previews on, the report shows the start of each expensive request.

The [usage page](usage-dashboard.md) adds history: dollars per day by model, per project and per hour of
work, and every session with its agents.

## Summary

| Lever | Setting or action | Number | What the number is |
|---|---|---|---|
| main model | `/model` | Sonnet: $0.92 (small task) and $1.32 (big task) per whole task, every hidden check passed. Opus: 1.8-2.1 times that, every hidden check passed. Blind judges preferred Opus in 9 of 12 verdicts (3 clearly, 6 slightly) and Sonnet in 3 (slightly) | measured: one codebase, 2 tasks, 3 runs per model and task, mean cost; Basic verification without its reviewer; 12 verdicts = 6 pairs of results × 2 judges (Opus and Sonnet) |
| level | choose at end of task | ≈$0.2 (gates only) to ≈$2.7-7.6 (Maximum) | the estimate keel shows; measured costs and defects found are in [verification](verification.md#cost) |
| Haiku steps | the plan's model per step | implementers $0.05 instead of $0.55-0.59; whole task $0.62-0.70 instead of $1.08-1.11 (about 40 % less); 12 of 12 hidden checks with both | measured: 1 task, 2 runs per model, Sonnet main conversation |
| mechanical work on Haiku | the plan's model per step | renames, an inventory and unit tests: the same results as Sonnet at 10-30 times less; harder tests (transactions, caches, retries): 19 of 20 deliberate breakages caught against 18 of 20 for Sonnet, at about 1/8 of the cost | measured: 4 tasks, 2 runs per model and task |
| tiny steps | do not | about $0.07 of main-conversation cost per step handed out and accepted; 11 one-file Haiku steps cost $0.98-1.16 per task, 3-4 Sonnet steps $1.08-1.11 | measured on the same task as "Haiku steps", 2 runs each |
| delegation | `delegation.*` | 8 steps or 15 files | defaults: a starting estimate, not measured |
| compaction | `autoCompactWindow` | on Opus 5.5 about $0.12 of cache reads per request at 600k tokens, $0.06 at 300k | computed from the list price of cache reads ($0.20 per million tokens) |
| `/clear` | between tasks | shorter conversation | — |
| output limit | `bashOutputMaxChars` | 15,000 characters | keel's recommendation (Claude Code's default is 30,000) |
| keel's overhead | — | what keel adds to every request, and the end-of-task sync: figures in [overhead](under-the-hood.md#overhead) | estimates from the size of what keel adds |
