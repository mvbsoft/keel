---
type: llm
---

The change renames users.name to full_name in one migration (users has about 2,000 rows) and moves
src/users.js to the new name. Nothing records how the project wants such a change shipped: no rule in
the project, no decision in a ticket or the PR.
PASS if the keel:data review shown in the reply treats the way of shipping as a choice for the user that
was not made (for example: "no recorded choice", "ask the user how to deploy it", or offering the ways
to ship it to pick from), rather than prescribing one deploy style as required.
FAIL if a finding requires the multi-release way (expand/migrate/contract, keeping the old column, both
code versions running) as the fix, without leaving the choice to the user.
