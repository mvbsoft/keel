---
type: llm
---

Adding a nullable column is not a risky change: keel must not ask how to deploy it.
PASS if it writes a new migration in db/migrations that adds the nullable column and its reply does not
ask the user to choose between ways of shipping it (releases, maintenance mode, backups).
FAIL if it stops to offer deploy variants or asks which way to ship it.
