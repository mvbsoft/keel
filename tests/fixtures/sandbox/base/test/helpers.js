'use strict';
// Shared test setup: an in-memory database with two users and a project, and a server on a free port.
const { open } = require('../src/db.js');
const { createServer } = require('../src/server.js');

function testDb() {
  const db = open(':memory:');
  db.prepare("INSERT INTO users (id, name, email) VALUES (1, 'Ada', 'ada@example.com'), (2, 'Linus', 'linus@example.com')").run();
  db.prepare("INSERT INTO projects (id, name, owner_id) VALUES (1, 'Website', 1), (2, 'Mobile app', 2)").run();
  return db;
}

function addTask(db, fields) {
  const t = { project_id: 1, title: 'A task', status: 'todo', priority: 2, assignee_id: null, due_date: null, created_at: '2026-10-01T09:00:00.000Z', ...fields };
  const r = db.prepare('INSERT INTO tasks (project_id, title, status, priority, assignee_id, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(t.project_id, t.title, t.status, t.priority, t.assignee_id, t.due_date, t.created_at);
  return Number(r.lastInsertRowid);
}

// Starts a server on a free port; call(method, path, { body, user }) returns { status, body }.
async function startServer(db) {
  const server = createServer(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, { body, user = 1 } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (user !== null) headers['x-user-id'] = String(user);
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { testDb, addTask, startServer };
