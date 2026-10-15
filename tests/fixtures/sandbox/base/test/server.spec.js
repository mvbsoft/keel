'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { testDb, addTask, startServer } = require('./helpers.js');

test('API: identity, projects, tasks', async (t) => {
  const db = testDb();
  addTask(db, { title: 'Existing' });
  const api = await startServer(db);
  t.after(api.close);

  assert.equal((await api.call('GET', '/projects/1', { user: null })).status, 401);
  assert.deepEqual((await api.call('GET', '/projects/1')).body, { id: 1, name: 'Website', owner_id: 1, task_count: 1 });
  assert.equal((await api.call('GET', '/projects/9')).status, 404);

  const created = await api.call('POST', '/projects/1/tasks', { body: { title: 'New one', due_date: '2026-11-01' } });
  assert.equal(created.status, 201);
  assert.equal((await api.call('GET', `/tasks/${created.body.id}`)).body.title, 'New one');
  assert.equal((await api.call('POST', '/projects/1/tasks', { body: { title: '' } })).status, 400);

  const list = await api.call('GET', '/projects/1/tasks?limit=1');
  assert.deepEqual(list.body.map((x) => x.title), ['New one']);
  assert.equal((await api.call('GET', '/projects/1/tasks?limit=500')).status, 400);

  assert.equal((await api.call('PATCH', `/tasks/${created.body.id}`, { body: { priority: 1 } })).body.priority, 1);
  assert.equal((await api.call('DELETE', '/projects/1')).status, 405);
  assert.equal((await api.call('GET', '/nothing')).status, 404);
});
