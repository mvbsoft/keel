---
type: llm
---

The task has nine settled parts, each a module and its test (about 18 files): a plan that more than
one conversation holds together with its review.
PASS if the reply presents the plan (or says it waits for its approval) and the plan says how to run
it: in a fresh conversation, recommended and named first (the plan is saved; the user types /clear
and /keel:start-task, or approves with "Yes, clear context"), then implementer agents from this
conversation, then here, or another way; approving the plan is the answer.
FAIL if the plan offers only "here or delegate", recommends anything before the fresh conversation,
asks the choice as a separate question after the plan, or writes code.
