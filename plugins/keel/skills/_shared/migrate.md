# keel migration (moving from another notes system)

Moves another tool's notes, memory and session logs into `.keel/`. Called from configure section 9,
or on its own with `/keel:configure migration` (the user may name a folder or a plugin). The caller
gives you `<keel>`, `<project>` and the language to talk in; files that go into the repository are
written in `repo_language`.

## Ground rules
- Nothing changes before the user's yes to the plan (step 4).
- Secret files are listed by path only: never opened, moved, deleted or quoted.
- Only two things are rewritten in other files: the **old folder path** and the **old command prefix**,
  both confirmed by the user. Product, variable and service names stay, also when they equal the
  folder's name (an "Orbit" product with an `.orbit/` folder keeps every "Orbit").
- Project data, documents, scripts and secrets of the old system stay where they are; only advice.
- Old note files are not deleted: they go to keel's trash (restorable) or to an archive, as the user
  picks.
- Run keel's scripts as one plain command each, exactly as written here.

## 1. Overview
Run `node "<keel>/scripts/migrate.js" "<project>" find` (add `--from "<folder or plugin>"` when the user
named one). The full result is in `<project>/.keel/local/tmp/migrate.json`.
- `no other notes or memory system found` → say so and stop.
- `earlier move:` → a move was interrupted: never start over. Read the plan file it names and check
  what is already there (`.keel/next-session.md`, `.keel/memory/project-memory.md`, edited references,
  the old config compared with keel's). Show the actions not done and the steps still open as the plan
  of step 4, ask one yes, then continue; `apply` skips what is done.

Then one `keel:context` agent call with numbered questions, the system folders and the secret paths
(never to be opened). Pass nothing else:
1. For each config file of the old system: what each setting means for keel (test commands,
   languages, AI attribution in commits, git habits, anything else), with `path:line`.
2. For each `notes rules` line: a rule of the old system that keel replaces, or a project rule to keep?
3. For each `unclear` entry: notes of the old system (moved with them) or project files (stay)?
4. The old commands (prefix, skill or command files): what each did, and the keel command that
   replaces it (end-task, end-session, start-session, start-task).
Fold the answers into the plan and say which came from the agent.

## 2. Config by meaning
Turn each meaningful setting into a proposal: "old: `language: uk` → keel: repository language uk".
Inside configure these are compared with the answers already given. On its own: the plan (step 4)
shows the exact change to `.keel/config.json` (and to machine settings, through
`claude-settings.js` as in configure section 10); its yes is the yes to write them, no second
question. Anything unclear is a question in the plan, not a guess.

## 3. References
Ask the user to confirm the old folder path and the old command prefix (`old command prefix (to
confirm)` from step 1; none when there is no plugin or command). Then run
`node "<keel>/scripts/migrate.js" "<project>" refs --folder "<old folder>" --prefix "<name>:"`
(the prefix without its leading slash; leave out what is not confirmed). For each line propose the new
text: the old folder's files map to `.keel/next-session.md`, `.keel/memory/`, `.keel/sessions/`; a
command maps to the keel command from step 1. The `left alone:` count is said as it is.

## 4. The plan to the user
One message, grouped, in plain words, sizes from step 1:
- **move**: session logs → `.keel/sessions/`; memory archives → `.keel/memory/project-memory-archive.md`;
- **convert**: the note → `.keel/next-session.md`; memory → `.keel/memory/project-memory.md`;
- **edit (with diff)**: each reference line, old and new; notes rules to remove or rewrite; the old
  session skills and commands to remove (two systems would give conflicting instructions);
- **stays**: project data, documents, scripts, unclear files the agent called project files, secrets,
  each with its advice line; unclear files the agent called notes of the old system are appended to
  the memory archive (keel has no other place for them: only the note, `memory/`, `sessions/` and
  `local/archive/`);
- **config**: each proposal from step 2 with the exact change;
- **old note files**: to keel's trash (recommended: their text is kept in the new files and the trash
  restores them for `cleanup.trash_max_age_days` days, 30 by default) or kept as an archive in
  `.keel/local/archive/<old folder>/`, outside git;
- a stale note: `mentions <sha> (<n> commits behind HEAD)` with n > 0 → warn that the work after it is
  not in the note.
Ask one question: do it all / change something. Nothing happens before a yes.

## 5. The note
Write `.keel/next-session.md` with the Write tool from `<keel>/templates/keel/next-session.md`: keel's
header (`status: active`, `branch` and `base` from git or `-`, `after_commit` = the commit the old
note mentions, else `-`, `date` today), then the old note's text under the template's sections
where they fit: its facts unchanged, its words translated into `repo_language` when it is written in
another language. Over 150 lines → keep the goal, where we are and the next steps; the plan
moves the whole old note to `.keel/sessions/<today>-000-old-note.md` and the new note says so.
Otherwise the old note goes to the trash or the archive (step 4).

## 6. Memory
- One old memory file within 150 lines → `.keel/memory/project-memory.md` from
  `<keel>/templates/keel/project-memory.md`, its facts kept (in `repo_language`, translated when the
  old file is in another language); the original goes to the trash or archive.
- Over 150 lines, or several files → the plan appends each to the archive (`append`), then write a new
  short `project-memory.md` with the active part: read only the start and the end of the old file
  (Read with `offset` and `limit`); the archive keeps everything.

## 7. Apply the moves
Write the confirmed actions to `<project>/.keel/local/tmp/migrate-plan.json`:
`{"source": "<old folder>", "actions": [{"op": "move", "from": "<old>/sessions", "to": ".keel/sessions"},
{"op": "append", "from": "<old>/memory/x.md", "to": ".keel/memory/project-memory-archive.md"},
{"op": "trash", "from": "<old>/next-session.md"}]}`; an archive uses `move` to
`.keel/local/archive/<old folder>/...`. Run
`node "<keel>/scripts/migrate.js" "<project>" apply "<project>/.keel/local/tmp/migrate-plan.json"`.
Claude Code asks the user before it runs; that is expected. Logs are moved by the script, never read
or rewritten by you. `refused:` lines → say why; `already done:` lines are a resumed run, not errors.
Denied → give the user the command for their own terminal. When it ran there (also on their own), run
`node "<keel>/scripts/migrate.js" "<project>" state`: its lines (with `possible secrets in moved text`)
stand for apply's output; then go on with step 8, so step 10 is never skipped.

## 8. References, rules and config
Make the confirmed edits with the Edit tool, exactly as shown in the plan. On its own (not inside
configure): write the config change from step 4 into `.keel/config.json` (Edit), then run
`node "<keel>/scripts/check-config.js" "<project>"` and fix it until it says `keel-config: ok`;
machine settings go through `claude-settings.js` as in configure section 10. Do not copy keel's own
instructions into CLAUDE.md or AGENTS.md: keel loads its standards itself.

## 9. This machine
For an enabled plugin the user confirmed as the old system (`enabled plugins:` from step 1), give the
command to run: `claude plugin disable <id> --scope <scope from step 1>`. keel never changes plugins
itself; keel is already enabled.

## 10. Secrets and git
- `possible secrets in moved text` → show each place and kind (never the value) and ask: remove the
  line (recommended) or keep it. When `gitleaks` is among `gates.security_scanners`, run it on
  `.keel/` as in verification.
- Git: inside configure, nothing now (section 12 covers the setup and the move together). On its own:
  manual mode → the changed files and a ready commit message; autonomous mode → follow
  `<keel>/skills/_shared/git.md` **handoff** with the branch `keel-migration`.

## 11. Advice for what stays
One line per `stays:` entry from step 1, e.g. "`adr/` is documentation: worth moving into `docs/` as a
separate task"; "`cloud-keys.env` is a secret: keep it out of the repository". Nothing is moved.

## 12. Old files
Already handled by the plan (trash or archive). Say where they are and how to bring them back from the
trash: `node "<keel>/scripts/cleanup.js" "<project>" restore <batch>`.

## 13. Check and report
Run `node "<keel>/scripts/notes.js" "<project>" check` (the note and memory read, within 150 lines),
`node "<keel>/scripts/migrate.js" "<project>" state` (finished) and `git status --short` in the
project folder (only the new `.keel/` files, the edited references and removed tracked old files).
When a question (a secret line, a config value) stopped you before this step, finish steps 10-13
after the answer. The report always has, in a few lines each:
- what moved where, and what stayed (step 11);
- the trash batch and the restore command;
- the old plugin's disable command (step 9), when there is one;
- git: on its own in manual mode the changed files and a ready commit message in `repo_language`;
  inside configure "the commit comes with the setup (section 12)";
- the offer: "`/keel:cleanup` can go through what the old system left (scripts, its config)".
