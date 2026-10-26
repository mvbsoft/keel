---
name: help
description: Show keel's commands in a short table - what each does, how to run it, one example.
disable-model-invocation: true
---

# keel: help

Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)

Show this table translated into that language (commands, ids and quoted examples stay as they are),
then two lines: "Tasks are separate jobs with a clear end; sessions are one long line of work, day
after day; planning turns a feature into short tickets, with no code." and "One conversation, one
lane: a planning conversation refuses the task and session commands, and a task conversation refuses
planning." Nothing else: run nothing, read nothing.

| Command | What it does | Example |
|---|---|---|
| `/keel:start-task <link, key or words>` | starts a task (bug, ticket, small feature) or continues one: retells it, asks "new or continuation?", plans, then codes | `/keel:start-task https://jira.example.com/browse/CAN-123` |
| `/keel:end-task [instruction]` | finishes the task (verification, git, its folder moved to keel's trash) or hands it off for another session; no instruction: a menu | `/keel:end-task finish and merge into main` |
| `/keel:tasks [id \| drop id]` | lists the unfinished tasks, shows one, or drops one with what it left | `/keel:tasks drop fix-reset-500` |
| `/keel:start-session [instruction]` | continues the long line of work from its note, or starts one from a plan, a link or a description | `/keel:start-session only write the tests today` |
| `/keel:end-session [instruction]` | verifies, writes the note for the next session, then git and the action you name | `/keel:end-session we continue tomorrow, prepare` |
| `/keel:start-planning [idea, link, file or feature]` | plans a feature in its own conversation: one question at a time, decisions and short tickets in a draft, no code; no argument lists the drafts | `/keel:start-planning CSV export of invoices` |
| `/keel:end-planning [instruction]` | hands the plan over to continue later, or reviews the tickets and the plan and exports the tickets into the feature folder; git only with your yes | `/keel:end-planning we continue tomorrow` |
| `/keel:configure [check \| section,...]` | sets up or changes keel for this project; `check` says what to reconfigure and why, changing no setting | `/keel:configure check` |
| `/keel:cleanup` | finds leftovers and moves the ones you pick to keel's trash, with an undo | `/keel:cleanup restore` |
| `/keel:usage` | gives the link to your private usage page (what each session cost) and opens it | `/keel:usage` |
| `/keel:usage-clear` | deletes all data on the usage page, after a warning and your yes | `/keel:usage-clear` |
| `/keel:help` | this table | `/keel:help` |
