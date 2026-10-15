'use strict';
// HTTP server. The company gateway in front of this service authenticates users and sets x-user-id.
const http = require('node:http');
const { open, seed } = require('./db.js');
const { HttpError, sendJson } = require('./lib/http.js');

const routes = [];

// pattern: '/projects/:projectId/tasks'; every :name matches a positive integer and arrives as a number.
function route(method, pattern, handler) {
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[1-9]\\d*)')}$`);
  routes.push({ method, re, handler });
}

require('./routes/projects.js')(route);
require('./routes/tasks.js')(route);

function userOf(req) {
  const id = Number(req.headers['x-user-id']);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function createServer(db = open()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = userOf(req);
    if (!userId) return sendJson(res, 401, { error: 'missing or invalid x-user-id' });
    const candidates = routes.filter((r) => r.re.test(url.pathname));
    const match = candidates.find((r) => r.method === req.method);
    if (!match) return sendJson(res, candidates.length ? 405 : 404, { error: candidates.length ? 'method not allowed' : 'not found' });
    const params = Object.fromEntries(Object.entries(match.re.exec(url.pathname).groups || {}).map(([k, v]) => [k, Number(v)]));
    try {
      const [status, body] = await match.handler({ db, req, url, params, userId });
      sendJson(res, status, body);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, e.details ? { error: e.message, details: e.details } : { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
}

if (require.main === module) {
  const db = open();
  seed(db);
  const port = Number(process.env.PORT) || 3000;
  createServer(db).listen(port, () => console.log(`tasker listening on ${port}`));
}

module.exports = { createServer };
