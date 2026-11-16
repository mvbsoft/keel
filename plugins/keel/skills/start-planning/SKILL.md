---
name: start-planning
description: Plan a feature in its own conversation - one question at a time, decisions and short tickets in its folder; continue a feature by name or your words. No code here. Finish with /keel:end-planning.
disable-model-invocation: true
argument-hint: "[idea | link | file | feature name | what to continue, in your words]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: start-planning

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`; a keel script's `project: <folder>` line (this session works in a worktree of it) replaces it from then on
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

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
2. **Lane.** This conversation ran `/keel:start-session` and no `/keel:end-session` since → say "This
   conversation leads a long-work line: end it with /keel:end-session, or plan in a new
   conversation." and stop. (keel's hooks already refuse planning in a task conversation and without
   a person.) Run `node "<keel>/scripts/notes.js" "<project>" check --session <sid>` (no `--begin`:
   that record is for tasks), then `node "<keel>/scripts/plans.js" "<project>" mark get --session <sid>`:
   `planning: <f>` → this conversation already plans `<f>`: one conversation, one feature; continue
   `<f>` (step 6), or end it with /keel:end-planning first.
3. Read `<keel>/skills/_shared/planning.md`, sections "Rules", "Work", "After ready" and "Several
   repositories"; they hold for the whole command. Run `plans.js settings`.
   `planning: planning is not set up ...` → before any question say: "Planning is not set up in this
   project yet: where new features live is shared with the team in `.keel/config.json`. Run
   `/keel:configure planning`, then `/keel:start-planning` again." and stop.
   Its `place:` line is where a new feature goes (`repo`: `<tickets_dir>/<f>/`, in git; `pc`: this
   machine only). The user may say otherwise for this feature ("this one off the repository") →
   `plans.js new <f> --place pc` (or `--place repo`) in step 5; the setting stays.
4. **Which feature**, from the instruction:
   - empty → `plans.js list`: show each feature (feature, state, open Q, tickets, last change, where)
     and ask which to continue, or what the new feature is; none → ask "What feature do we plan?"
     (an idea, a link, a file or your own words);
   - a feature's exact name → continue it (step 6);
   - a link or a file → a new feature from it (step 5; a brief
     `.keel/local/plans/briefs/<name>-brief.md`, written by /keel:start-task for a task too big for
     one: step 5 "From a brief");
   - other words → `plans.js find "<words>"`: `find: 1 match` → "Continue `<f>`?"; several → show
     them and ask which; `find: no match` → show the features it lists (if any) and ask: one of these, or a
     new feature from these words? None → "No feature matches, so this is a new feature. Right?"
   A chosen plan `done` or `abandoned` → say so; another feature or a new one.
5. **New feature.**
   - Say once, in one line: keel advises Opus for planning, since the plan shapes all the work after
     it; the model stays the user's choice (`/model`).
   - Source: a link → its connector tool (names with `atlassian`/`jira`, `linear`, `asana`, `google`,
     `notion`...; load deferred tools first), GitHub `gh issue view <link> --json title,body,labels,comments`,
     any other page WebFetch; a file → Read. Cannot read it → say so in one line and ask the user to
     paste the text. Never guess content.
   - Retell in a few lines: the goal, who gains, what is out. Check the premise in the code with a
     few searches: what the feature relies on exists and works as said (else say it, `file:line`).
   - **Which projects**: only with signs of another repository, planning.md "Several repositories"
     items 1 and 3.
   - Size: **small** (up to 5 questions, one conversation) or **large** (several conversations, each
     ended with /keel:end-planning). One goal, 1-3 sittings, one ticket → it looks like one task:
     suggest `/keel:start-task`; the user decides.
   - Name: propose 2-4 English words joined by `-`, `[a-z0-9-]`, at most 40 characters, starting with
     a letter, no digit right after a hyphen (`add-2fa` reads as the key `ADD-2`); what, not how
     (`s3-connection`). The user's word wins.
   - Main branch: run `git for-each-ref --format="%(refname:short)" refs/heads refs/remotes`. Several
     of main, master, develop, release/* (remote prefix dropped) → one question: "Where will this
     feature's tasks merge?"; otherwise say in one line that they merge into `git.main_branch`.
   - planning.md "Project rules" (the feature's place, the branch name).
   - A feature in the repository → planning.md "Branch hints".
   - `plans.js new <f> [--place repo|pc]` (`a feature "<f>" exists` → continue it or another name;
     `branch <f> exists and may hold this feature` → offer "Switch to `<f>`?": yes → `git switch <f>`,
     then `plans.js list` there and continue that feature (step 6); no → another name). A merge branch other
     than `git.main_branch`, or a branch name other than `<f>` → `plans.js set <f> --branch <b> --merge-into <m>` (`branch:` and `merge_into:` lines).
   - **From a brief**: what it settles is not asked again. The retell comes from its Goal, the name
     proposed is `<name>`, and a branch its Decisions and why names ("goes on in branch <b> and merges
     into <m>") replaces the main-branch question: after `plans.js new`, `plans.js set <f> --branch <b>
     --merge-into <m>`. Then `plans.js brief <f> <the brief>`: its sections go into `plan.md` (Goal →
     In plain words, Files → What was gathered, Decisions and why → Decisions, Open questions → Open
     questions) and the brief to keel's trash; say its lines.
6. **Continue a feature.** `plans.js check <f>` and `plans.js review <f>`; read `plan.md` only (not the
   tickets): the ticket list, open Q, What was gathered, Next action; and in `reviews/` the findings
   marked `undecided`: show them and ask for each decision (planning.md "Reviews", step 6).
   Stale? `plans.js stale <f>`: show its `stale:` lines as they are (one more per other repository).
   A stub whose repository is here now (check's `note: stub <T> can become a full ticket: ...`) →
   "Several repositories" item 6. A feature in the repository → planning.md
   "Branch hints". Then a summary in 3-6 lines and the Next action. A plan `ready` or `in-progress`
   keeps its status: name what needs review (`changed since review`, `- plan: changed since ready`)
   and ask "Review now?"; every edit follows planning.md "After ready".
7. `plans.js mark set <f> --session <sid>` → `planning: <f>`. Say in one line: this conversation now
   plans `<f>`; task and session commands wait for /keel:end-planning; no code changes here.
8. Work as planning.md "Work" says, from the Next action (new: the gathering offer when
   it fits, else the first open question; from a brief: first grow In plain words from its Goal into
   the whole feature, write it, and show its text in the reply, then its first open question). When the user
   wants to stop: "/keel:end-planning hands over, or reviews the tickets and marks the plan ready."
