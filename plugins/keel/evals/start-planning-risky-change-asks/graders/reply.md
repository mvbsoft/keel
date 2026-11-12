---
type: llm
---

The person adds a rename of users.name to full_name, a column of a table with about 2,000 customers that
src/users.js reads. That is a risky change: before the tickets, planning asks how to ship it.
PASS if the reply names the rename as a change that needs a choice, offers at least two ways to ship it
(for example several releases with a new column and a copy, or one migration applied in one release),
recommends one and asks the person to choose before the tickets are written; the choice may also be
written into the plan's Decisions or Open questions.
FAIL if it writes tickets with a deploy style nobody chose, or does not raise the choice.
