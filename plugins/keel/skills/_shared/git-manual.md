# keel git: manual mode (read from git.md "Manual mode")

The calling command and the ending are the ones git.md describes; "Autonomous mode" below and the
planned-ticket rules "above" are sections of `<keel>/skills/_shared/git.md`.

Run no git step the user did not ask for. When the instruction or the user's answer to a keel question
asks for one ("push", "commit", "merge into main", a branch choice), run each such step as its own
`git-flow.js` command (`commit --message-file ...`, `push`, `sync --from <base>`, `switch --name <base>`, as in
git.md "Autonomous mode"); `save` only when they asked for commit and push together. Claude Code asks
before each, since autonomous git is not confirmed; everything else stays with the user. Give the user:
- the changed files (from `node "<keel>/scripts/git-flow.js" "<project>" status`);
- the commit message, ready to copy;
- **finish**: the task folder's removal (it is in keel's trash) is part of that commit; then merge as
  they usually do (a planned ticket: into its plan's branch, never the plan's branch itself, see
  git.md above; its ticket file and `plan.md` go into that commit);
- **handoff of a task**: commit the work and the task folder on the task branch, push it,
  then `git switch <base>`. A task without its own branch: first `git switch -c <id>-<short-name>`
  (it carries the changes; a planned ticket: `<plan's branch>-<t>`, as git.md above says); keel runs
  no `start` here, so set the task file's `branch:` to that new branch before the task file is
  written;
- **handoff of a session**: "Commit and push when convenient; the note is part of the commit" (when
  `git.state_in_git`).
