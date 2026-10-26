# keel session note (between sessions: /keel:start-session, /keel:end-session)

The calling command gives you `<keel>`, `<project>` and the language to talk in. This lane is for
long work in one direction, session after session; it uses only the note, never the task files
(`/keel:start-task` and `/keel:end-task` own those; ignore the `tasks:` line of `notes.js check`
except where a case below says otherwise). These files go into git, so they are written in
`.keel/config.json` `repo_language` (the team's language), from the templates in `<keel>/templates/keel/`:
- `.keel/next-session.md`: the note for the next session (`next-session.md`);
- `.keel/memory/project-memory.md`: short project memory (`project-memory.md`), resolved items move to
  `.keel/memory/project-memory-archive.md`;
- `.keel/sessions/<name from notes.js>.md`: one log per long-work session (`session-log.md`).

`node "<keel>/scripts/notes.js" "<project>" check` reports presence, size (limit 150 lines), whether
the note is behind the repository, and the next session log name.

## The handoff format (the note and a task's task.md)
The next session knows only this file, the git history and the code. Sections in the template's
order, the most important first: **Goal**, **Next action** (one concrete step), **State** (✅ done and
verified / ◐ in progress / ⚠ broken / ⬜ not started, one line each), **Files** (changed / important
read / next), **Decisions and why**, **Tried and did not work**, **Open questions**, **How to check**
(a command). The note also keeps the long **Plan** and **Later**. Header: `after_commit` (HEAD while
writing: a file cannot name the commit it is in, so its own commit follows), `branch`, the date.
- **Language**: the note, `repo_language`. A task's task.md and a plan.md in its folder:
  `repo_language` when `tasks.in_git` is not false (they go into git), else the conversation
  language. Headings and front-matter keys stay in English.
- Never passwords, keys, tokens, connection strings or personal data.
- **Where the work is**, in State: only what is certain before git runs: the branch and "committed
  together with this note" (manual git: "uncommitted: the user commits it on branch X"; a stash: its
  name). Never a push or merge result: git may stop or be declined; the report says what git did.
- **Files**: as steps finish, their files move from next to changed. Tests counted as "N new, M total".
- **Tried and did not work** also holds what the user rejected or what turned out wrong during the
  work (e.g. a separator the user said fails), with why; never "-" after such a change of course.
- A ✅ line names what is done (the behaviours of the acceptance criteria it covers), so the next
  session does not have to re-check them.
- **Update, do not rewrite**: change what changed, keep what still holds.
- Keep a sentence only if without it the next session would act differently.
- Facts come from `git log`, `git-flow.js status`, the verification and this conversation.
- At most 150 lines (`notes.js check`). Over it → compress: done steps one line each, resolved
  questions out, from "Tried and did not work" only what could tempt a retry; a big task plan goes
  to `plan.md` in the task folder. Then check again.

## Write the note (end-session)
1. The line of work is the note's goal and plan plus what this session did.
2. `.keel/next-session.md` in the handoff format above:
   - `status`: `active`, `blocked` (waits for the user or someone else) or `done` (the user said the
     line is finished);
   - `branch`, `base`, `merge_into` and `execution` (and `keys`) from the old note, else from the git state
     (`-` when unknown, main branch for `base` / `merge_into`); a tracker key this line took on goes
     into `keys` only when `notes.js lane <key>` says `lane: none` (a task leads it otherwise: tell the user); `after_commit` = `git rev-parse --short HEAD` now; `date` = today;
   - **Plan**: the line's plan with each step marked (plan files under `.keel/local/` are not in git);
     a plan with step blocks: paste them in `repo_language`
     (translate the text when the plan is in another language), keeping their shape: level-3 headings "<word> <n>: <title>", the fields in
     order, and the status symbols ⬜ / ✅ / ◐ <n>% / ⚠, so the next session can count and delegate;
   - **Later**: keep the old items that are still open, add the ones found during this work for the
     future (one line each, with why); an item that moved into the Plan or was done leaves the list;
   - **Next action**: one concrete step; a finished line → "none: this line of work is finished".
3. Memory: update **Active context**; add a decision only when its reason would otherwise be lost.
   Keep it short; over the limit → move resolved items to the archive.
4. Write the session log.
5. Run `notes.js check`; anything `over the limit` → compress as above, then check again. A
   `lane conflict:` line → take that key out of the note's `keys` and tell the user which task leads it.

Order with git: when `git.state_in_git` is true, write these files **before** the git step so they
go into the commit; otherwise write them after it.

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
| `note branch` differs from the current branch (autonomous git) | `git-flow.js switch --name <branch>`; `stopped` (uncommitted changes) → ask what to do with them |
| `status: blocked` | show the open questions first; continue once they are answered |
| no note (or `status: done`) + a path to a plan file | a new line of work: read the file; write the note from the template with its items as the **Plan** (steps ⬜; a file with step blocks keeps their shape) and its goal as **Goal**; **Later** empty; show it and ask "Start?"; then the git branch for the line (below) |
| no note (or `status: done`) + a feature's name or folder (planned tickets: "do these tickets one by one") | run `node "<keel>/scripts/plans.js" "<project>" tickets <feature>` (a folder: its last part; `tickets: none (no ticket or feature <x>)` → not a feature: the rows below). A new line of work: the **Plan** is its tickets marked `next` or `to do`, the `next` one first, then each after the tickets it depends on, one ⬜ step each (`<KEY> <title>`); `keys` = those keys (each must give `lane: none`); `branch` and `base` = the feature branch (its `branch: <b> -> <merge_into>` line), `merge_into` = its `merge_into`. Tickets `in progress` or `waiting for ...` are listed with their hints and the user decides whether any goes into the Plan. Show it and ask "Start?"; the branch: `git-flow.js switch --name <b>` (missing: `start --name <b>` from the ref that has the tickets) |
| no note (or `status: done`) + a description | a new line of work: follow `<keel>/skills/_shared/intake.md` steps 3, 5 and 6 (retell, the brainstorm offer or questions, plan) with the description, but from step 3 only the retell and the premise check: no "new or continuation", never a task; the plan becomes the note's **Plan** as in the row above (plan.md's Execution steps for a session) |
| no note (or `status: done`), no instruction | look in the project for work: memory's Active context, plan files, TODO markers in recently changed files, unfinished work in `git status`; propose 1-3 briefly. Nothing → "There is no work for a session; tell me what to do." `tasks:` shows unfinished tasks → add "There are unfinished tasks: /keel:tasks shows them, /keel:start-task continues one." Never start a task yourself |
| a note + "do it through subagents" (or "delegate") | summary as above; then follow `<keel>/skills/_shared/delegate.md` with the plan (below) |

**Which lane** for a new line: "done" in 1-3 sittings → a task; a plan for weeks with "later" items →
a session. A new line that clearly fits a task → suggest `/keel:start-task` in one line; the user decides.

**Git branch for a new line.** Autonomous: `git-flow.js start --name <short-name>` (2-4 lowercase
words joined by `-`; from `git.main_branch` unless the user named another base). Manual: give
`git switch -c <short-name>` and wait. Uncommitted changes → ask first, never carry them silently.

**The plan and its size.** The note's Plan holds the line's steps. Run
`node "<keel>/scripts/plan-steps.js" "<project>" "<file with the steps>" --remaining`.
- `suggest: delegate` and the user did not say how → after the summary ask its `ask:` line (in the
  conversation language); also say what this session can cover.
- Steps without files, model, effort or "done when" (`problems`) and the work is delegated → first
  complete those steps in the plan (they are yours to write), then show the step table to confirm.
- The note says `execution: delegate` → keep delegating unless the user says otherwise.

At the end the user runs `/keel:end-session`, with an instruction when they want one (e.g. "push and
merge into main", "we continue tomorrow, prepare").
