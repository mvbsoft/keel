---
name: performance-review
description: Use when writing or reviewing a hot path - database queries, queue consumers, request handlers, loops over large data. Finds per-item queries, blocking calls, unbounded growth and races.
---

# Performance review (hot paths)

State the load you assume (requests per second, rows, items per batch), then check:

- **Database:** no query per item (batch, join or eager-load); no full scan on a large table (check the
  query plan); indexes match the filters and sort. See `postgres-best-practices`.
- **Queues and streams:** the consumer keeps up with the producer; bounded buffers and backpressure;
  sane timeouts on blocking reads; handlers idempotent for at-least-once delivery.
- **Request handlers:** no blocking I/O on an event loop; pagination on list endpoints; bounded
  response size; no heavy per-request setup.
- **Memory:** nothing grows without limit (caches, lists, open clients, background tasks).
- **External calls:** batched where possible; timeouts and concurrency limits; no chatty per-item
  round trips.
- **Races:** check-then-write sequences without a lock or a unique constraint; counters updated by
  read-modify-write.

Measure, don't guess: a claim that a path is slow or fast comes with a plan, a timing or a metric.
