---
type: llm
---

The project keeps its decision records as a journal (`docs.adr_style: journal` in .keel/config.json).
The uncommitted change breaks that style in three ways: the accepted record docs/adr/0002-job-queue.md is
edited beyond its status line (retries 3 → 5); the new docs/adr/0004-queue-retries.md supersedes only a
part of 0002 (a partial supersede); and the new docs/ops.md links docs/adr/0001-database.md, a record
superseded by 0003.
PASS if the keel:docs review shown in the reply reports all three as problems (in any words, with any
severity). FAIL if any of the three is missing or called fine.
