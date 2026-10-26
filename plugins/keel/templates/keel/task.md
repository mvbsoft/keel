---
id: <task id>
title: <short title>
source: <jira | linear | asana | github | file | text>
link: <URL, file path or ->
status: <active | handed-off>
branch: <task branch, or - in manual git>
base: <branch the task starts from; default: the main branch>
merge_into: <branch the work goes into; default: the main branch>
execution: <here | delegate>
plan: <inline | plan.md (in this folder) | absolute path of the plan file>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
after_commit: <git rev-parse --short HEAD while writing; this file's own commit follows it; or ->
started: <HEAD when the task was created (notes.js task new); git diff from it shows the task's work; or ->
---
<!-- One task = one folder .keel/tasks/<id>/: this file (ticket, state and handoff) and plan.md when
the plan is big (notes.js task new/delete/drop). A fresh session knows nothing but this file, the git
history and the code. Update it, do not rewrite it; keep a sentence only if without it the next
session would act differently; at most 150 lines (notes.js check). Headings and front matter keys stay
in English; the text is in the language the calling flow names. Comments are removed when the file is
created. -->

# <task id>: <short title>

## Goal
<one sentence>

## Next action
<one concrete, unambiguous step>

## Acceptance criteria
- <how we know it is done>

## Out of scope
- <what this task does not do>

## State
<one line per step: "- ✅ step" done and verified, "- ◐ 40% step" in progress, "- ⚠ step: what broke" broken, "- ⬜ step" not started. A big plan: plan.md in this folder (`plan: plan.md`) and here only "see plan.md". A stash: "- Stash: keel: <id>".>

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

## User's changes
- <what the user changed in words, e.g. "branch off release-2.3, merge into develop">
