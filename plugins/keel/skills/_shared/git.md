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
**A planned ticket on its feature branch** (a task or a session over a feature: the task file's or
the note's `branch` equals its `base`, and `plans.js tickets <the task id or a key of the note>`
prints `branch: <that branch> -> <merge_into>`): no `start`, `sync` pulls the shared branch, then
`push`. Its feature branch is never merged, also when `git.ask_before_merge` is false or the instruction asks
(say why in one line: other tickets of the feature are not done): only "End of feature" below merges
it, after `done: feature <f> complete` and a yes. Its report says "the feature merges at End of
feature, after its last ticket", not "merge it when ready"; manual mode: commit and push, no merge
advice. A ticket branch
(`base` = `merge_into` = the feature branch) merges into the feature branch like any task.
Red verification and an instruction to push or merge → stop and ask before any git step.
A **task handoff** whose instruction asks to merge, with the task folder in git: before any git step say
the task is not finished, so the merge puts its folder `.keel/tasks/<id>/` into the target; ask "Finish
the task instead, or merge anyway?". Finish → stop here and run it as a finish; merge anyway → go on.

**Unfinished work never stays on this machine only**: a task handoff commits it as work in progress on
a branch of its own and pushes it, so another machine goes on from that branch. Uncommitted changes
or a stash exist on one machine only. The user's own instruction (e.g. "do not commit") wins.
**A task handoff without its own branch** (the task's `branch:` is the base, the main branch or `-`:
the work sits in a branch other work shares) and no instruction about git: no question: a new branch `<id>-<short-name>` from here, `start --name <it>` (it carries the
changes), commit and push there, then back on `<current>`. Say it in one line, naming the new branch
(manual mode: the same steps as commands, git-manual.md).
A planned ticket on its feature branch, when the feature has 2 or more tickets
(`plans.js tickets <feature>`; one ticket → the usual commit and push to its branch), also no
question: a new ticket branch `<KEY>-<short-name>` from the feature branch (later merged
back into it): `start --name <it> --from <the feature branch>` carries the changes; set the task file's `branch` to it and `base` and
`merge_into` to the feature branch before the commit.

**Default steps** in autonomous mode (manual mode: below). Never ask which git
steps to take (except the merge question above): the instruction only adds or changes steps.

| Ending | Steps |
|---|---|
| finish (task or session) | commit, sync, push; merge only as "Merging" says |
| task handoff | commit, push, switch to the base branch |
| session handoff or prepare | commit, push; no sync |

## Commit message (both modes)
Follow the style of `git log --oneline -10`; with no clear style use Conventional Commits. Subject at
most 72 characters, imperative, with the task id when it is a tracker key; a short body says why.
Language: `repo_language`. No mention of AI, assistants or generated code; no co-author trailers for tools.
A **task handoff** commit's subject is "Work in progress: <title>", with the task id first when it
is a tracker key ("Work in progress: CAN-123 <title>"), the title shortened to keep the subject
within 72 characters; so the log shows the work is unfinished.

## Manual mode
**Manual mode** (`git.mode` is manual: what keel runs itself and what it hands the user as commands,
for a finish and for a handoff) → read `<keel>/skills/_shared/git-manual.md` and follow it instead of
"Autonomous mode".

## Autonomous mode
Each step is one command `node "<keel>/scripts/git-flow.js" "<project>" <step> ...`. Read the first
line: `ok` → next step; `stopped` or `unavailable` → tell the user the `reason:` and the detail lines
in plain words, say which steps are done and which are left, and stop git here. Never work around a
stop with raw git on your own. A **finish** whose task folder went to keel's trash adds
`--finish <id> --session <sid>` (from the calling command) to every `start`, `save` and
`push`: a step that stops then puts the task back by itself (`restored:` lines; say so). A ticket
the finish marked done goes back with it: `node "<keel>/scripts/plans.js" "<project>" done <id> --undo`.
1. `status`. Its line `autonomous on this machine: not confirmed` (or `settings changed`) → offer to run
   `node "<keel>/scripts/git-flow.js" "<project>" trust` now (the user confirms once in Claude Code's
   prompt), or each git step asks; on a yes run it yourself; never give the user a command with
   `<project>` or `<keel>` left in it. On the main branch (or the base) with changes → `start --name <branch>` (it carries the
   changes); not for a planned ticket on its feature branch (no `start`, see above), except its
   task handoff when the feature has 2 or more tickets (a new ticket branch, above). The branch is the one the instruction, the task file or the note
   names; only when none is named, make one as in `<keel>/skills/_shared/intake.md` step 6. An
   instruction naming another branch (e.g. `bug/FIX-123`) → `start --name <it>` (it carries the
   changes).
2. Write the message to `<project>/.keel/local/tmp/commit-message.txt`, then one call that commits,
   syncs, pushes and switches back: `save --message-file "<project>/.keel/local/tmp/commit-message.txt"`
   plus
   - **finish**: `--sync <base>`; end-session also passes `--tickets "<keys>"`. On the base itself
     (a planned ticket on its feature branch) the sync merges `<remote>/<base>`: the teammates'
     commits of that shared branch;
   - **handoff**: a task adds `--back-to <base>`, except when the instruction asks to merge: no
     `--back-to` then, merge in step 3 first, then `switch --name <base>`. A refused push shows as
     `push: refused (...)` and does not stop the handoff: say the work is on this machine only (a
     refused push: no merge, say so).

   First line `ok` → step 3. The script leaves out secret files and lists them: tell the user.
   `nothing to commit` is fine. In a **finish** the task folder went to keel's trash before this
   step, so its removal is in the commit. `stopped` → read `reason:`, `done:` and `left:`:
   - `conflict` → show the files. In a finish the commit already holds the task's removal, so nothing
     is put back (`restore: not needed ... committed`); after the resolve commit the finish goes on
     with `push`. Offer: resolve together now (on yes: `git merge origin/<base>`, or `<base>` without a
     remote; fix each file with the user, run the gates, commit, then `push`) or leave it to the user.
   - `sync merged N new commits ...; run the gates again before the push` → run the gates of
     verification step 2 again; green → `push`; red → show them; no push while they are red. Offer:
     fix them now (on yes: fix, run the gates, then `save` with a new message and the same options)
     or stop. With `--finish` the task's removal is committed but not pushed:
     "stop" puts the task back, `node "<keel>/scripts/notes.js" "<project>" task restore <id> --session <sid>`
     (and its ticket: `plans.js done <id> --undo`); say so: fix it, then /keel:end-task again.
   - a stopped commit or push → show why; `push` refused in a finish → stop.
3. **Merge** (a handoff that asks for it comes here), only as "Merging" above allows: say in one line
   "Merging <branch> into <target>. Claude Code will ask you to confirm." (the second sentence only
   when it will, as "Merging" says), then `merge --into <target>`. Declined → the branch stays
   pushed; say so.
   - `<target> is protected` → the merge was undone locally. Show the `pull request:` line and ask
     "Create the pull request now?"; only on yes run it, with a title and body from the task in
     `repo_language` and no mention of AI.
4. Report: commit, branch, pushed or not, merged or not, PR link.

## End of feature
**End of feature** (`done: feature <f> complete (<n> tickets)` after the push, or `/keel:tasks` offers
it: the last ticket of a planned feature is done and the feature branch may be merged) → read
`<keel>/skills/_shared/git-end-of-feature.md` and follow it.

## Never
Force-push, rebase pushed work, delete branches (only `/keel:tasks drop` does, with
`git-flow.js delete-branch`, which Claude Code confirms), except the feature branch in "End of
feature" above and the task's own branch in task-to-planning.md, each on its yes; commit
secret files, or commit to the main branch directly in autonomous mode.
