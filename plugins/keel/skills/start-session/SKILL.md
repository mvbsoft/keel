---
name: start-session
description: Continue long work from the note in .keel/next-session.md, or start a line of work from a plan file, a link or a description. Single tasks: /keel:start-task. Finish with /keel:end-session.
disable-model-invocation: true
argument-hint: "[plan file | feature | link | description | how to continue, e.g. only write the tests]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: start-session

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`; a keel script's `project: <folder>` line (this session works in a worktree of it) replaces it from then on
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS` (empty: continue from the note, or find
  work; a plan file, a feature's planned tickets, a link or a description starts a new line; anything
  else says how to continue)

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
2. Run `node "<keel>/scripts/notes.js" "<project>" check --begin --session <sid>`.
3. Read `<keel>/skills/_shared/handoff-resume.md` and act on the case that fits.
