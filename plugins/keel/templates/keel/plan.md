<!-- Write the whole plan in the conversation language: headings, the word "Step", the field labels
(files, model, effort, do, done when, status) and all text. Keep as they are: code names, paths,
commands, the values haiku/sonnet/opus and low..max, the status symbols. Saved as plan.md in a task
folder, it follows handoff.md "The handoff format" for its language. Lines marked <task> or <session>
below: keep the ones for this plan, drop the others; of the Branch lines keep the one chosen. Remove
this comment. -->
# <KEY>: <short title>

## Goal and acceptance criteria
<goal in one sentence; criteria as a list; what is out of scope>

## Files
<file: what changes and why>

## Architecture
<where each new thing lives and why there; what is shared and what stays in the module; names>

## Libraries and framework
<what the framework or an installed package already provides, with a documentation link; what is written by hand and why>

## Tests
<which tests prove the criteria; which existing tests cover the touched code>

## Likely verification level
<gates only | Basic | Standard | Maximum, and why>

## Documentation
<what to update, per the project's documentation profile>

## Steps
<One block per step, in the order they are done. Each step is one exact change that an implementer
can do without guessing: it names its files, says what to do and where, and how to know it is done.
Model: haiku when nothing is left to decide, sonnet when the step leaves a decision, opus for work that
should not be split (every part must agree, or it needs judgement across many coupled places), with
the reason. `node "<keel>/scripts/plan-steps.js"` checks
this section by its shape, not its words: level-3 headings "<word> <n>: <title>" numbered from 1, and
the list items in this order: files, model, effort, do, done when (a numbered list), status.
Status: ⬜ not done, ✅ done, ◐ <n>% partly done, ⚠ broken.>

### <Step> 1: <what this step achieves>
- <files>: `<path>`, `<path>`
- <model>: sonnet
- <effort>: high
- <do>: <what to change, with the names of functions, routes, tables; the ready API to use>
- <done when>:
  1. <a checkable result, e.g. "`npm test -- cart` passes with the new test for an empty cart">
  2. <...>
- <status>: ⬜ <not done>

## Execution
Do these steps after the plan is approved, also when the conversation was cleared. `<sid>` is this
session's id (keel's session-start line):
1. Branch (both git modes; the user changes it in the approval answer), one of:
   <a new branch> Run `node "<keel>/scripts/git-flow.js" "<project>" start --name <branch> --from <base>`
   (manual git mode: `git switch -c <branch>`); `stopped` → tell the user why and wait.
   <the current branch `<branch>`> No git step.
   <the user's steps: ...> One at a time as `<keel>/skills/_shared/intake.md` "7. Execution" item 1 says.
   The task file or note comes after the branch.
2. <task> Run `node "<keel>/scripts/notes.js" "<project>" task new <id> --title "<title>" --source <source> [--link <link>] --session <sid>`
   (`task activate <id> --session <sid>` when the task exists already). Save this plan as `plan.md`
   in the task folder it names, then fill its `task.md` as `<keel>/skills/_shared/intake.md` "7. Execution" item 2
   lists (every front-matter field and section), with `plan: plan.md` and `execution:` as below.
   <session> Write `.keel/next-session.md` from `<keel>/templates/keel/next-session.md` with these steps
   as its Plan (handoff.md "Resume"), `execution:` as below; never a task file.
3. Execution: <here | delegate>. Here: work through the steps yourself, in order; run the touched
   tests as you go; mark each step done (✅). Delegate: follow
   `<keel>/skills/_shared/delegate.md` with this plan file.
4. User's changes: <branch, base, where to merge, anything else the user said; or "none">.
5. When the work is done, tell the user to run <task> `/keel:end-task` (to finish, or to hand the task
   off for another session) / <session> `/keel:end-session` (to verify and prepare the next session).
