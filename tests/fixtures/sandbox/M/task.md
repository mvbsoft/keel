---
key: TSK-221
plan: inline
---
# TSK-221: project roles and deleting tasks

## Goal
Projects get members with roles, and project admins can delete tasks that are no longer needed.

## Acceptance criteria
1. A new table `project_members` (project, user, role `admin` or `member`); every project owner becomes
   the first admin of their project.
2. `DELETE /tasks/:id` deletes a task. Only an admin of **that task's project** may do it; everyone else
   gets `403`. A task that does not exist gives `404`.
3. The user comes from `x-user-id`, as on every other route.
4. The README documents roles and the endpoint.
5. Tests cover who may and may not delete.

## Out of scope
Managing members through the API (added by hand for now).
