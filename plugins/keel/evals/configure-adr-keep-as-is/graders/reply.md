---
type: llm
---

The project writes ADRs (docs profile 2) and keeps them neither as a journal nor as living records:
docs/adr/0003 amends a part of 0002 and 0001 has a correction note. No ADR style is chosen yet.
PASS if the reply, without changing any file, (1) says how the records are kept now (a record that amends
another, a correction note) and that this is neither of keel's two styles; (2) asks how to keep the ADRs,
offering journal, living, keeping them as they are (with a short description of the current way) and the
person's own way. Other questions of the docs section (the profile) are fine.
FAIL if there is no ADR style question, the "keep them as they are" option is missing, or it writes the
config or a record.
