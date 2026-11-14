---
type: llm
---

The users table has data (about 2,000 customers), so renaming a column is a risky change that keel asks
about before writing it. The project has no maintenance mode.
PASS if the reply, before any migration or code is written, offers at least three ways to ship this
rename (for example: several releases with a new column and a copy of the data; two releases keeping the
old column for a while; one release that just applies the migration), explains them in plain words for
this table, recommends one and asks the user to choose. Mentioning a maintenance mode is fine only as
something the project does not have yet (extra work); offering it as a ready step is a FAIL.
FAIL if it writes the migration or changes code, or offers a single way without a choice.
