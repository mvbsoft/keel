# Protocol: database changes

Topic of the `data` specialist group. Question: will the schema change, migration or new query lock,
lose or corrupt data, or break the running application during deploy?

First find the engine and version (compose file, CI service, `database.yml`, settings, connection
string templates). PostgreSQL, MySQL and SQLite behave differently; say which one a finding assumes.

## Checklist
**Locks and rewrites**
1. Does a statement on an existing table take a lock that blocks reads or writes for long? In
   PostgreSQL most `ALTER TABLE` forms take ACCESS EXCLUSIVE, which blocks even reads, and a waiting
   lock queues every later query behind it. Is `lock_timeout` set or a retry wrapper used?
2. PostgreSQL `CREATE INDEX` without `CONCURRENTLY` on an existing table blocks writes for the whole
   build. `CONCURRENTLY` cannot run inside a transaction, so the migration must turn off its wrapping
   transaction (Rails `disable_ddl_transaction!`, Django `atomic = False`, ...). A failed concurrent
   build leaves an INVALID index to drop. (MySQL InnoDB secondary index builds are online.)
3. Adding a column with a volatile default, a stored generated column or an identity column rewrites
   the table in PostgreSQL; a constant default does not (PostgreSQL 11+).
4. A column type change rewrites the table and its indexes (except binary-coercible changes such as
   `varchar` → `text` or a longer varchar limit). In MySQL most type changes copy the table and
   block writes.
5. `SET NOT NULL` on an existing PostgreSQL column scans the table under ACCESS EXCLUSIVE unless a
   validated `CHECK (col IS NOT NULL)` exists. Safe order: CHECK ... NOT VALID, backfill, VALIDATE,
   SET NOT NULL, drop the CHECK.
6. `NOT NULL` without a default on a table that may have rows fails. SQLite needs a non-null default.
7. A new foreign key locks both tables while it validates; the safe form is `NOT VALID`, then
   `VALIDATE CONSTRAINT` separately. New CHECK and UNIQUE constraints scan the table; build a unique
   index concurrently and attach it with `USING INDEX`.
8. `DROP INDEX`, `REINDEX`, `TRUNCATE`, `VACUUM FULL` on a large table without the concurrent form.

**Deploy order and data safety**
9. Does it drop or rename a column, table or enum value that code still running during the rollout
   uses? Expand, deploy, then contract: stop using, deploy, then drop.
10. Does a generated migration drop and re-add what was meant as a rename (losing the data)? Does a
    drop destroy data with no backup or export step?
11. Is a backfill inside the same transaction as DDL (holding the lock for the whole backfill)? Is a
    large `UPDATE` batched? Schema and data changes belong in separate migrations.
12. Does a data migration import live model classes that will change later (use the historical model,
    e.g. Django `apps.get_model`)?
13. Is the down migration missing, empty or lossy while the project expects reversibility?
14. MySQL DDL commits implicitly: does a multi-statement migration assume it rolls back on failure?
15. Is a new foreign key column unindexed (PostgreSQL does not index it automatically; parent deletes
    then scan the child table)?
16. Does a new query filter or sort on columns no index covers, on a table large enough to matter? Is
    a new composite index in a useful column order, or redundant with an existing one?
17. Was an already applied migration edited instead of adding a new one?

**Transactions and concurrency**
18. Read-check-then-write under Read Committed (the PostgreSQL default) with no lock, unique
    constraint or atomic `UPDATE ... WHERE`: two concurrent runs both pass the check.
19. Repeatable Read or Serializable without a retry on serialization failures (SQLSTATE 40001).
20. External calls (HTTP, queue publish) inside an open transaction, holding locks.
21. Bulk operations (`update_all`, QuerySet `update()`, `bulk_*`) that skip callbacks or validation the
    code relies on.

## Evidence
- The statement at `file:line`, the engine and version if the repository shows it.
- The lock or rewrite it causes, from the database documentation.
- Table size or traffic from the repository (seed counts, comments, hot tables such as users, orders,
  events, earlier migrations that used the safe pattern on it). Nothing shown → "size unknown" and at
  most important.
- The concrete effect ("inserts into orders block for the whole index build").
- Deploy-order findings: the `file:line` of code that still uses the dropped or renamed thing.

## Do not flag
- DDL on a table created in the same migration or change.
- Tables the repository shows are small lookup or config tables; projects clearly without production
  data yet.
- Non-concurrent index creation on SQLite or MySQL InnoDB (online there).
- A constant default on `ADD COLUMN` in PostgreSQL 11+; MySQL 8 instant `ADD COLUMN`.
- A missing down migration where the project rolls forward only, or the tool has no down step.
- Style rules without a failure case (prefer `text`, prefer `timestamptz`).
- N+1 over a bounded handful of rows (performance protocol covers loops).

## Severity
- **critical**: data loss with no recovery path; a long blocking lock on a table known to be large or
  hot; a deploy-order break that errors in production; lost updates or double spending in money or
  inventory code.
- **important**: a locking statement with size unknown; a migration that fails on existing rows; a
  missing index on a probably large table; a missing retry on serialization failures.
- **minor**: missing or empty down migration; a missing index on a small table; `int` ids on a
  low-volume table.

## Principles
- Check how the project's own engine locks on each DDL statement; engines differ.
- Expand, migrate, contract: old and new code both run against every step.
- No size makes a table "large" everywhere; use evidence from the repository.
