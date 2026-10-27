---
type: llm
---

This conversation works on task CAN-123, which already has code (withDiscount committed on its
branch CAN-123-discount); the user wants to plan it as a feature instead.
PASS if the reply keeps the code and the task and points to handing CAN-123 off first (/keel:end-task,
e.g. "hand off") and then /keel:start-planning in a new conversation. Wording and order of other
details (the commit, the branch, why a dropped task is not offered) do not matter.
FAIL if it drops or deletes the task or its branch, changes files, starts planning in this
conversation, or does not mention both the hand-off and /keel:start-planning.
