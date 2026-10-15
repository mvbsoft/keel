'use strict';
// Reads hooks/standards.md. The implementer gets the same text without the sections about talking to the
// user: it reports to the main session, which does the talking.
const fs = require('node:fs');
const path = require('node:path');

const USER_TALK = ['Talking to the user', 'Rules the user states'];

function standards(root, { implementer = false } = {}) {
  const text = fs.readFileSync(path.join(root, 'hooks', 'standards.md'), 'utf8');
  if (!implementer) return text;
  const sections = text.split(/^(?=## )/m);
  return `${sections.filter((s) => !USER_TALK.some((t) => s.startsWith(`## ${t}\n`))).join('').trimEnd()}\n`;
}

module.exports = { standards };
