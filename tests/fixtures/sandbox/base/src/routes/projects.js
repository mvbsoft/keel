'use strict';
const tasks = require('../tasks.js');
const { HttpError, readJson, intParam } = require('../lib/http.js');

module.exports = function projectRoutes(route) {
  route('GET', '/projects/:projectId', ({ db, params }) => {
    const project = tasks.getProject(db, params.projectId);
    if (!project) throw new HttpError(404, `project ${params.projectId} not found`);
    return [200, project];
  });

  route('GET', '/projects/:projectId/tasks', ({ db, params, url }) => {
    if (!tasks.projectExists(db, params.projectId)) throw new HttpError(404, `project ${params.projectId} not found`);
    const assignee = url.searchParams.has('assignee') ? intParam(url, 'assignee', { min: 1, max: Number.MAX_SAFE_INTEGER }) : undefined;
    const list = tasks.listTasks(db, params.projectId, {
      status: url.searchParams.get('status') || undefined,
      assignee,
      limit: intParam(url, 'limit', { min: 1, max: 100, fallback: 50 }),
      offset: intParam(url, 'offset', { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
    });
    return [200, list];
  });

  route('POST', '/projects/:projectId/tasks', async ({ db, params, req }) => {
    const body = await readJson(req);
    return [201, tasks.createTask(db, params.projectId, body)];
  });
};
