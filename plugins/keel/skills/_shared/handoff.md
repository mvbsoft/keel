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

`node "<keel>/scripts/notes.js" "<project>" check` reports presence, size (limit 150 lines and 12000 characters), `head:`, `today:`, whether
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
- **Where the work is**, in State: only what is certain before git runs: the branch (a task handoff
  without its own branch: the new branch git.md makes) and "committed
  together with this note" (manual git: "uncommitted: the user commits and pushes it on branch X").
  Never a push or merge result: git may stop or be declined; the report says what git did.
- **Files**: as steps finish, their files move from next to changed. Tests counted as "N new, M total".
- **Tried and did not work** also holds what the user rejected or what turned out wrong during the
  work (e.g. a separator the user said fails), with why; never "-" after such a change of course.
- A ✅ line names what is done (the behaviours of the acceptance criteria it covers), so the next
  session does not have to re-check them.
- **Update, do not rewrite**: change what changed, keep what still holds.
- Keep a sentence only if without it the next session would act differently.
- Facts come from `git log`, `git-flow.js status`, the verification and this conversation.
- At most 150 lines and 12000 characters (`notes.js check`). Over either → compress: done steps one line each, resolved
  questions out, from "Tried and did not work" only what could tempt a retry; a big task plan goes
  to `plan.md` in the task folder. Then check again.

## Write the note (end-session)
1. The line of work is the note's goal and plan plus what this session did.
2. `.keel/next-session.md` in the handoff format above:
   - `status`: `active`, `blocked` (waits for the user or someone else) or `done` (the user said the
     line is finished);
   - `branch`, `base`, `merge_into` and `execution` (and `keys`) from the old note, else from the git state
     (`-` when unknown, main branch for `base` / `merge_into`); a tracker key this line took on goes
     into `keys` only when `notes.js lane <key>` says `lane: none` (a task leads it otherwise: tell the user); `after_commit` and `date` from the `head:` and `today:` lines of the `notes.js check` the command ran (no separate git or date call);
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
**Resume** (`/keel:start-session` after `notes.js check --begin`: the cases for a note, an instruction,
a key or link, a plan file, a feature's tickets, a new line of work; the branch for a new line; "The
plan and its size") → read `<keel>/skills/_shared/handoff-resume.md` and follow it. Writing the note
(above) does not need it.
