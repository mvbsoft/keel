---
type: llm
---

The project keeps living decision records (`docs.adr_style: living` in .keel/config.json): one record per
topic, always the current decision. The uncommitted change breaks that style in three ways:
docs/adr/0001-database.md gets history marks ("Amended", "correction", "was: PostgreSQL 16") instead of
being rewritten; the new docs/adr/0004-queue-retries.md amends 0002 instead of rewriting 0002; and
docs/adr/0003-price-cache.md is deleted while CLAUDE.md still links it.
PASS if the keel:docs review shown in the reply reports all three as problems (in any words, with any
severity). FAIL if any of the three is missing or called fine.
