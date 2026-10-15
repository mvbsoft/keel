CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member'))
);

-- Every project owner becomes the first admin of their project.
INSERT INTO project_members (project_id, user_id, role)
SELECT id, owner_id, 'admin' FROM projects;
