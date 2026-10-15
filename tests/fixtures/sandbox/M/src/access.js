'use strict';
// Who may do what in a project. Roles live in project_members: 'admin' or 'member'.

// The user's role in a project, or null when they are not a member.
function roleOf(db, projectId, userId) {
  const row = db.prepare('SELECT role FROM project_members WHERE user_id = ?').get(userId);
  return row ? row.role : null;
}

// Only admins of the task's project may delete it.
function canDeleteTask(db, userId, task) {
  return roleOf(db, task.project_id, userId) !== 'member';
}

module.exports = { roleOf, canDeleteTask };
