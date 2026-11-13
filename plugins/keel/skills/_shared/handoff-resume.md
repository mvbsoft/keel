# keel session note: resume (/keel:start-session; read from handoff.md "Resume")

The calling command gives you `<keel>`, `<project>` and the language to talk in. This lane uses only the
note, never the task files (ignore the `tasks:` line of `notes.js check` except where a case below
says otherwise). Writing a note (a new line of work) follows `<keel>/skills/_shared/handoff.md` "The
handoff format" and its files (`.keel/next-session.md`, `.keel/memory/project-memory.md`,
`.keel/sessions/`): read that section then.

## Resume (start-session)
`notes.js check --begin --session <sid>` has run. Act on the case that fits:

| Case | What to do |
|---|---|
| a `lane conflict:` line | show it, ask which lane leads that key and stop |
| `active task:` is not `none` | a task is a different lane: ask "A task is active in this session. Hand it off or finish it with /keel:end-task first, or open a new session for this line?" and stop |
| the instruction is a key, an id (`ABC-123`, `#123`, a task id) or a link | run `notes.js lane <it>` (for a link it also checks the tracker key in it). `lane: task` → "Tasks use /keel:start-task: better continue it there." and stop. `lane: conflict` → show its lines, ask which lane leads it and stop. `lane: session` → the written line: go on as "a note + an instruction". `lane: none (task <id> was finished or dropped earlier)` → say so and ask whether to start it as a new line; no → stop. Any other `lane: none` → a session on it is fine: a key → find what it is (intake.md step 2, internal search, "Is this it?"); a link → read it as intake.md step 2 says (connector, `gh` or WebFetch; cannot → ask for the text); it describes a new line: go on with the rows below and put the key (`key from the link:`) into the note's `keys` |
| a note, no instruction | read the note (and memory's Active context); summary in 3-6 lines: goal, where we are, done / not done; then its next action. The Plan has no steps left and **Later** has items → propose the next 1-3 of them (with their why) as the new Plan and ask which |
| a note + an instruction ("only write the tests", "also add CSV") | the same, following the instruction; extra work is added to the plan |
| a note (not `done`), but the instruction (a link, a description) is about a different line of work | ask: "Continue the written line or start a new one?" New → there is one note, so ask next: finish the old line (it ends as `done`: its Plan, Later and `keys` leave the note; with `git.state_in_git` git history keeps them) or keep its open Plan steps and Later items (they go into the new note's **Later**, one line each, its `keys` stay). Write the new note only after this answer, then go on as the rows for no note below |
| `note behind` shows new commits on the main branch or after the note | first compare: `git log --oneline` of those commits against the note's State; tell the user what changed; then continue |
| `note branch` differs from the current branch | autonomous: `git-flow.js switch --name <branch>`; `stopped` (uncommitted changes) → ask what to do with them; manual: give `git switch <branch>` and wait until the user says it ran |
| `status: blocked` | show the open questions first; continue once they are answered |
| no note (or `status: done`) + a path to a plan file | a new line of work: read the file; write the note from the template with its items as the **Plan** (steps ⬜; a file with step blocks keeps their shape) and its goal as **Goal**; **Later** empty; show it and ask "Start?"; on yes the git branch for the line first (below), then write the note (a switch needs a clean tree) |
| no note (or `status: done`) + a feature's name or folder (planned tickets: "do these tickets one by one") | run `node "<keel>/scripts/plans.js" "<project>" tickets <feature>` (a folder: its last part; `tickets: none (no ticket or feature <x>)` → not a feature: the rows below). A new line of work: the **Plan** is its tickets marked `next` or `to do`, the `next` one first, then each after the tickets it depends on (`plans.js tickets <KEY>` prints its `depends:` line; the feature view does not), one ⬜ step each (`<KEY> <title>`); `keys` = those keys (each must give `lane: none`); `branch` and `base` = the feature branch (its `branch: <b> -> <merge_into>` line), `merge_into` = its `merge_into`. Tickets `in progress` or `waiting for ...` are listed with their hints and the user decides whether any goes into the Plan. A dependency in another repository (its state followed by `(<folder>, ...)`, or `not checked`) is no step of its own: the ticket's step names it with that state. Show it and ask "Start?"; on yes the branch first, then write the note (a switch needs a clean tree): autonomous `git-flow.js switch --name <b>` (missing: `start --name <b> --from <the ref that has the tickets>`; refs without the remote prefix: `origin/x` → `x`); manual: give `git switch <b>` and wait |
| no note (or `status: done`) + a description | a new line of work: follow `<keel>/skills/_shared/intake.md` steps 3, 5 and 6 (retell, the brainstorm offer or questions, plan) with the description, but from step 3 only the retell and the premise check: no "new or continuation", never a task; the plan becomes the note's **Plan** as in the row above (plan.md's Execution steps for a session) |
| no note (or `status: done`), no instruction | look in the project for work: memory's Active context, plan files, TODO markers in recently changed files, unfinished work in `git status`; propose 1-3 briefly. Nothing → "There is no work for a session; tell me what to do." `tasks:` shows unfinished tasks → add "There are unfinished tasks: /keel:tasks shows them, /keel:start-task continues one." Never start a task yourself |
| a note + "do it through subagents" (or "delegate") | summary as above; then follow `<keel>/skills/_shared/delegate.md` with the plan (below) |

**Which lane** for a new line: "done" in 1-3 sittings → a task; a plan for weeks with "later" items →
a session. A new line that clearly fits a task → suggest `/keel:start-task` in one line; the user decides.

**Git branch for a new line.** Autonomous: `git-flow.js start --name <short-name>` (2-4 lowercase
words joined by `-`; from `git.main_branch` unless the user named another base). Manual: give
`git switch -c <short-name>` and wait. Uncommitted changes → ask first, never carry them silently.

**The plan and its size.** The note's Plan holds the line's steps; its `execution:` keeps the choice
(`here`, `delegate`, or `fresh`: a fresh conversation runs the saved plan, how is not chosen yet).
The user saying how ("do it through subagents") wins over any of it.
- **A plan written in this conversation** (a new line): run
  `node "<keel>/scripts/plan-steps.js" "<project>" "<file with the steps>"`. `suggest: delegate` →
  the plan's Execution step 3 names the choice as intake.md step 6 says (`fresh` recommended,
  `delegate`, `here`, or what the user says) and states its `ask:` line; approving the plan answers it.
  `very big:` is for tasks only: a line of work spans sessions. For `fresh` the plan's Execution
  step 4 holds what the discussion settled, as intake.md step 6 says; the note takes it into
  Decisions and why and Open questions. `execution: fresh` → once the note is written, the plan
  discussion stays behind: first check that the note holds what it settled (add what is missing),
  then say: "The plan is saved. Type `/clear`, then `/keel:start-session`: the work goes on from the
  note." and stop; keel never types it for the user. A conversation that began with the plan alone
  ("Yes, clear context") is the fresh one: as below.
- **A note read at the start** (a resume): run
  `node "<keel>/scripts/plan-steps.js" "<project>" "<file with the steps>" --remaining`, then act on
  `execution:` as intake.md "Resume" step 7 does (`<keel>/skills/_shared/task-resume.md`), after the summary: `fresh` → ask its `ask:` line
  and write the answer into the note's `execution:`, also saying what this session can cover; `here`
  or `delegate` → no question, one line with its count.
- Steps without files, model, effort or "done when" (`problems`) and the work is delegated → first
  complete those steps in the plan (they are yours to write), then show the step table to confirm.

At the end the user runs `/keel:end-session`, with an instruction when they want one (e.g. "push and
merge into main", "we continue tomorrow, prepare").
