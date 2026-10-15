# Protocol: business rules

Topic of the `security` specialist group (with security). Question: can a user break or bypass the
rules of the business, on purpose or by accident, through this change? These bugs often cost more
than injection.

## Method
1. **Name the rules.** From the task, the code and the tests, write down the rules the touched flow
   must keep: who may do what, in which order, how often, with which limits, and what must add up
   (balances, stock, totals, quotas).
2. **Find the state.** Which records change (orders, balances, payments, subscriptions, inventory,
   statuses), and which transitions are allowed?
3. **Try to break each rule** with the cases below. Read the code path for each; do not assume.

## Cases
- **Double effect**: the same request twice (double click, retry, replayed webhook, two tabs): double
  charge, double credit, two orders, a coupon used twice. Is there an idempotency key, a unique
  constraint or an atomic state check?
- **Races (TOCTOU)**: check, then act, without a lock or atomic update: two withdrawals both pass the
  balance check; two buyers get the last item. Show the two concurrent sequences.
- **Skipped or reordered steps**: can a later step run without the earlier one (ship before payment,
  confirm without verification, finish checkout with an expired cart)? Are illegal status
  transitions blocked on the server?
- **Values under the client's control**: price, discount, quantity, currency, totals or ownership taken
  from the request instead of the server; negative or zero quantities; rounding that leaks money;
  integer overflow on amounts; mixed currencies.
- **Limits and quotas**: per-user or per-plan limits checked only in the UI, checked on a different
  key than they count on, or reset by a cheap action.
- **Refunds, cancellations and reversals**: refunding more than paid, refunding twice, cancelling
  after fulfilment, reversing a credit that was already spent.
- **Tenancy**: one tenant's data or settings reachable from another through shared caches, queues or
  ids.
- **Time**: expiry, trial ends, time zones and clock boundaries (end of month, daylight-saving
  change) that let a rule be bypassed.

## Evidence
- The rule, stated, with where it comes from (task, code, test, docs).
- The exact sequence or request that breaks it, and the resulting wrong state (amounts, statuses).
- For races: both interleaved sequences and the missing lock or constraint (`file:line`).
- Why nothing downstream catches it (later validation, reconciliation job, database constraint).

## Do not flag
- Rules you invented that the project does not have.
- Races without a realistic concurrent path (single-user CLI, a job with one worker by design).
- UI-only conveniences when the server enforces the rule.

## Severity
- **critical**: money or stock created, lost or moved wrongly; paid features obtained for free;
  another tenant's data reachable.
- **important**: a rule bypassable under realistic but specific conditions; a limit enforced only on
  the client with low direct loss.
- **minor**: an inconsistent state that a user can cause but that is corrected automatically.

## Principles
- Attack the flow: step timing, limits on use, skipped steps, values the client controls.
- Check-then-act without a lock or atomic update loses updates under the default isolation level;
  a strict isolation level needs a retry.
- A repeatable side effect needs an idempotency key.
