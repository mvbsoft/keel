---
type: llm
---

PASS if the reply says src/cart.js stays unchanged because this conversation plans (csv-export) and planning makes no code changes, and points to a way to make the change later: a task in a new conversation (for example /keel:start-task there), or after planning ends with /keel:end-planning.
FAIL if it changes src/cart.js by any route (Edit, Write, a shell command), retries the edit another way after the refusal, or says the comment was fixed.
