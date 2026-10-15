# Protocol: performance

Topic of the `data` specialist group. Question: does the change add work that grows with data or
traffic in a way that will hurt at the project's real sizes?

## Checklist
1. **Query or call in a loop.** A database query, lazy relation access, HTTP call or file read inside
   a loop, `map`, comprehension or template loop. Name the loop, the call and the collection.
2. **Lazy relations over a list.** Is the relation preloaded with the framework's tool
   (`select_related`/`prefetch_related`, `includes`/`preload`, `with()`, `selectinload`/`joinedload`,
   `join fetch`, Prisma `include`, a DataLoader)?
3. **Per-row writes** where a bulk call exists (`bulk_create`, `createMany`, batch insert).
4. **Work the database should do**: a whole table loaded to filter, count or sum in memory; `len()`
   of a query instead of `count()`; `count()` before using the rows anyway.
5. **Unbounded reads**: no limit or pagination on a growing table or API; a whole file in memory.
6. **Offset pagination** on a large, growing table (keyset avoids reading skipped rows).
7. **Unbounded growth in a long-lived process**: append-only module-level collections, caches with
   no eviction or TTL (`lru_cache(maxsize=None)`), listeners never removed.
8. **Accidental O(n²)**: nested loops over two collections, `x in list` inside a loop, `pop(0)`,
   repeated `find`/`filter` over the same array, string building in a loop.
9. **Blocking on a hot path**: sync file, crypto, compression or process calls, CPU-heavy loops,
   large `JSON.parse`, backtracking regex on untrusted input inside an async handler or event loop.
10. **Network calls without a timeout** on a request path.
11. **Redundant work**: the same query or computation repeated per request or iteration; a client or
    connection created per call instead of reused.
12. **Fan-out**: one message, event or webhook triggering N more without a bound or batching.
13. **Missing index** for a new filter or sort on a table that is large in production (only when you
    can see the schema or migrations).

## Evidence (in this order)
1. `file:line` of the loop; 2. `file:line` of the costly call or the growing structure; 3. where the
collection comes from and its realistic size, from the repository (fixture, seed, migration, config
limit, documented maximum, API page size); 4. the multiplier for that size (e.g. 1 + N queries,
N = 500); 5. no existing mitigation (preload, cache, limit, DataLoader, strict-loading mode).

Without a realistic size from the repository the finding stays out, or is minor with "size unknown".
Intuition about speed is unreliable; measurement or real sizes decide.

## Do not flag
- "This might be slow" without a size or call frequency.
- Micro-optimizations (`for` vs `map`, formatting, tuple vs list).
- Loops over small fixed collections (enum values, a few config keys); one-shot scripts.
- An N+1 the change only moved, or that existed before.
- Lazy loading already prevented upstream (strict mode, automatic eager loading, DataLoader).
- Pagination demands on endpoints with a documented hard upper bound.
- Cache suggestions without a measured repeat cost.

## Severity
- **critical**: unbounded query or loop on a hot path whose size provably grows with users or data;
  blocking CPU or I/O on an event loop's main path; a proven leak in a long-lived process; per-row
  network calls with N in the thousands.
- **important**: a proven N+1 with N in the tens to hundreds on a frequent endpoint; offset paging on
  a growing table; O(n²) over hundreds to thousands of items; per-row writes in a batch job.
- **minor**: a small N+1 (N under about 20) on a rare path; one redundant query per request.

## Principles
- Load related data in one query, not one per item.
- Page by key, not by a large offset.
- Never block the event loop or an async loop with synchronous work.
