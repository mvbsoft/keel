'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const tasks = require('../src/tasks.js');
const { testDb, addTask } = require('./helpers.js');

test('createTask fills defaults and trims the title', () => {
  const db = testDb();
  const t = tasks.createTask(db, 1, { title: '  Ship it  ' }, new Date('2026-10-05T12:00:00Z'));
  assert.deepEqual(
    { title: t.title, status: t.status, priority: t.priority, created_at: t.created_at },
    { title: 'Ship it', status: 'todo', priority: 2, created_at: '2026-10-05T12:00:00.000Z' },
  );
});

test('createTask reports every problem at once', () => {
  const db = testDb();
  assert.throws(
    () => tasks.createTask(db, 1, { title: '', priority: 7, status: 'later', assignee_id: 99, due_date: '2026-02-30' }),
    (e) => e.status === 400 && e.details.length === 5,
  );
});

test('createTask on a missing project is 404', () => {
  assert.throws(() => tasks.createTask(testDb(), 9, { title: 'x' }), (e) => e.status === 404);
});

test('updateTask changes only editable fields', () => {
  const db = testDb();
  const id = addTask(db, { title: 'Old' });
  assert.equal(tasks.updateTask(db, id, { title: 'New', priority: 1 }).title, 'New');
  assert.throws(() => tasks.updateTask(db, id, { status: 'done' }), (e) => e.status === 400);
});

test('listTasks: newest first, filters and paging', () => {
  const db = testDb();
  addTask(db, { title: 'first', created_at: '2026-10-01T09:00:00.000Z' });
  addTask(db, { title: 'second', status: 'done', created_at: '2026-10-02T09:00:00.000Z' });
  addTask(db, { title: 'third', assignee_id: 2, created_at: '2026-10-03T09:00:00.000Z' });
  assert.deepEqual(tasks.listTasks(db, 1).map((t) => t.title), ['third', 'second', 'first']);
  assert.deepEqual(tasks.listTasks(db, 1, { status: 'done' }).map((t) => t.title), ['second']);
  assert.deepEqual(tasks.listTasks(db, 1, { assignee: 2 }).map((t) => t.title), ['third']);
  assert.deepEqual(tasks.listTasks(db, 1, { limit: 1, offset: 1 }).map((t) => t.title), ['second']);
});

test('dueSoon skips done tasks and keeps the window inclusive', () => {
  const db = testDb();
  addTask(db, { title: 'today', due_date: '2026-10-10' });
  addTask(db, { title: 'in a week', due_date: '2026-10-17' });
  addTask(db, { title: 'done', status: 'done', due_date: '2026-10-11' });
  addTask(db, { title: 'later', due_date: '2026-10-18' });
  assert.deepEqual(tasks.dueSoon(db, 1, '2026-10-10', 7).map((t) => t.title), ['today', 'in a week']);
});

test('working days skip weekends and holidays', () => {
  assert.equal(tasks.isWorkday('DE', '2026-10-03'), false);
  assert.equal(tasks.addWorkdays('DE', '2026-12-24', 1), '2026-12-28');
  assert.equal(tasks.workdaysBetween('PL', '2026-12-23', '2026-12-28'), 1);
  assert.equal(tasks.workdaysBetween('PL', '2026-12-28', '2026-12-23'), -1);
});

test('toCsv quotes fields that need it', () => {
  const csv = tasks.toCsv([{ id: 1, title: 'Say "hi", then go', status: 'todo', priority: 1, assignee_id: null, due_date: null, created_at: 'x' }]);
  assert.equal(csv.split('\r\n')[1], '1,"Say ""hi"", then go",todo,high,,,x');
});
