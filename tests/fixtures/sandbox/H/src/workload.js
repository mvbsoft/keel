'use strict';
// Workload: bulk assignment with a per-person limit, the tasks due in a week, and a CSV export.
const tasks = require('./tasks.js');
const { HttpError } = require('./lib/http.js');
const { isDay, addDays, weekday } = require('./lib/dates.js');
const { csvField } = require('./lib/text.js');
const { notifyAssigned } = require('./lib/notify.js');

const MAX_OPEN_PER_PERSON = 5;

function openCount(db, userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_id = ? AND status != 'done'").get(userId).n;
}

// Assigns every task in taskIds to assigneeId; the person may hold at most MAX_OPEN_PER_PERSON open tasks.
async function assignTasks(db, projectId, taskIds, assigneeId) {
  if (!Array.isArray(taskIds) || !taskIds.length || !taskIds.every((id) => Number.isInteger(id) && id > 0)) {
    throw new HttpError(400, 'task_ids must be a non-empty list of task ids');
  }
  if (!Number.isInteger(assigneeId) || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(assigneeId)) {
    throw new HttpError(400, 'assignee_id must be an existing user');
  }
  if (openCount(db, assigneeId) + taskIds.length > MAX_OPEN_PER_PERSON) {
    throw new HttpError(409, `a person can have at most ${MAX_OPEN_PER_PERSON} open tasks`);
  }
  const assigned = [];
  for (const id of taskIds) {
    const task = tasks.getTask(db, id);
    if (!task || task.project_id !== projectId) throw new HttpError(404, `task ${id} not found in project ${projectId}`);
    db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(assigneeId, id);
    await notifyAssigned(assigneeId, task);
    assigned.push(id);
  }
  return { assignee_id: assigneeId, assigned };
}

// Monday to Sunday of the week that contains `day`.
function weekOf(day) {
  const start = addDays(day, 1 - weekday(day));
  return { start, end: addDays(start, 6) };
}

function dueInWeek(db, projectId, day) {
  if (!isDay(day)) throw new HttpError(400, 'date must be a date like 2026-10-31');
  const { start, end } = weekOf(day);
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE project_id = ? AND due_date >= ? AND due_date <= ? ORDER BY due_date, id',
  ).all(projectId, start, end);
  return { start, end, tasks: rows.map((row) => ({ ...row })) };
}

const EXPORT_COLUMNS = ['id', 'title', 'status', 'assignee', 'due_date', 'estimate_hours'];

function exportCsv(db, projectId) {
  const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(projectId);
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const t of rows) {
    const user = t.assignee_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(t.assignee_id) : null;
    lines.push([t.id, t.title, t.status, user ? user.name : '', t.due_date, t.estimate_hours].map(csvField).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { assignTasks, weekOf, dueInWeek, exportCsv, MAX_OPEN_PER_PERSON };
