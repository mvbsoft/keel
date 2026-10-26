# keel git (after verification in /keel:end-task and /keel:end-session)

The calling command gives you `<keel>`, `<project>`, which ending it is: **finish** (end-task
finishing a task; end-session when the user says the line is finished) or **handoff** (end-task
handing off; other end-session runs), and the actions from the user's instruction (e.g. "create
branch bug/FIX-123, push, merge into main"). Mode: `.keel/config.json` `git.mode`. Base and merge
target: `base` and `merge_into` of the task file (end-task), else of the note (end-session), else
`git.main_branch`. One branch per task; a task folder in git lives on its task branch and is never on
the main branch. A planned ticket works on its feature branch, not from the main branch (below).
**Merging** into the main branch (or any target) happens only when the instruction asks for it, or in
a **finish** when `git.ask_before_merge` is false; otherwise the branch stays pushed and the report
says "merge it when ready". Claude Code confirms each merge keel was told to do, except when
`git.ask_before_merge` is false in a confirmed autonomous mode.
**A planned ticket on its feature branch** (the task's `branch` is its `base`, the feature branch;
`plans.js tickets <id>` knows the key): no `start`, `sync` pulls the shared branch, then `push`. Its
feature branch is never merged, also when `git.ask_before_merge` is false or the instruction asks
(say why in one line: other tickets of the feature are not done): only "End of feature" below merges
it, after `done: feature <f> complete` and a yes. A ticket branch
(`base` = `merge_into` = the feature branch) merges into the feature branch like any task.
Red verification and an instruction to push or merge → stop and ask before any git step.
A **task handoff** whose instruction asks to merge, with the task folder in git: before any git step say
the task is not finished, so the merge puts its folder `.keel/tasks/<id>/` into the target; ask "Finish
the task instead, or merge anyway?". Finish → stop here and run it as a finish; merge anyway → go on.

**A task handoff without its own branch** (the task's `branch:` is the base, the main branch or `-`:
the work sits in a branch other work shares) and no instruction about git: before any git step ask,
in both git modes, naming the branches:
- a new branch `<id>-<short-name>` from here: commit and push there, then back on `<current>`
  (recommended);
- commit and push to the current branch `<current>` (not offered when it is the main branch: keel never
  commits or pushes there);
- no commit: the changes stay uncommitted here for the next session (they move with you if you
  switch branches; say so);
- the user's own instruction.
The answer is the instruction for the steps below; manual git mode then runs them too, because the
user asked.
A planned ticket on its feature branch asks this instead, when the feature has 2 or more tickets
(`plans.js tickets <feature>`; one ticket → the usual commit and push to its branch):
- a new ticket branch `<KEY>-<short-name>` from the feature branch (recommended; later merged back
  into it): `start --name <it>` carries the changes; set the task file's `branch` to it and `base` and
  `merge_into` to the feature branch before the commit;
- commit and push to the feature branch (you work on it alone);
- no commit: the changes stay uncommitted here for the next session.

**Default steps** in autonomous mode (manual mode: below). Never ask which git
steps to take (except the question above): the instruction only adds or changes steps.

| Ending | Steps |
|---|---|
| finish (task or session) | commit, sync, push; merge only as "Merging" says |
| task handoff | commit, push, switch to the base branch |
| session handoff or prepare | commit, push; no sync |

## Commit message (both modes)
Follow the style of `git log --oneline -10`; with no clear style use Conventional Commits. Subject at
most 72 characters, imperative, with the task id when it is a tracker key; a short body says why.
Language: `repo_language`. No mention of AI, assistants or generated code; no co-author trailers for tools.
Keys inside ticket files (front matter `type: ticket` or `type: feature`) are allowed: they are the
tickets' own names, not references in code.

## Manual mode
Run no git step the user did not ask for. When the instruction or the user's answer to a keel question
asks for one ("push", "commit", "merge into main", a branch choice), run it with the `git-flow.js` steps
of the autonomous mode below (Claude Code asks before each, since autonomous git is not confirmed);
everything else stays with the user. Give the user:
- the changed files (from `node "<keel>/scripts/git-flow.js" "<project>" status`);
- the commit message, ready to copy;
- **finish**: the task folder's removal (it is in keel's trash) is part of that commit; then merge as
  they usually do;
- **handoff of a task**: commit the work and the task folder on the task branch (preferred), then
  `git switch <base>`. Not a commit: commit only the task folder when it is in git, then
  `git stash push -u -m "keel: <id>"` for the rest. Say which one in the task's State. A task without
  its own branch: the question above first; the user's answer is run, not only shown;
- **handoff of a session**: "Commit and push when convenient; the note is part of the commit" (when
  `git.state_in_git`).

## Autonomous mode
Each step is one command `node "<keel>/scripts/git-flow.js" "<project>" <step> ...`. Read the first
line: `ok` → next step; `stopped` or `unavailable` → tell the user the `reason:` and the detail lines
in plain words, say which steps are done and which are left, and stop git here. Never work around a
stop with raw git on your own. A **finish** whose task folder went to keel's trash adds
`--finish <id> --session <sid>` (from the calling command) to every `start`, `commit`, `sync` and
`push`: a step that stops then puts the task back by itself (`restored:` lines; say so). A ticket
the finish marked done goes back with it: `node "<keel>/scripts/plans.js" "<project>" done <id> --undo`.
1. `status`. Its line `autonomous on this machine: not confirmed` (or `settings changed`) → offer
   `node "<keel>/scripts/git-flow.js" "<project>" trust` (the user confirms once), or each git step
   asks. On the main branch (or the base) with changes → `start --name <branch>` (it carries the
   changes); not for a planned ticket on its feature branch (no `start`, see above), unless a branch
   question above chose a new branch. The branch is the one the instruction, the task file or the note
   names; only when none is named, make one as in `<keel>/skills/_shared/intake.md` step 6. An
   instruction naming another branch (e.g. `bug/FIX-123`) → `start --name <it>` (it carries the
   changes).
2. Write the message to `<project>/.keel/local/tmp/commit-message.txt`, then
   `commit --message-file "<project>/.keel/local/tmp/commit-message.txt"`. The script leaves out
   secret files and lists them: tell the user. `nothing to commit` is fine. In a **finish** the task
   folder went to keel's trash before this step, so its removal is in this commit.
3. **Handoff**: `push` (refused → say so, it does not stop the handoff). The instruction asks to
   merge → step 6 now, still on this branch (a refused push: no merge, say so). A task: then
   `switch --name <base>`. Done, skip the rest.
4. `sync --from <base>`. On the base itself (a planned ticket on its feature branch) it merges
   `<remote>/<base>`: the teammates' commits of that shared branch.
   - `conflict` → show the files. In a finish the commit of step 2 already holds the task's removal,
     so nothing is put back (`restore: not needed ... committed`); the offer below is the same, and
     after the resolve commit the finish goes on with the push. Offer: resolve together now (on yes: `git merge origin/<base>`, or `<base>` without a
     remote; fix each file with the user, run the gates, commit, then continue at step 5) or leave it
     to the user.
   - `merged N new commits` → run the gates of verification step 2 again; red → show them; no push
     while they are red. Offer: fix them now (on yes: fix, run the gates, then step 2 with a new
     message, then step 5) or stop. With `--finish` the task's removal is committed but not pushed:
     "stop" puts the task back, `node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>`
     (and its ticket: `plans.js done <id> --undo`); say so: fix it, then /keel:end-task again.
5. `push`. Refused → stop and show why.
6. **Merge** (a handoff comes here from step 3), only as "Merging" above allows: say in one line
   "Merging <branch> into <target>. Claude Code will ask you to confirm." (the second sentence only
   when it will, as "Merging" says), then `merge --into <target>`. Declined → the branch stays
   pushed; say so.
   - `<target> is protected` → the merge was undone locally. Show the `pull request:` line and ask
     "Create the pull request now?"; only on yes run it, with a title and body from the task in
     `repo_language` and no mention of AI.
7. Report: commit, branch, pushed or not, merged or not, PR link.

## End of feature
After `done: feature <f> complete (<n> tickets)` and the push (both git modes: each step runs only on
its own yes, as the user's instruction): say "Feature <f> is complete: all <n> tickets done." Then one
question at a time, on the feature branch:
1. The tickets: keep them (default) or delete them. Delete →
   `node "<keel>/scripts/plans.js" "<project>" drop <f>` → `drop: <folder> -> trash <batch>`; a
   folder in the repository then leaves in its own commit on the feature branch, before the merge
   (keel never commits on the main branch): "Claude Code will now ask you to allow it.", then
   `node "<keel>/scripts/plans.js" "<project>" commit <f>`, then step 5 (`push`).
2. "Merge `<branch>` into `<merge_into>`?" → step 6 (Merge) with that target.
3. "Delete the branch `<branch>`?" → `switch --name <merge_into>`, then
   `node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>`, with `--remote` when
   it was pushed (Claude Code confirms).
A no to any step: say what stays and go on with the next question.

## Never
Force-push, rebase pushed work, delete branches (only `/keel:tasks drop` does, with
`git-flow.js delete-branch`, which Claude Code confirms), except the feature branch in "End of
feature" above, on its yes; commit secret files, or commit to the main branch directly in autonomous
mode.
