---
name: tracker
description: Use when the user asks to link a planned ticket or feature (plan.md, tickets/T<n>) to an issue tracker such as Jira, Linear or Asana, to create its item there, or to move a whole planned feature into it.
---

# keel: tracker

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`

Talk in the language of keel's session-start line. A plan or a ticket is linked to the team's tracker
by two front matter lines, `tracker: <key>` (such as `CAN-44201`) and `tracker_url: <link>`, written
only when the user asks. They change no state and no review mark, and keel never reads or writes a
status in the tracker. An elsewhere ticket's lines go into its file in its repository.

0. **The files**: `node "<keel>/scripts/plans.js" "<project>" tickets <feature>/T<n>` prints the
   ticket's `file:`; the plan is `plan.md` in the folder `plans.js list` names. No feature named →
   `plans.js list` and ask which.
1. **Link** ("here is the link to T3", "the plan is CAN-44201"): write both lines into that file's
   front matter (Edit), one plain line each.
2. **Create one item** ("create T3 in Jira"): it needs a connected, signed-in tracker connector (tool
   names with `atlassian`/`jira`, `linear`, `asana`...; load deferred tools first); none → say so and
   stop. First search the tracker by the title: a match → show it and ask whether it is this one (yes
   → item 1). Else ask only what the files do not say (the project, the item type), create it with the
   title and the In plain words, Goal and Acceptance criteria, and write its two lines at once.
3. **Move the whole feature**: read `plan.md` and every ticket, then ask in one message only what the
   files do not say (the project, the type of the plan's item and of the tickets', fix version,
   sprint, assignee, labels). The plan first, then each ticket by its number, each as item 2: search
   by title, create, write its lines right after it is created. A file that has `tracker:` already is
   skipped, so a second run makes no duplicate. Then each `depends_on` becomes a "blocks" link
   (`depends_on: T1` in T3 → T1 blocks T3). A failure → stop and say what was created and what is
   left: the same request again goes on from there.
4. The lines go into git with the feature folder: in a planning conversation as its "Commit and push"
   says; elsewhere, for a feature in the repository (not under `.keel/local/`), offer
   `plans.js commit <feature>` and `plans.js push <feature>` (Claude Code asks each).
