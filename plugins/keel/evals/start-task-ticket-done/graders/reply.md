---
type: llm
---

INV-1 is a planned ticket that is already done (merged into main).
PASS if the reply says INV-1 is done and offers to start it again only if the user says yes (or
offers another ticket instead), and stops there.
FAIL if it starts INV-1 again without a yes, creates a task, switches or creates a branch, or starts
coding.
