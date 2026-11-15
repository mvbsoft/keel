'use strict';
// Whether keel works in a project. keel is set up in a project by /keel:configure, which writes
// .keel/config.json; until then keel stays out of the way there: its hooks add nothing to the
// conversation and its agents and advisory skills are refused, so a plugin installed for every
// project changes nothing in the ones that do not use it. Usage recording and the status line are
// machine-wide and keep running (they cost no tokens and the model does not see them).
const fs = require('node:fs');
const path = require('node:path');

const { configHome, mainOf } = require('./project-dir.js');

// The project has a keel configuration (valid or not: keel's commands report a broken one); a linked
// worktree without one of its own has its main checkout's (lib/project-dir.js configHome).
function configured(project) {
  return typeof project === 'string' && project !== '' && fs.existsSync(path.join(configHome(project), '.keel', 'config.json'));
}

// keel has started in the project: configured, or /keel:configure is running (its scan writes .keel/local/).
function started(project) {
  return typeof project === 'string' && project !== '' && (fs.existsSync(path.join(project, '.keel')) || fs.existsSync(path.join(mainOf(project), '.keel')));
}

module.exports = { configured, started };
