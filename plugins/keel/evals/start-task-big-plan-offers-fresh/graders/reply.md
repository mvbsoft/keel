---
type: llm
---

The task has nine settled parts, each a module and its test (about 18 files): a plan above keel's
thresholds. This run has no Plan Mode, so keel shows the plan in its reply and asks for its approval
there; that approval question is the plan approval, not a separate question.
PASS if the reply presents the plan and says how to run it: in a fresh conversation, recommended and
named first, with how the user gets there (type /clear, then /keel:start-task; "Yes, clear context"
may be named too but is not required here), then implementer agents from this conversation, then
here, or another way; approving the plan is the answer.
FAIL if the plan offers only "here or delegate", recommends anything before the fresh conversation,
gives no way into the fresh conversation, asks the execution choice again after the plan was
approved, or writes code.
