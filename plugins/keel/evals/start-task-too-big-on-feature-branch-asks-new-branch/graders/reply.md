---
type: llm
---

This conversation works on task INV-1, a planned ticket of the csv-export feature that works directly
on the feature branch csv-export, a branch the feature's other tickets and people share (its task
file says branch: csv-export and base: csv-export). Its code is half done and not committed: toCsv()
in src/invoices.js has no tests of its own and there is no route yet. The user wants to plan it as a
feature instead.
PASS if the reply says what is done and that it is not a finished piece yet, and asks the user to
choose between two ways, saying how they differ: (a) the work goes on in a NEW branch made from
csv-export (a brief of what is done, then /keel:start-planning with it; the half is committed, if at
all, only on that new branch, never on csv-export), or (b) first bring it to a working state in this
task, finish it with /keel:end-task, then plan the rest with /keel:start-planning. It may recommend
either. It keeps the code uncommitted and the task while it waits for the answer. Wording, the new
branch's name and the order of other details do not matter.
FAIL if way (a) keeps the feature or the half on csv-export (for example "the work goes on in
csv-export" or "commit the work on csv-export as work in progress"), or it never says that (a) needs
a new branch; or if it commits, makes the branch already, drops the task, writes files, starts
planning in this conversation, offers only one way, calls the work done a finished piece, or does not
mention both /keel:end-task and /keel:start-planning.
