'use strict';
// Builds the code-comment rules for one project from hooks/comments.md: the common text plus the
// sections of the level in .keel/config.json (comments.level; "short" when unset or unreadable).
const fs = require('node:fs');
const path = require('node:path');
const { readJsonFile } = require('../scripts/lib/json.js');

const LEVELS = ['short', 'functions', 'detailed'];
const DEFAULT_LEVEL = 'short';

function projectLevel(project) {
  try {
    const config = readJsonFile(path.join(project, '.keel', 'config.json'));
    const level = config && config.comments && config.comments.level;
    return LEVELS.includes(level) ? level : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

function render(root, level) {
  const source = fs.readFileSync(path.join(root, 'hooks', 'comments.md'), 'utf8');
  const [common, ...levelParts] = source.split(/^<!-- level:/m);
  const part = levelParts.find((p) => p.startsWith(`${level} -->`)) || '';
  const section = (name) => {
    const m = part.match(new RegExp(`<!-- ${name} -->\\n([\\s\\S]*?)(?=<!-- |$)`));
    return m ? m[1].trim() : '';
  };
  return common
    .replaceAll('{{LEVEL}}', level)
    .replace('{{UNCLEAR}}', section('unclear'))
    .replace('{{PLAIN}}', section('plain'))
    .trim();
}

function commentRules(root, project) {
  return render(root, project ? projectLevel(project) : DEFAULT_LEVEL);
}

module.exports = { LEVELS, DEFAULT_LEVEL, projectLevel, render, commentRules };
