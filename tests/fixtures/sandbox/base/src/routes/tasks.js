'use strict';
const tasks = require('../tasks.js');
const { HttpError, readJson } = require('../lib/http.js');

module.exports = function taskRoutes(route) {
  route('GET', '/tasks/:taskId', ({ db, params }) => {
    const task = tasks.getTask(db, params.taskId);
    if (!task) throw new HttpError(404, `task ${params.taskId} not found`);
    return [200, task];
  });

  route('PATCH', '/tasks/:taskId', async ({ db, params, req }) => {
    const body = await readJson(req);
    return [200, tasks.updateTask(db, params.taskId, body)];
  });
};
