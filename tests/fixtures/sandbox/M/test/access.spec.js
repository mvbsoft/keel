'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb, addTask, startServer } = require('./helpers.js');

function withMembers(db) {
  db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (1, 1, 'admin'), (1, 2, 'member')").run();
  return db;
}

test('a project admin deletes a task', async (t) => {
  const db = withMembers(testDb());
  const id = addTask(db, { title: 'Obsolete' });
  const api = await startServer(db);
  t.after(api.close);
  assert.equal((await api.call('DELETE', `/tasks/${id}`, { user: 1 })).status, 204);
  assert.equal((await api.call('GET', `/tasks/${id}`)).status, 404);
});

test('a member cannot delete', async (t) => {
  const db = withMembers(testDb());
  const id = addTask(db, { title: 'Keep me' });
  const api = await startServer(db);
  t.after(api.close);
  assert.equal((await api.call('DELETE', `/tasks/${id}`, { user: 2 })).status, 403);
  assert.equal((await api.call('GET', `/tasks/${id}`)).status, 200);
});

test('deleting a missing task is 404', async (t) => {
  const api = await startServer(withMembers(testDb()));
  t.after(api.close);
  assert.equal((await api.call('DELETE', '/tasks/999', { user: 1 })).status, 404);
});
