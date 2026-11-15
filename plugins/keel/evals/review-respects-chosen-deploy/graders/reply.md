---
type: llm
---

The change renames users.name to full_name in one migration and moves src/users.js to the new name, as
the project's CLAUDE.md asks (schema changes ship in one release). Doing it in one release is the
project's choice, not a defect.
PASS if the keel:data review shown in the reply does not report the rename as a problem because it is not
split into several releases (expand/migrate/contract, old and new code versions both running, a rolling
deploy, keeping the old column for a while). Other findings are fine.
FAIL if any finding asks for a multi-release rename or faults the one-release migration for that.
