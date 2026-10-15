---
key: TSK-250
plan: inline
---
# TSK-250: workload tools

## Goal
Team leads plan the week: they estimate tasks, sort the list, hand out several tasks at once without
overloading anyone, see what is due this week, and export the list for the weekly meeting.

## Acceptance criteria
1. Tasks get an optional `estimate_hours` (a number, 0 or more), set on create or with `PATCH`. Existing
   tasks keep all their data.
2. `GET /projects/:id/tasks?sort=<field>` sorts by `created_at`, `due_date`, `priority` or `title`; a
   leading `-` sorts descending; anything else gives `400`.
3. `POST /projects/:id/assign` with `{ task_ids, assignee_id }` assigns all the listed tasks of that
   project to the person, or none of them if any task is invalid. Nobody may ever hold more than 5 open
   (not done) tasks; a request that would exceed it gets `409`.
4. `GET /projects/:id/week?date=YYYY-MM-DD` lists the project's tasks due from Monday to Sunday of the
   week containing that date (default: today).
5. `GET /projects/:id/export.csv` returns all tasks of the project as CSV with the assignee's name; the
   file is opened in spreadsheet programs at the weekly meeting.
6. Each assignment is announced through the existing notification log.
7. README and tests.

## Out of scope
Working-day math; editing estimates in bulk.
