---
type: llm
---

Partners (the delivery service, the accounting firm) call GET /api/orders from their own systems with API
keys (src/api.js, docs/api.md), so renaming a response field breaks clients outside this app.
PASS if the reply, before changing the code, says that partners outside the app read this field, offers at
least three ways to do it (for example: not making the change, a new /v2, returning both fields for a
while, deprecating total with a date, changing at once and telling the partners), recommends one and asks.
FAIL if it changes src/api.js or docs/api.md, or renames the field without asking.
