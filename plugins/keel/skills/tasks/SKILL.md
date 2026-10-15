---
name: tasks
description: List the unfinished tasks (source, state, steps, branch, next action, files), show one, or drop one - everything it left is listed and you choose what goes. Tasks start with /keel:start-task.
disable-model-invocation: true
argument-hint: "[<task id> | drop <task id>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: tasks

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (empty: the list; `<task id>`: its details; `drop <task id>`: remove it and what it left)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. Run `node "<keel>/scripts/notes.js" "<project>" tasks --session <sid>`. Each block is one task (this
   working tree and every branch).
3. No argument: show each block as printed (`<id> · <title>`, then Source, State, Next, Files, and
   Base moved when present; not the Goal line), its labels and words in the conversation language;
   ids, links, branches and paths stay as they are. A task handed off 30 days ago or more → offer
   `/keel:tasks drop <id>`, or `/keel:start-task <id>` then `/keel:end-task` to finish it; say nothing
   about age otherwise. End with: "Continue one with `/keel:start-task <id>`." No tasks → say so.
4. `<task id>`: show its block, then read its `task.md` (and `plan.md`): in this working tree from the
   path in Files; on another branch: `git show <branch>:<path>/task.md`. Tell its goal, state,
   open questions and next action in 3-6 lines. An id that is not listed → say so and show the list.
5. `drop <task id>`: run `node "<keel>/scripts/notes.js" "<project>" task inventory <id>` and explain in
   plain words what the task left: its folder, the branch (local, pushed), the commits not in the base,
   the changed code and the docs among it. Ask what to remove: everything or which parts. Then each
   destructive action on its own, the folder first. Claude Code itself asks the user to confirm the
   folder and the branch (keel's hook): say so in one line before each; a declined or denied call is
   the user's "no" for that part: never run it again or another way, say what stays and go on:
   - the task folder → `node "<keel>/scripts/notes.js" "<project>" task drop <id>` (to keel's trash;
     `/keel:cleanup restore <batch>` brings it back, with the batch from its `trash batch:` line). A refusal `... switch to it first` → switch to its branch
     (as `<keel>/skills/_shared/intake.md` "Before any branch change" says), then drop it. The folder
     was in git and its branch stays → commit the removal on that branch (autonomous:
     `git-flow.js commit` with the message "keel: drop <id>", then `push` when the branch was pushed;
     manual: give the commands), else the task is still listed from that branch; the user also
     removes that branch → no commit (the folder goes with it). Then switch back to the branch the
     user was on;
   - the branch → `node "<keel>/scripts/git-flow.js" "<project>" delete-branch --name <branch>`, with
     `--remote` when it was pushed (it refuses the main branch and the current one: switch away
     first; its `deleted:` line says how to bring the local branch back);
   - changes already in the base branch → only `git revert` of the named commits (after the user's
     yes in the chat), never a history rewrite.
   Manual git mode: keel runs none of the git commands above (commit, branch delete, revert): give
   them ready to copy (`git branch -D <branch>`, `git push origin --delete <branch>`) and wait until
   the user says they ran.
   Say after each what is gone and what stays.
