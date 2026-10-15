---
name: migration-safety
description: Use when adding or reviewing a database migration or raw DDL. Safe, reversible, lock-aware changes - expand, migrate, contract; batched backfills; tested forward and back.
---

# Migration safety

Before merging any schema change:

- **Expand → migrate → contract:** never rename, drop or retype a column in one step on a live table.
  Add the new shape, backfill, switch reads and writes, remove the old shape in a later migration.
- **Reversible:** every migration has a working rollback; run it forward and back on a throwaway
  database before merge.
- **Locks:** avoid long exclusive locks on busy tables. In PostgreSQL create indexes `CONCURRENTLY`
  (outside a transaction); add a column nullable, backfill, then add `NOT NULL` with a validated
  constraint.
- **Backfills:** in batches, outside the schema migration, idempotent and resumable; never one huge
  `UPDATE` holding a lock.
- **Both app versions work:** the version before and after the deploy both run against the
  intermediate schema.
- **Read the SQL:** look at the DDL the tool generates (dry-run or SQL output) and confirm there is no
  unintended table rewrite.
- **Data loss:** any drop or destructive change says what data disappears and how to restore it.

keel never runs migrations on its own; only test databases are used in verification.
