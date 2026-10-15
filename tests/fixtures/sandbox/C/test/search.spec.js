'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchTasks } = require('../src/search.js');
const { escapeLike } = require('../src/lib/text.js');
const { testDb, addTask, startServer } = require('./helpers.js');

test('search matches part of the title, ignoring case, newest first, within the project', () => {
  const db = testDb();
  addTask(db, { title: 'Update the Invoice page', created_at: '2026-10-01T09:00:00.000Z' });
  addTask(db, { title: 'invoice emails', created_at: '2026-10-02T09:00:00.000Z' });
  addTask(db, { title: 'Pricing page' });
  addTask(db, { title: 'Invoice export', project_id: 2 });
  assert.deepEqual(searchTasks(db, 1, 'INVOICE', 20).map((t) => t.title), ['invoice emails', 'Update the Invoice page']);
  assert.deepEqual(searchTasks(db, 1, 'invoice', 1).map((t) => t.title), ['invoice emails']);
});

test('wildcards in the query are plain characters', () => {
  const db = testDb();
  addTask(db, { title: 'Cut costs by 50%' });
  addTask(db, { title: 'Cut costs by 500' });
  addTask(db, { title: 'file_name rules' });
  addTask(db, { title: 'filename rules' });
  assert.deepEqual(searchTasks(db, 1, '50%', 20).map((t) => t.title), ['Cut costs by 50%']);
  assert.deepEqual(searchTasks(db, 1, 'file_', 20).map((t) => t.title), ['file_name rules']);
  assert.equal(escapeLike('a\\b%c_d'), 'a\\\\b\\%c\\_d');
});

test('search rejects an empty or too long query and a missing project', () => {
  const db = testDb();
  assert.throws(() => searchTasks(db, 1, '   ', 20), (e) => e.status === 400);
  assert.throws(() => searchTasks(db, 1, 'x'.repeat(101), 20), (e) => e.status === 400);
  assert.throws(() => searchTasks(db, 9, 'x', 20), (e) => e.status === 404);
});

test('search endpoint: query parameters and errors', async (t) => {
  const db = testDb();
  addTask(db, { title: 'Write release notes' });
  const api = await startServer(db);
  t.after(api.close);
  const ok = await api.call('GET', '/projects/1/search?q=release');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.map((x) => x.title), ['Write release notes']);
  assert.equal((await api.call('GET', '/projects/1/search')).status, 400);
  assert.equal((await api.call('GET', '/projects/1/search?q=x&limit=0')).status, 400);
  assert.equal((await api.call('GET', '/projects/9/search?q=x')).status, 404);
});
