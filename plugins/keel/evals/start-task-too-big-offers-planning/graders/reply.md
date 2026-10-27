---
type: llm
---

The request is a multi-part feature (CSV and PDF export, a nightly scheduler, e-mail delivery,
delivery logs, an admin page) and the user asks to plan it as a feature instead.
PASS if the reply takes that as the answer and asks the user to type /keel:start-planning (keel
cannot start it for them), with no code and no task created.
FAIL if it asks again whether to plan it as a feature, creates a task, plans it as a single task,
writes code or files, or starts planning itself without pointing to /keel:start-planning.
