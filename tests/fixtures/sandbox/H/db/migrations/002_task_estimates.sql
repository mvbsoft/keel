-- Tasks get an optional estimate in hours. SQLite cannot add a CHECK to an existing table, so the
-- table is rebuilt with the new column and the rows copied over.
CREATE TABLE tasks_new (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  assignee_id INTEGER REFERENCES users(id),
  due_date TEXT,
  estimate_hours REAL CHECK (estimate_hours IS NULL OR estimate_hours >= 0),
  created_at TEXT NOT NULL
);

INSERT INTO tasks_new (id, project_id, title, status, priority, assignee_id, created_at)
SELECT id, project_id, title, status, priority, assignee_id, created_at FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX tasks_project ON tasks (project_id, created_at);
