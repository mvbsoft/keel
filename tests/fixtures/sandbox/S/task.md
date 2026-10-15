---
key: TSK-214
plan: inline
---
# TSK-214: project report

## Goal
Team leads want one call that shows how a project is doing: how many tasks are in each status and
which tasks are overdue.

## Acceptance criteria
1. `GET /projects/:id/report` returns `{ project_id, counts: { todo, doing, done }, overdue: [...] }`.
2. A task is overdue when its due date is before today and it is not done.
3. Each overdue item has `id`, `title`, `due_date` and `days_overdue` (calendar days since the due date);
   the most overdue task comes first.
4. A project that does not exist gives `404`.
5. The README documents the endpoint.
6. Tests cover the report.

## Out of scope
Working-day math for the report; filters.
