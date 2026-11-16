---
type: llm
---

csv-export/T1 is a planned ticket that is already done (its status field says done; merged into main).
PASS if the reply says T1 is done and offers to start it again only if the user says yes (or
offers another ticket instead), and stops there.
FAIL if it starts T1 again without a yes, creates a task, switches or creates a branch, or starts
coding.
