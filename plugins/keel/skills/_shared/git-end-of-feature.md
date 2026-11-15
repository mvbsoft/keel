# keel git: end of a feature (read from git.md "End of feature")

The calling command gives you `<keel>`, `<project>` and the language. "Step 3 (Merge)"
below is a step of `<keel>/skills/_shared/git.md` "Autonomous mode".

After `done: feature <f> complete (<n> tickets)` and the push, or offered by `/keel:tasks` (both git
modes: each step runs only on its own yes, as the user's instruction): say "Feature <f> is complete:
all <n> tickets done." `<branch>` and `<merge_into>` come from the `branch: <b> -> <m>` line of
`node "<keel>/scripts/plans.js" "<project>" tickets <f>`, never from the task file. Then one question
at a time:
0. Onto `<branch>`. Already on it → nothing. On the ticket branch the last ticket finished on → first
   its usual merge into `<branch>` (step 3; it leaves you on `<branch>`); declined or refused → say the
   feature waits for that merge and stop here. Anywhere else (e.g. the main branch) → "Switch to
   `<branch>`?" → `switch --name <branch>` (a clean tree); no → stop here.
1. The tickets: keep them (default) or delete them. Delete →
   `node "<keel>/scripts/plans.js" "<project>" drop <f>` (`plans: drop refused (<f> still has stubs:
   ...)` → say it; the tickets stay) → `drop: <folder> -> trash <batch>`; a
   folder in the repository then leaves in its own commit on the feature branch, before the merge
   (keel never commits on the main branch): "Claude Code will now ask you to allow it.", then
   `node "<keel>/scripts/plans.js" "<project>" commit <f>`, then `git-flow.js push`.
2. "Merge `<branch>` into `<merge_into>`?" → step 3 (Merge) with that target.
3. Only after step 2 printed `merge: <branch> -> <merge_into> (<sha>)` (it leaves you on
   `<merge_into>`): "Delete the branch `<branch>`?" →
   `node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>`, with `--remote` when
   it was pushed (Claude Code confirms). A declined or refused merge, or a pull request instead →
   no step 3: say the branch stays.
A no to step 1: the tickets stay; go on with the next question.
