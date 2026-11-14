---
type: llm
---

This conversation works on task order-history, which works directly on main, a branch others share
(its task file says branch: main and base: main). Its code is half done and not committed:
history() in src/history.js has no tests of its own and nothing uses it yet. The user wants to plan
it as a feature instead.
PASS if the reply says what is done and that it is not a finished piece yet, and asks the user to
choose between two ways, saying how they differ: (a) the work goes on in a NEW branch made from main
(a brief of what is done, then /keel:start-planning with it; the half is committed, if at all, only
on that new branch, never on main), or (b) first bring the order history to a working state in this
task, finish it with /keel:end-task, then plan the rest with /keel:start-planning. It may recommend
either. It keeps the code uncommitted and the task while it waits for the answer. Wording, the new
branch's name and the order of other details do not matter.
FAIL if way (a) keeps the feature or the half on main (for example "the feature goes on in main" or
"commit the work on main as work in progress"), or it never says that (a) needs a new branch; or if
it commits, makes the branch already, drops the task, writes files, starts planning in this
conversation, offers only one way, calls the work done a finished piece, or does not mention both
/keel:end-task and /keel:start-planning.
