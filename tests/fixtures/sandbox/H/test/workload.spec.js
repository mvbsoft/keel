'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const workload = require('../src/workload.js');
const tasks = require('../src/tasks.js');
const { testDb, addTask, startServer } = require('./helpers.js');

test('assignTasks assigns every listed task', async () => {
  const db = testDb();
  const a = addTask(db, { title: 'A' });
  const b = addTask(db, { title: 'B' });
  assert.deepEqual(await workload.assignTasks(db, 1, [a, b], 2), { assignee_id: 2, assigned: [a, b] });
  assert.equal(tasks.getTask(db, b).assignee_id, 2);
});

test('assignTasks refuses to go over the open-task limit', async () => {
  const db = testDb();
  for (let i = 0; i < 4; i++) addTask(db, { assignee_id: 2 });
  const ids = [addTask(db, {}), addTask(db, {})];
  await assert.rejects(workload.assignTasks(db, 1, ids, 2), (e) => e.status === 409);
});

test('weekOf gives Monday to Sunday', () => {
  assert.deepEqual(workload.weekOf('2026-10-14'), { start: '2026-10-12', end: '2026-10-18' });
});

test('sorting by due date and by priority, descending', () => {
  const db = testDb();
  addTask(db, { title: 'late', due_date: '2026-12-01', priority: 3 });
  addTask(db, { title: 'soon', due_date: '2026-10-20', priority: 1 });
  assert.deepEqual(tasks.listTasks(db, 1, { sort: 'due_date' }).map((t) => t.title), ['soon', 'late']);
  assert.deepEqual(tasks.listTasks(db, 1, { sort: '-priority' }).map((t) => t.title), ['late', 'soon']);
  assert.throws(() => tasks.listTasks(db, 1, { sort: 'owner' }), (e) => e.status === 400);
});

test('estimate_hours is validated and stored', () => {
  const db = testDb();
  const id = addTask(db, {});
  assert.equal(tasks.updateTask(db, id, { estimate_hours: 2.5 }).estimate_hours, 2.5);
  assert.throws(() => tasks.updateTask(db, id, { estimate_hours: -1 }), (e) => e.status === 400);
});

test('endpoints: week and CSV export', async (t) => {
  const db = testDb();
  addTask(db, { title: 'Ship', assignee_id: 1, due_date: '2026-10-15' });
  const api = await startServer(db);
  t.after(api.close);
  const week = await api.call('GET', '/projects/1/week?date=2026-10-14');
  assert.deepEqual(week.body.tasks.map((x) => x.title), ['Ship']);
  const res = await fetch(`${api.base}/projects/1/export.csv`, { headers: { 'x-user-id': '1' } });
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal((await res.text()).split('\r\n')[1], '1,Ship,todo,Ada,2026-10-15,');
});
