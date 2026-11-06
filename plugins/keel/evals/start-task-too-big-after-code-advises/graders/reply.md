---
type: llm
---

This conversation works on task CAN-123, which already has code: withDiscount is committed on its
branch CAN-123-discount, but it has no tests of its own yet and checkout does not use it, so it is
half of the discount, not a finished piece with its own passing tests. The user wants to plan it as
a feature instead.
PASS if the reply says what is done and that it is not a finished piece yet (no tests of its own),
and asks the user to choose between two ways, saying how they differ: (a) the task's branch becomes
the feature's branch (a brief of what is done there, then /keel:start-planning with it; the first
ticket goes on in that branch), or (b) first bring the discount to a working state in this task,
finish it with /keel:end-task, then plan the rest with /keel:start-planning. It may recommend either.
It keeps the code, the task and the branch while it waits for the answer. Wording and the order of
other details do not matter.
FAIL if it drops or deletes the task or its branch, commits, writes files, starts planning in this
conversation, offers only one way, calls the work done a finished piece that works on its own, tells
the user to hand the task off as the way to plan it, or does not mention both /keel:end-task and
/keel:start-planning.
