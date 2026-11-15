# keel intake: resume a task (/keel:start-task on an existing task; read from intake.md "Resume")

The calling command gives you `<keel>` and `<project>`. "Before any branch change" is a section of
`<keel>/skills/_shared/intake.md`; read it when step 1 or 2 needs a branch switch.

1. **Uncommitted changes** (see intake.md "Before any branch change") come first, only when step 2 needs
   a branch switch; on the task's branch already they stay and belong to the task.
2. The branch: the task's `branch` (`State: ... branch <name>`), else the one in `Files: (on branch ...)`;
   without a remote prefix (`origin/x` → `x`). Not the current branch → autonomous: `node "<keel>/scripts/git-flow.js" "<project>" switch --name <branch>`
   (`stopped` → tell the reason, wait); manual: give `git switch <branch>` and wait until the user says it ran.
3. `node "<keel>/scripts/notes.js" "<project>" task activate <id> --session <sid>`, then read the
   `task.md` it names and the folder's `plan.md` if any. `State: active in another session` → tell
   the user in a line.
4. **Stale?** `Base moved:` → say how many commits the task is behind and offer
   `git-flow.js sync --from <base>` (manual: `git merge <base>`); it needs a clean tree, so with
   uncommitted work offer to commit it on the task branch first. Handed off 7 days ago or more, or
   commits after its `after_commit` → compare
   `git log --oneline <after_commit>..HEAD` with State and
   Files and say what no longer holds.
5. Run the "How to check" command once; its result in one line (red → that comes first).
6. A tracker, link or file task: read the source again (as intake.md step 2 does) and tell the user what changed
   against Goal and Acceptance criteria. Do not overwrite them without a yes.
7. Summary in 3-6 lines: goal, where we are, done / not done, open questions. Then the **Next action**.
   How to run the rest (only when the task has `plan: plan.md` or `execution:` is not `here`; a
   simple task's `- ⬜` lines are not plan steps): run
   `node "<keel>/scripts/plan-steps.js" "<project>" "<plan.md or task.md>" --remaining`.
   `execution: fresh` → this is the fresh conversation: ask its `ask:` line (delegate or here; no
   `ask:` → here) and write the answer into `execution:`. `here` or `delegate` → the choice is made:
   no question; say in one line how it goes on, with its count ("<n> steps left: going on here, as
   chosen; say if otherwise").
