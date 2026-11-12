---
type: llm
---

The project writes ADRs (docs profile 2) and has three records in docs/adr kept as a journal: 0001 is
"Superseded by 0003", and 0003 restates it. No ADR style is chosen yet.
PASS if the reply, without changing any file, (1) says what the project has now: its ADRs are kept as a
journal (a superseded record, 0001 → 0003); (2) asks how to keep the ADRs, offering at least journal,
living and the person's own way; (3) marks journal as the way the project keeps them now; (4) says for
living that it comes with a one-time clean-up of the existing records (merge, rewrite, renumber once);
(5) recommends one style and says why. Other questions of the docs section (the profile) are fine.
FAIL if there is no ADR style question, any of (1)-(5) is missing, or it writes the config or a record.
