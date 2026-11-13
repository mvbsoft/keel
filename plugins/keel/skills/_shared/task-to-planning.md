# keel intake: a task that is too big becomes planning (read from intake.md "Task to planning")

The calling command gives you `<keel>`, `<project>` and the language. "Step 3" and "step 7 item 2"
below are parts of `<keel>/skills/_shared/intake.md`.

The task is too big (step 3): keel offers to plan it as a feature, in one question. Lanes never mix:
the task ends completely before planning starts. keel cannot type a command for the user: it names
the command, the user types it. The user asking to split it or to plan it as a feature, in any words,
is the yes: do not ask whether, and leave "do not split" out; a place they name ("in a new chat")
answers the question as well.
**No code changed yet**: no `task new` yet (step 7 item 2), or after it `git diff --name-only <started>`
(the task file's `started:`) and `git ls-files --others --exclude-standard` list nothing outside
`.keel/`. Ask, with the size the plan gives: "This is too big for one task: ~12 steps, 3 modules. It
is best planned as a feature with keel's planning: it splits the work into tickets, reviews them and
moves them into the project. How do we go on? 1) A new chat (recommended when this one is long): I
write what we found into a file and give you the command. 2) Plan here: you type
`/keel:start-planning` in this chat. 3) Do not split: one task. Or say how else." After the user
asked to split it, the same question has only 1), 2) and "Or say how else.": no "do not split".
- **New chat** → write the brief (below), then the task leaves (below), then: "Open a new chat in this
  project and type: `/keel:start-planning .keel/local/plans/briefs/<name>-brief.md`. Planning starts
  from the open questions and does not ask again what is settled."
- **Here** → the task leaves (below), then ask the user to type `/keel:start-planning`; the plan in
  this chat is its source. No brief.
- **Do not split** → it stays one task. Record it in task.md, Decisions and why ("Not split into a
  feature: the user's choice"; before `task new`, when step 7 item 2 writes the file; in Plan Mode
  also in the plan's Execution step 4, which item 2 copies, so it survives "Yes, clear context"), so
  that neither this conversation nor a resume of the task offers it again. Only for this task: the
  next one is asked anew.
- **The task leaves**: no `task new` yet → nothing to do. After it: say "<id> goes to keel's trash"
  and run `node "<keel>/scripts/notes.js" "<project>" task drop <id>`. A branch of
  its own (`branch` differs from `base`) is deleted only on its own yes:
  `node "<keel>/scripts/git-flow.js" "<project>" switch --name <base>`, then
  `node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>` (Claude Code confirms).

**Code changed**: say what is done and whether it works on its own, advise by that, and ask one
question, which way; the user decides. Name the commands the user will type in each way. What the
rest still needs to know goes into the brief as an open question, not into a question now.
- It works on its own: the work done is a finished piece with tests of its own, and they pass (run
  them), such as "the message.created event in the backend" with its tests, even when nothing uses it
  yet → advise to finish it as a task and plan the rest. The brief of the rest is written now,
  in this chat, before `/keel:end-task` (which ends the lane). Then the user types `/keel:end-task`
  (the ordinary verification, commit and merge), then `/keel:start-planning
  .keel/local/plans/briefs/<name>-brief.md`.
- Anything else (no tests of its own yet, or a part it needs is missing) is half of something →
  offer both ways and say how they differ:
  (a) **the work goes on in a branch of its own, the feature's branch**: the task's `branch` when it
  differs from `base`. A task working directly on a shared branch (`branch` is `base`: the main
  branch, or a planned ticket's feature branch) gets a new one from `<base>`, `<KEY>-<short-name>` for
  a planned ticket, else `<name>`, so a half never lands in a shared branch. The brief says "already
  done on branch <branch>: ..." and that the feature goes on in `<branch>` and merges into the task's
  `merge_into` (a new branch: into `<base>`). Then say "<id> goes to keel's trash
  (its code and branch stay)" and run `task drop <id>` (as above, never the branch). Then, with no
  question (unfinished work never stays on this machine only, git.md; manual git: give these steps as
  commands):
  a new branch first, `node "<keel>/scripts/git-flow.js" "<project>" start --name <branch> --from
  <base>` (it carries the changes); commit and push as `<keel>/skills/_shared/git.md` step 2 does for a
  handoff (`save`, no `--back-to`), with the subject git.md gives a task handoff ("Work in progress:
  <title>"), so the task's removal is in that commit and another machine sees it. Then the user types
  `/keel:start-planning .keel/local/plans/briefs/<name>-brief.md`; its first ticket goes on in
  `<branch>`. (b) **finish first**: bring the half to a working state in
  this task (tests pass, a finished piece), finish it with `/keel:end-task`, and plan the rest with a
  brief as above (`/keel:start-planning .keel/local/plans/briefs/<name>-brief.md`). (a) keeps
  the work going without merging a half; (b) keeps keel's usual path, at the cost of a few more turns
  in this long chat.

**The brief** `.keel/local/plans/briefs/<name>-brief.md` (Write; on this machine only; in a worktree,
under the main checkout a script's `project:` line names, so a new chat finds it), `<name>` the
feature name start-planning would propose (2-4 English words joined by `-`, `[a-z0-9-]`, at most 40
characters, starting with a letter, no digit right after a hyphen; a file of that name exists →
another name). In the plan's language (`planning.language` of `.keel/config.json`, else
`repo_language`): its text moves into the plan as it is. Four sections of handoff.md "The handoff
format", headings in English, everything this conversation settled and nothing more:
- `## Goal`: the feature in a few sentences: what changes, for whom, and why;
- `## Files`: what was found, `file:line` and what it has to do with the feature; work already done:
  its branch and state;
- `## Decisions and why`: `- decision - why`, one per line; the branch case (a): "- The feature goes on
  in branch <branch> and merges into <merge_into> - already done there: ...";
- `## Open questions`: `- question - what depends on it`, one per line; none → the section stays
  empty.
