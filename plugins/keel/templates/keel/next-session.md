---
status: <active | blocked | done>
branch: <the line's branch, or ->
base: <branch the line started from; default: the main branch>
merge_into: <branch the work goes into; default: the main branch>
execution: <here | delegate>
keys: <tracker keys this line owns, comma-separated, or ->
after_commit: <git rev-parse --short HEAD while writing; the note's own commit follows it>
date: <YYYY-MM-DD>
---

# Next session: <line of work>

## Goal
<one sentence: what "done" looks like for the whole line>

## Next action
<one concrete, unambiguous step>

## State
- <✅ done and verified / ◐ in progress / ⚠ broken / ⬜ not started, one line each>
- Gates: <numbers from the last run, e.g. "212 tests pass, lint 0">

## Plan
<the line's long plan: each step marked ✅ / ◐ <n>% / ⚠ / ⬜ (step blocks keep their status line); a pasted copy, because local plan files are not in git>

## Files
- Changed: <path: what changed; a step's files move here from Next when it is done; tests as "N new, M total">
- Important, read: <path: why it matters>
- Next: <path: what to do there>

## Decisions and why
- <chose X over Y because Z>

## Tried and did not work
- <approach: why it failed; also what the user rejected or what turned out wrong during the work>

## Open questions
- <question: what it blocks>

## How to check
- <command and what a pass looks like>

## Later
- <found during the work, for the future: item, why>
