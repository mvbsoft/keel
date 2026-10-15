'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport } = require('../src/report.js');
const { testDb, addTask, startServer } = require('./helpers.js');

test('report counts tasks by status and lists overdue ones', () => {
  const db = testDb();
  const late = addTask(db, { title: 'Late', due_date: '2026-10-01' });
  addTask(db, { title: 'Busy', status: 'doing' });
  addTask(db, { title: 'Finished', status: 'done' });
  addTask(db, { title: 'Other project', project_id: 2, due_date: '2026-09-01' });
  assert.deepEqual(buildReport(db, 1, '2026-10-10'), {
    project_id: 1,
    counts: { todo: 1, doing: 1, done: 1 },
    overdue: [{ id: late, title: 'Late', due_date: '2026-10-01', days_overdue: 9 }],
  });
});

test('done tasks are not overdue', () => {
  const db = testDb();
  addTask(db, { title: 'Finished', status: 'done', due_date: '2026-10-20' });
  assert.deepEqual(buildReport(db, 1, '2026-10-10').overdue, []);
});

test('report endpoint: 200 for a project, 404 for a missing one', async (t) => {
  const api = await startServer(testDb());
  t.after(api.close);
  const ok = await api.call('GET', '/projects/1/report');
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.counts, { todo: 0, doing: 0, done: 0 });
  assert.equal((await api.call('GET', '/projects/9/report')).status, 404);
});
