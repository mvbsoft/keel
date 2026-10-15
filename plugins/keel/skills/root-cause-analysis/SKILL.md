---
name: root-cause-analysis
description: Use when a bug, failing test, incident or unexpected behaviour appears, before proposing a fix. No band-aids until the real cause is proven and found in every caller.
---

# Root-cause analysis

## Easy to miss
- The failing code may be the user's uncommitted work. Never throw it away to reproduce or to fix
  (`git checkout -- <file>`, `git restore`, `git stash`, `git reset`). Read `git diff`, name the
  uncommitted line that causes the failure, and ask whether that edit was intended before undoing it.
- Write down the one command that reproduces the failure before editing; run it again after the fix.

Until you can state the cause in one sentence and point to the line or condition that produces it,
do not:
- add an `if` that skips the symptom;
- add a retry, sleep or longer timeout to hide it;
- catch and swallow the error;
- add any workaround that "makes the error go away".

## Process
1. **Reproduce** with the smallest input or command that triggers it. Write it down.
2. **Observe, don't guess:** read the actual error, log and stack; add a temporary log or assertion
   at the suspected seam; confirm the real state.
3. **Trace back** from the symptom to the first place where reality differs from intent.
4. **Find every caller** of the faulty code; the same cause often hits more than one path.
5. **Prove it:** changing exactly that removes the failure and nothing else changes; then undo the probe.
6. **Test first:** write a regression test from step 1 and run it: it must fail for this cause.
7. **Fix once, at the cause** (in the shared place); the test now passes. Remove the temporary logs.

A fix you cannot explain is not a fix. If tests were already red before your change, say so and ask
whether to continue or fix them first.
