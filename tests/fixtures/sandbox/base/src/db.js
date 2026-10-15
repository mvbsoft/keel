'use strict';
// Opens the SQLite database and applies the SQL files in db/migrations in name order, each once.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = path.join(__dirname, '..', 'db', 'migrations');

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const name of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed: ${e.message}`);
    }
  }
}

function open(file = process.env.TASKER_DB || ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

// Demo data for `npm start`, added only to an empty database.
function seed(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const user = db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)');
  user.run(1, 'Ada', 'ada@example.com');
  user.run(2, 'Linus', 'linus@example.com');
  user.run(3, 'Grace', 'grace@example.com');
  const project = db.prepare('INSERT INTO projects (id, name, owner_id) VALUES (?, ?, ?)');
  project.run(1, 'Website', 1);
  project.run(2, 'Mobile app', 2);
  const task = db.prepare('INSERT INTO tasks (project_id, title, status, priority, assignee_id, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  task.run(1, 'Draft the landing page', 'done', 2, 1, '2026-09-01', '2026-08-20T09:00:00.000Z');
  task.run(1, 'Pick the analytics tool', 'doing', 1, 2, '2026-09-15', '2026-08-25T10:30:00.000Z');
  task.run(1, 'Write the privacy page', 'todo', 2, null, '2026-10-01', '2026-09-02T08:15:00.000Z');
  task.run(1, 'Collect customer quotes', 'todo', 3, 3, null, '2026-09-10T14:00:00.000Z');
  task.run(2, 'Set up the build pipeline', 'doing', 1, 2, '2026-10-20', '2026-09-05T11:00:00.000Z');
}

module.exports = { open, migrate, seed };
