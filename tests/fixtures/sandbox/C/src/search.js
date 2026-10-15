'use strict';
// Title search within one project: substring match, newest first.
const tasks = require('./tasks.js');
const { HttpError } = require('./lib/http.js');
const { escapeLike } = require('./lib/text.js');

const QUERY_MAX = 100;

// q: the text to find, 1-100 characters after trimming; limit: already checked by the caller (1-100).
// SQLite's LIKE ignores case only for Latin letters, as the README says.
function searchTasks(db, projectId, q, limit) {
  if (!tasks.projectExists(db, projectId)) throw new HttpError(404, `project ${projectId} not found`);
  const text = typeof q === 'string' ? q.trim() : '';
  if (!text || text.length > QUERY_MAX) throw new HttpError(400, `q must be 1 to ${QUERY_MAX} characters`);
  const rows = db.prepare(
    "SELECT id, project_id, title, status, priority, assignee_id, due_date, created_at FROM tasks WHERE project_id = ? AND title LIKE ? ESCAPE '\\' ORDER BY created_at DESC, id DESC LIMIT ?",
  ).all(projectId, `%${escapeLike(text)}%`, limit);
  return rows.map((row) => ({ ...row }));
}

module.exports = { searchTasks, QUERY_MAX };
