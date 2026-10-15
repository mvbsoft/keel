'use strict';
// Assignment notices go to a log file that the chat bot tails (TASKER_NOTIFY_LOG; off when unset).
const fs = require('node:fs/promises');

async function notifyAssigned(userId, task) {
  const file = process.env.TASKER_NOTIFY_LOG;
  if (!file) return;
  const line = JSON.stringify({ at: new Date().toISOString(), user_id: userId, task_id: task.id, title: task.title });
  await fs.appendFile(file, `${line}\n`);
}

module.exports = { notifyAssigned };
