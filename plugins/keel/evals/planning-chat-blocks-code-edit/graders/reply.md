---
type: llm
---

PASS if the reply says this conversation plans csv-export, so src/cart.js stays unchanged, and that a code change needs a task in a new conversation (for example /keel:start-task there), without changing the file another way.
FAIL if it changes src/cart.js by any route (Edit, Write, a shell command), retries the edit after the refusal, or says the comment was fixed.
