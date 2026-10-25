'use strict';
// One conversation, one lane. A conversation that plans a feature (its chat mark, lib/plans.js) does not
// start or finish tasks or sessions, set keel up or clean up; one that works on a task (its marker,
// lib/tasks.js) does not plan. A sessions lane leaves no mark, so start-planning's own instructions check
// for it. Planning needs a person: Claude Code gives hooks CLAUDE_CODE_SESSION_ATTENDED=0 in every
// `claude -p` (not documented; without it nothing is refused). Used by skill-gate.js (the Skill tool) and
// lane-gate.js (a typed command).
const { pickLanguage, translator } = require('./i18n.js');

const PLANNING_REFUSES = new Set(['start-task', 'end-task', 'start-session', 'end-session', 'configure', 'cleanup']);
const TASK_REFUSES = new Set(['start-planning', 'end-planning']);
const COMMANDS = new Set([...PLANNING_REFUSES, ...TASK_REFUSES]);

// Why keel's command `name` (without "keel:") does not run in this conversation, as { key, vars }, or null.
function refusal(project, sid, name, env = process.env) {
  if (name === 'start-planning' && env.CLAUDE_CODE_SESSION_ATTENDED === '0') return { key: 'lane.unattended', vars: {} };
  if (typeof project !== 'string' || project === '') return null;
  if (PLANNING_REFUSES.has(name)) {
    const feature = require('./plans.js').planningMark(project, sid);
    if (feature) return { key: 'lane.planning', vars: { feature, command: name } };
  }
  if (TASK_REFUSES.has(name)) {
    const task = require('./tasks.js').activeTask(project, sid);
    if (task) return { key: 'lane.task', vars: { id: task.id, command: name } };
  }
  return null;
}

// The refusal text in `language` (a language setting such as "uk"), or null.
function refusalText(project, sid, name, language, env) {
  const r = refusal(project, sid, name, env);
  return r && translator(pickLanguage(language))(r.key, r.vars);
}

module.exports = { COMMANDS, refusal, refusalText };
