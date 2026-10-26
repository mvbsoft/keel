# keel preflight (first step of every keel command except configure)

`<keel>` below is the plugin folder the command gave you. The command placed the output of
`check-config.js` above. For this whole command: run every keel script (`node` with a file in keel's `scripts` folder)
as its own plain command with the full paths filled in, never joined with `;`, `&&`, pipes or
redirections; keel's permission hook lets only that form through without a prompt. In Bash, write a
path that starts with `\\` (a network or WSL share) with forward slashes: `//server/share/...`. Read and search
keel's own files with the Read, Grep and Glob tools, not with shell commands. Before each action (a
script, a git step, a file change, an agent), say in one short line what it is and what it will do.
An instruction you cannot read one way only: ask, never guess.

**A keel script refused by a project hook** (the refusal's reason does not start with `keel:`), for
example a guard that refuses `node` on this machine because the project's tools run in containers:
stop the command and do not run the script another way (`npx`, a container, a copy). Tell the user in
plain words that keel runs its scripts with `node` on this machine, like git, and that the project's
guard (named from the reason) refused it. Offer:
1. a narrow exception in that guard: `node` only when its first argument is a file in keel's
   `scripts` folder (`<keel>/scripts/`), with no `..` in the path; everything else stays refused.
   Show the change, write it on the user's yes, then run the script again and go on;
2. stop: keel cannot run in this project until the guard lets its scripts through.

No check output above (a policy can turn off the shell lines in skills): run
`node "<keel>/scripts/check-config.js" "<project>" --profile` yourself first. Act on the first line of
the check, then on a `git:` line:

- `keel-config: ok` → go on with the command. If a `profile:` line says `stale`, say in one line that
  the project changed since the last configure and that `/keel:configure check` says, without changing
  anything, which settings to update and why; do not block. `profile: missing` or `invalid` → say in one line that
  keel has no valid project scan, so the verification proposal does not see the project's security,
  data, docs and config paths (the specialist groups they would add), and offer the same re-scan
  after the command; do not block.
- `keel-config: unavailable` → tell the user the `reason:` line in plain words and stop. Nothing else
  runs.
- `keel-config: missing | broken | invalid | outdated` → the command cannot run yet:
  1. Say in one or two plain sentences why (from the `reason:` line), e.g. "This project has no keel
     settings yet, so /keel:start-task cannot run."
  2. Ask: "Configure now? It takes a few questions." (AskUserQuestion: Yes / No.)
  3. **Yes** → read `<keel>/skills/_shared/configure-flow.md` and follow it (`outdated` and `invalid`
     start in its repair path). When it has written a valid config, run
     `node "<keel>/scripts/check-config.js" "<project>"` again; if it now says `ok`, continue
     **this same command with its original arguments** from its next step. The user does not type
     the command again.
  4. **No** → say "Not configured, so the command did not run." and stop.
- `git: none` → keel needs a git repository (verification compares with it, each task has its
  branch). Say so in a plain sentence and offer `git init` and a first commit of the current state
  (AskUserQuestion: Yes / No). Yes → run `git init`; then, before anything is added, put every secret
  file that is not ignored yet (`.env*`, keys, credentials) into `.gitignore` and name them; then
  `git add -A` and `git commit -m "<Initial commit, in repo_language>"` (the user sees each command;
  Claude Code may ask), then go on with the command. No → stop.
  `git: not installed` → say that keel needs git and where to get it, and stop. `git: refused` → git
  does not trust the folder's owner: give its line in plain words (the command it names is git's own
  fix, run by the user) and stop.
