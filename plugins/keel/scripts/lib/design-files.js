'use strict';
// The design system's files (templates/design): every keel page is published with all of them beside it.
const path = require('node:path');

const DESIGN_DIR = path.join(__dirname, '..', '..', 'templates', 'design');
const DESIGN_FILES = ['keel.css', 'keel-theme.js', 'keel-mark.png'];

module.exports = { DESIGN_DIR, DESIGN_FILES };
