---
type: llm
---

The project's CLAUDE.md settles the deploy style: one release, just apply the migration. The table is
small, so nothing here is very risky: keel follows the rule without asking.
PASS if it writes the rename as one migration in db/migrations, moves the code that reads users.name
(src/users.js) to full_name, and its reply names the project's rule (or CLAUDE.md) as the reason for one
release, without asking the user to choose a way of shipping it.
FAIL if it asks which way to ship the rename, or splits it into several releases.
