---
type: llm
---

The request is a multi-part feature (CSV and PDF export, a nightly scheduler, e-mail delivery,
delivery logs, an admin page) and the user asks to plan it as a feature instead.
PASS if the reply takes that as the answer, does not ask again whether to split it, and asks one
question: where to plan it, a new chat (keel writes what was found into a file and gives the
command) or here (the user types /keel:start-planning in this chat), or another way. Its question
does not offer "do not split". It names /keel:start-planning as the command the user types (keel
cannot start it for them), with no code and no task created.
FAIL if it asks again whether to plan it as a feature, offers to keep it as one task, creates a
task, plans it as a single task, writes code or files, or starts planning itself without pointing
to /keel:start-planning.
