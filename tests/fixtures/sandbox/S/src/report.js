'use strict';
// Project report: how many tasks are in each status, and which tasks are overdue.
const tasks = require('./tasks.js');
const { HttpError } = require('./lib/http.js');

const DAY = 24 * 60 * 60 * 1000;

function dayDiff(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

function sortTasks(rows) {
  const counts = Object.fromEntries(tasks.STATUSES.map((s) => [s, 0]));
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

// today: 'YYYY-MM-DD'.
function buildReport(db, projectId, today) {
  if (!tasks.projectExists(db, projectId)) throw new HttpError(404, `project ${projectId} not found`);
  const rows = db.prepare('SELECT status FROM tasks WHERE project_id = ?').all(projectId);
  const overdue = tasks.listOverdue(db, projectId, today).map((t) => ({
    id: t.id,
    title: t.title,
    due_date: t.due_date,
    days_overdue: dayDiff(t.due_date, today),
  }));
  return { project_id: projectId, counts: sortTasks(rows), overdue };
}

module.exports = { buildReport };
