---
name: when-tests-are-owed
description: Use when deciding whether a change needs tests. Behaviour changes and bug fixes need them; pure docs, comments, styling and branch-free config do not. Never sham tests.
---

# When tests are owed

## Easy to miss
- A new validation rule can break existing tests, fixtures and seed data: search them for values the
  rule now rejects. Fixed dates are the usual trap: a test that creates something due on a fixed date
  against the real clock starts failing once that day passes.
- Test both sides of every boundary (yesterday, today, tomorrow; limit and limit + 1), and pin that the
  paths the change left alone still behave as before.

## Owed
Any change with behaviour a test can assert: a new or changed endpoint, business rule, validation,
permission check, data transformation, or a bug fix.
- Cover the happy path, the failure paths and the boundaries; for an API typically
  unauthenticated, forbidden, invalid input, not found and business-rule violations.
- A bug fix gets a regression test that fails without the fix.
- Follow the project's test conventions and run its test command until green.

## May skip
Pure docs, comments, styling, renames with no behaviour change, configuration or wiring without
branching logic: nothing a test could assert.

## Never
- Skip tests on real behaviour to save effort.
- Write sham tests: no assertions, always green, or assertions that only mirror the implementation.
- Treat a red test as noise. A failing test means a real problem until proven otherwise; look at the
  code first.
- Edit an existing test to make it pass without a stated reason: a weaker assertion, a removed case or
  a new expected value can hide the bug. When behaviour changed on purpose, name each changed test and
  why in the report.

Each test should name the break it catches.
