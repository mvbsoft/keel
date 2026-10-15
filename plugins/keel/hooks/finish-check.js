'use strict';
// Stop hook: a finish must not end half-done. When this session moved a finished task's folder to
// keel's trash (autonomous git, lib/finish.js state `deleted`) and neither a commit holds it nor was it
// put back, the turn does not end: the reason says what to run. A record older than a day, or whose
// task is no longer in keel's trash, is ignored. Never blocks while Claude Code is
// already continuing because of a stop hook, or when the last message asks the user something (the
// finish waits for the answer). Fails soft: any error lets the turn end.
const fs = require('node:fs');
const path = require('node:path');

// A question to the user ends the message: "?" possibly followed by closing marks or formatting.
const ASKS = /[?？][\s*_`'"»”)\]]*$/;

function decide(input, project, keel) {
  if (!input || input.stop_hook_active === true) return null;
  const sid = input.session_id;
  if (typeof sid !== 'string' || !project) return null;
  // A valid task id, a record younger than a day and the task still in keel's trash: a stale or
  // planted record cannot hold every turn.
  const { pendingFinish } = require(path.join(keel, 'scripts', 'lib', 'finish.js'));
  const pending = pendingFinish(project, sid);
  if (!pending) return null;
  if (typeof input.last_assistant_message === 'string' && ASKS.test(input.last_assistant_message.trim())) return null;
  const scripts = path.join(keel, 'scripts');
  const id = pending.id;
  return {
    decision: 'block',
    reason: `keel: task ${id}'s folder went to keel's trash in this finish, but no commit holds it and it was not put back. `
      + `Go on with the finish's git steps (skills/_shared/git.md) with --finish ${id} --session ${sid}: a step that stops puts the task back by itself. `
      + `If the finish will not be committed now, run node "${path.join(scripts, 'notes.js')}" "${project}" task restore ${id} --session ${sid} and tell the user the task stays active.`,
  };
}

if (require.main === module) {
  let out = null;
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    out = decide(input, process.env.CLAUDE_PROJECT_DIR || input.cwd, process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..'));
  } catch { out = null; }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

module.exports = { decide };
