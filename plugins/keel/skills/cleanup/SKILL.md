---
name: cleanup
description: Find leftovers (temporary files, backups, caches, what an old notes system left) and move the ones you pick to keel's trash, with the tests run and an undo.
disable-model-invocation: true
argument-hint: "[empty-trash | restore [batch]]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: cleanup

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`; a keel script's `project: <folder>` line (this session works in a worktree of it) replaces it from then on
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (`empty-trash`: delete old trash for good; `restore`: put a batch back)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. The state above is exactly the two lines `keel-config: ok` and `profile: ok`, with no other line
   → go on without reading preflight.md. Any other line (such as `git: refused`), or no state above → read `<keel>/skills/_shared/preflight.md` and
   act on it. These rules hold for this whole command. Run every keel script (`node` with a file in
   keel's `scripts` folder) as its own plain command with full paths, never joined with `;`, `&&`,
   pipes or redirections. In Bash write a path that starts with `\\` as `//server/share/...`. Read
   keel's own files with Read, Grep and Glob, not the shell. Before each action say in one short
   line what it will do. An instruction you cannot read one way only: ask, never guess. Steps that
   need nothing from each other's output may go in one message as separate calls, where the command
   says so. A keel script refused by a project hook: follow preflight.md's rule for it.
2. Nothing is deleted here: picked items move to `.keel/local/trash/<batch>/` and can be put back.
   Secret files are never moved or opened.
3. With `empty-trash`: run `node "<keel>/scripts/cleanup.js" "<project>" trash`, say what would go
   for good (batches `cleanup.trash_max_age_days` days old or more, or the one batch the user names, or all) and
   "Claude Code will now ask you to confirm", then run
   `node "<keel>/scripts/cleanup.js" "<project>" empty-trash` (add `--batch <b>` or `--all` when asked).
   Do not ask in the chat as well: Claude Code's confirmation is the question. Declined or denied →
   nothing was deleted; say so and never run it again or another way. Stop.
4. With `restore`: run `node "<keel>/scripts/cleanup.js" "<project>" restore` (add the batch when named)
   and report what came back. Stop.
5. Otherwise run `node "<keel>/scripts/cleanup.js" "<project>" find`. The user does not see the script's
   output, so a question about numbers alone means nothing to them. Your reply to this step is the list
   itself: every item with its number, path, why and size, as it came, grouped:
   - 🟢 **safe**: preselected;
   - 🟡 **check**: added only by number;
   - 🔴 **do not touch**: only by number, and then a second question per item saying what may break
     (project data, a file something references, a large folder that takes long to rebuild).
   Explain each group in one plain sentence. The last line of that same message is the question, as
   plain text: "Move the safe ones? Add numbers from the other groups, or remove numbers." Do not use
   AskUserQuestion here: its dialog covers the chat, and a reply without the list leaves the user
   choosing numbers they cannot see. Wait for the typed answer. `nothing to clean up` → say so and
   stop. The trash is emptied only when the user asks (`/keel:cleanup empty-trash`): never offer it.
6. From the typed answer (a plain yes is the 🟢 numbers), run
   `node "<keel>/scripts/cleanup.js" "<project>" move --items <numbers>` (add `--red <numbers>` for
   🔴 items confirmed by the second question).
7. `gates: needed` → run the gates as in verification step 2 (`.keel/config.json` `gates.checks`,
   every part; long output to `<project>/.keel/local/tmp/gates/`). `gates: not needed` → skip.
   - All green → done.
   - Red → `node "<keel>/scripts/cleanup.js" "<project>" restore <batch>`, then run the gates again.
     Green now → the cleanup broke them: say which batch came back and keep it restored. Still red →
     the failure is older than the cleanup: say so and ask whether to move the items again (run
     `find` again first: the numbers may change).
8. Report in a few lines: what moved (and its size), where the trash is, files from git that now show
   as deleted (they go into the next commit as a normal change), the gate result, and how to undo:
   `/keel:cleanup restore`.
