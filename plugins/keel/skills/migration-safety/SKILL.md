---
name: migration-safety
description: Use when adding or changing a database migration or raw DDL. Lock-aware changes, batched backfills, generated SQL read, lost data named; a risky change gets variants to choose from.
---

# Migration safety

Before merging any schema change:

- **Risky change:** renaming, dropping or retyping a column or table that has data, a new `NOT NULL`
  column without a default on an existing table, moving data between tables, a mass `UPDATE` or
  `DELETE` (the full list: "When to ask" there): before writing it, follow
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/risky-changes.md` (the variants to offer, the backup
  question, when to ask twice, where the pick is written).
- **Locks:** avoid long exclusive locks on busy tables. In PostgreSQL create indexes `CONCURRENTLY`
  (outside a transaction); add a column nullable, backfill, then add `NOT NULL` with a validated
  constraint.
- **Backfills:** in batches, outside the schema migration, idempotent and resumable; never one huge
  `UPDATE` holding a lock.
- **Undo:** follow the project: down migrations where it writes them; otherwise say how a bad
  release is fixed (one more migration forward, a restore from a backup).
- **Read the SQL:** look at the DDL the tool generates (dry-run or SQL output) and confirm there is no
  unintended table rewrite and no rename generated as drop + add.
- **Data loss:** any drop or destructive change says what data disappears and how to restore it.

keel never runs migrations on its own; only test databases are used in verification.
