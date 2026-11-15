'use strict';
// Where a planning chat mark is: .keel/local/plans/keel/sessions/<session id>.json in the main checkout
// (lib/project-dir.js mainOf), so it holds in the main checkout and in every worktree of it. Light, with
// no heavy imports: hooks check it on every tool call before loading lib/plans.js.
const path = require('node:path');
const { mainOf } = require('./project-dir.js');

const MARKS = ['plans', 'keel', 'sessions'];
const markHome = (root) => mainOf(root);
const marksDir = (root) => path.join(markHome(root), '.keel', 'local', ...MARKS);
const markFile = (root, sid) => path.join(marksDir(root), `${sid}.json`);

module.exports = { MARKS, markHome, marksDir, markFile };
