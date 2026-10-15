'use strict';
const tasks = require('../tasks.js');
const workload = require('../workload.js');
const { HttpError, readJson } = require('../lib/http.js');
const { toDay } = require('../lib/dates.js');

function requireProject(db, projectId) {
  if (!tasks.projectExists(db, projectId)) throw new HttpError(404, `project ${projectId} not found`);
}

module.exports = function workloadRoutes(route) {
  route('POST', '/projects/:projectId/assign', async ({ db, params, req }) => {
    requireProject(db, params.projectId);
    const body = await readJson(req);
    return [200, await workload.assignTasks(db, params.projectId, body.task_ids, body.assignee_id)];
  });

  route('GET', '/projects/:projectId/week', ({ db, params, url }) => {
    requireProject(db, params.projectId);
    return [200, workload.dueInWeek(db, params.projectId, url.searchParams.get('date') || toDay(new Date()))];
  });

  route('GET', '/projects/:projectId/export.csv', ({ db, params }) => {
    requireProject(db, params.projectId);
    return [200, workload.exportCsv(db, params.projectId), 'text/csv; charset=utf-8'];
  });
};
