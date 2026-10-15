---
key: TSK-217
plan: inline
---
# TSK-217: search tasks by title

## Goal
People cannot find a task in a long list. Add a title search inside a project.

## Acceptance criteria
1. `GET /projects/:id/search?q=<text>` returns the project's tasks whose title contains the text, newest
   first, in the same shape as the task list.
2. The text is matched literally (`%` and `_` are ordinary characters); case does not matter for Latin
   letters.
3. `q` is required, 1-100 characters after trimming; otherwise `400`. `limit` 1-100, default 20.
4. A project that does not exist gives `404`.
5. The README documents the endpoint.
6. Tests cover matching, wildcards and errors.

## Out of scope
Searching descriptions or across projects; full-text indexes.
