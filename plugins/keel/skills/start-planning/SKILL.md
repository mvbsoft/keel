---
name: start-planning
description: Plan a feature in its own conversation - one question at a time, decisions and short tickets in a draft; continue a draft by name or your words. No code here. Finish with /keel:end-planning.
disable-model-invocation: true
argument-hint: "[idea | link | file | feature name | what to continue, in your words]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *)
---

# keel: start-planning

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- The user's instruction (arguments, free text): `$ARGUMENTS`

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. **Lane.** This conversation ran `/keel:start-session` and no `/keel:end-session` since → say "This
   conversation leads a long-work line: end it with /keel:end-session, or plan in a new
   conversation." and stop. (keel's hooks already refuse planning in a task conversation and without
   a person.) Run `node "<keel>/scripts/notes.js" "<project>" check --session <sid>` (no `--begin`:
   that record is for tasks), then `node "<keel>/scripts/plans.js" "<project>" mark get --session <sid>`:
   `planning: <f>` → this conversation already plans `<f>`: one conversation, one feature; continue
   `<f>` (step 6; an exported feature, told apart as in step 4: planning.md "Exported feature" steps
   3-6), or end it with /keel:end-planning first.
3. Read `<keel>/skills/_shared/planning.md`, sections "Rules" and "Work"; they hold for the whole
   command (an exported feature: also "Exported feature"). Run `plans.js settings`.
   `settings: none yet` → two questions, one per message: the
   tickets' language (default: its `language:` line), then where the draft lives: on this machine
   (default, outside git) or in the repository (folder `tickets`, or a ticket folder the project
   already has; colleagues see it through git). Save with
   `plans.js settings set --language <l> --draft <pc|repo> [--draft-dir <dir>]`. A change the user
   names at any start ("draft in the repo") → the same command.
4. **Which feature**, from the instruction:
   - empty → `plans.js list`: show each draft (feature, state, open Q, tickets, last change, where)
     and ask which to continue, or what the new feature is; no drafts → ask "What feature do we plan?"
     (an idea, a link, a file or your own words);
   - a draft's exact name → continue it (step 6);
   - a link or a file → a new feature from it (step 5);
   - a single name with no draft → `plans.js tickets <it>` first: it lists tickets → an exported
     feature (below); `tickets: none ...` → the next case;
   - other words → `plans.js find <words>`: `find: 1 match` → "Continue `<f>`?"; several → show them
     and ask which; `find: no match` → show the drafts it lists (if any) and ask: one of these, or a
     new feature from these words? No drafts → "No draft matches, so this is a new feature. Right?"
   A chosen plan that is `exported`, or a name `plans.js tickets <f>` lists tickets for (an exported
   feature without a draft) → its tickets live in the feature folder: planning.md "Exported feature"
   steps 1-2, then step 7, then its steps 3-6 as the work (not steps 5, 6 and 8). `abandoned` → say
   so; another draft or a new feature.
5. **New feature.**
   - Source: a link → its connector tool (names with `atlassian`/`jira`, `linear`, `asana`, `google`,
     `notion`...; load deferred tools first), GitHub `gh issue view <link> --json title,body,labels,comments`,
     any other page WebFetch; a file → Read. Cannot read it → say so in one line and ask the user to
     paste the text. Never guess content.
   - Retell in a few lines: the goal, who gains, what is out. Check the premise in the code with a
     few searches: what the feature relies on exists and works as said (else say it, `file:line`).
   - Size: **small** (up to 5 questions, one conversation) or **large** (several conversations, each
     ended with /keel:end-planning). One goal, 1-3 sittings, one ticket → it looks like one task:
     suggest `/keel:start-task`; the user decides.
   - Name: propose 2-4 English words joined by `-`, `[a-z0-9-]`, at most 40 characters, starting with
     a letter, no digit right after a hyphen (`add-2fa` reads as the key `ADD-2`); what, not how
     (`s3-connection`). The user's word wins.
   - Main branch: run `git for-each-ref --format="%(refname:short)" refs/heads refs/remotes`. Several
     of main, master, develop, release/* (remote prefix dropped) → one question: "Where will this
     feature's tasks merge?"; otherwise say in one line that they merge into `git.main_branch`.
   - planning.md "Project rules" (the draft's place, the branch name).
   - A repository draft → planning.md "Branch hints".
   - `plans.js new <f>` (`a draft "<f>" exists` → continue it or another name; `branch <f> exists and
     may hold this draft` → offer "Switch to `<f>`?": yes → `git switch <f>`, then `plans.js list`
     there and continue that draft (step 6); no → another name). A merge branch other
     than `git.main_branch`, or a branch name other than `<f>` → `plans.js set <f> --branch <b> --merge-into <m>` (`branch:` and `merge_into:` lines).
6. **Continue a draft.** `plans.js check <f>` and `plans.js review <f>`; read `plan.md` only (not the
   tickets): the ticket list, open Q, Next action; and in `reviews/` the findings without a decision.
   Stale? `plans.js stale <f>`: show its `stale:` line as it is. A repository draft → planning.md
   "Branch hints". Then a summary in 3-6 lines and the Next action. A `ready` plan: any change makes it a draft again.
7. `plans.js mark set <f> --session <sid>` → `planning: <f>` (an exported feature:
   `planning: <f> (exported: <folder>)`). Say in one line: this conversation now
   plans `<f>`; task and session commands wait for /keel:end-planning; no code changes here.
8. Work as planning.md "Work" says, from the Next action (new: the first open question). When the user
   wants to stop: "/keel:end-planning hands over, or reviews and exports the tickets."
