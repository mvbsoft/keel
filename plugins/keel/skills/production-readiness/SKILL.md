---
name: production-readiness
description: Use before marking backend or service work done. Checks it is safe to ship - logs, migrations, rollback, backward compatibility, retries and failure handling.
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
- **Migrations:** additive first and reversible; destructive changes go expand → migrate → contract.
  See `migration-safety`.
- **Backward compatibility:** API and contract changes are additive or versioned; existing clients
  (frontend, other services, webhooks) keep working.
- **Rollback:** the change can be reverted without data loss; risky behaviour sits behind a flag or
  config where the project has them.
- **Idempotency:** queue, stream and webhook handlers are safe to receive twice.
- **Failure modes:** timeouts, failed external calls and partial writes are handled on purpose, never
  swallowed.
- **Config and secrets:** new environment variables are documented (e.g. in `.env.example`); no secret
  is committed.

Any required item unmet → the work is not done. List the gaps for the user.
