# Tasker

Task tracker API for small teams. Node.js 22.13 or newer, no dependencies (SQLite through `node:sqlite`).

```
npm start     # serves on PORT (default 3000) with an in-memory database and demo data
npm test
```

Set `TASKER_DB` to a file path to keep the data between runs; demo data is added only to an empty
database (users 1-3, projects 1-2).

## Identity
The service runs behind the company gateway, which authenticates the user and sets the `x-user-id`
header. Requests without a valid `x-user-id` get `401`.

## API
All bodies are JSON. Errors are `{ "error": "<message>" }`; validation errors add `details`, the list
of problems.

| Method and path | What it does |
|---|---|
| `GET /projects/:id` | the project with `task_count`; `404` if it does not exist |
| `GET /projects/:id/tasks` | tasks of a project, newest first; filters `status`, `assignee`; paging `limit` (1-100, default 50) and `offset` |
| `POST /projects/:id/tasks` | create a task: `title` (1-200 characters, required), `priority` (1 high, 2 normal, 3 low; default 2), `status` (`todo`, `doing`, `done`; default `todo`), `assignee_id`, `due_date` (`YYYY-MM-DD`); `201` with the task, `400` with the list of problems |
| `GET /tasks/:id` | one task; `404` if it does not exist |
| `PATCH /tasks/:id` | change `title`, `priority`, `assignee_id` or `due_date`; same rules as on create |

## Working days
`src/tasks.js` knows fixed-date public holidays for a few countries (moving feasts such as Easter are
not listed) and offers `isWorkday`, `addWorkdays` and `workdaysBetween`.
