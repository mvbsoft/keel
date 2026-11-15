---
type: llm
---

This conversation works on task order-history, which works directly on main, a branch others share
(its task file says branch: main and base: main). Its code is half done and not committed:
history() in src/history.js. The user asked to hand the task off, with no instruction about git.
PASS if the run handed the task off without asking where the work goes: it made a NEW branch from
main (its name starts with order-history-), committed the work there as work in progress, pushed that
branch and went back to main, and its reply names the new branch and says the work is pushed (or, if
the push was refused, says the work is on this machine only). The task file's state and the gates'
result may be worded any way.
FAIL if it asks the user where the work goes or offers to leave the changes uncommitted or in a
stash; if it commits or pushes on main; if it finishes or deletes the task; or if it never says which
branch holds the work.
