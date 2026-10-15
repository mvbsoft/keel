---
type: llm
---

The task is clear and small: one function in src/auth.js and a test, nothing to ask.
PASS if one message holds a short retell, a short plan (the file to change and the test), a proposed
task name, and the branch choice with a new branch recommended, and ends with one question that starts
the work on a yes (for example "New task fix-reset-unknown-token: start, in a new branch ...?").
A note on a side effect of the change with the default it will take (for example the order of two
checks), which the user may change in the same answer, is fine and not a question.
FAIL if it writes code or files, says the task is already created, waits for an answer to a clarifying
question before it can start, or asks only "is it new / the name right?" and leaves the plan or the
start for a later message.
