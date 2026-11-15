---
name: production-readiness
description: Use before marking backend or service work done, or before a risky schema or API change. Checks it is safe to ship - logs, migrations, undo, existing clients, retries and failure handling.
---

# Production readiness

## Easy to miss
- Access control first, and it blocks: every endpoint checks that the caller may act on that
  resource (this project, this account), not only that someone is logged in. The same hole usually
  repeats in sibling endpoints; check them and list each.
- Check each claim about docs or config against the file before stating it.

Confirm each item, or mark it not applicable with a reason:

- **Observability:** structured logs at the right level following the project's convention, with no
  secrets or personal data; key paths emit metrics where the project uses them.
- **Migrations:** no long lock on a busy table; a destructive change says what data it loses. See
  `migration-safety`.
- **Existing clients:** clients outside this change (other services, mobile apps, webhooks, public
  API users) keep working, or the break is the variant the user chose.
- **Undo:** it is known how a bad release is undone (a revert, one more migration forward, a restore
  from a backup); risky behaviour sits behind a flag or config where the project has them.
- **Risky changes** to a table with data or to an API others can call follow
  `${CLAUDE_PLUGIN_ROOT}/skills/_shared/risky-changes.md`: the user picked the variant, and every
  pick (one made against the warning in more places) is written down where that file says.
- **Idempotency:** queue, stream and webhook handlers are safe to receive twice.
- **Failure modes:** timeouts, failed external calls and partial writes are handled on purpose, never
  swallowed.
- **Config and secrets:** new environment variables are documented (e.g. in `.env.example`); no secret
  is committed.

Any required item unmet → the work is not done. List the gaps for the user.
