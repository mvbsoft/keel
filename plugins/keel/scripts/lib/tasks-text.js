'use strict';
// Reading a task file: its "## " sections, first lines, step counts and front-matter updates (lib/tasks.js).
const path = require('node:path');
const { parseSteps, planAllowed } = require('../plan-steps.js');
const { read, clean } = require('./repo-read.js');

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const given = (v) => typeof v === 'string' && v !== '-' && !/^</.test(v);

// "## Name" sections of a task file: name -> text. "### " lines stay inside their section.
function sections(text) {
  const body = (text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const out = {};
  let name = null;
  for (const line of body.split(/\r?\n/)) {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m) { name = m[1]; out[name] = []; } else if (name) out[name].push(line);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.join('\n').trim()]));
}

const sectionNamed = (secs, name) => secs[name] ?? secs[Object.keys(secs).find((k) => k.startsWith(name)) || ''] ?? '';
const PLACEHOLDER = /^<[^<>]*>$/;
function firstLine(text, max = 160) {
  const line = (text || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()).find((l) => l && !PLACEHOLDER.test(l));
  return line ? clean(line, max) : '';
}

// The text of the task's plan file: `plan:` as an absolute path, else plan.md in the task folder, else
// `plan:` relative to the project; null when the plan is inline. A `plan:` file is read only where
// plan-steps.js reads plans (the project, Claude Code's plans folder): its headings leave the machine
// with the usage data.
function planText(root, task) {
  const p = task.fm.plan;
  const allowed = (file) => (planAllowed(root, file) ? read(file) : null);
  if (given(p) && p !== 'inline' && path.isAbsolute(p)) return allowed(p);
  if (task.planText !== null && task.planText !== undefined) return task.planText;
  return given(p) && p !== 'inline' && task.ref === null ? allowed(path.resolve(root, p)) : null;
}

// Steps done / total: from the plan file when it is readable, else from the task file (step blocks as
// plan-steps.js reads them, else list lines of the State section, or the older Plan section, that
// start with a status symbol).
function stepCounts(root, task) {
  const counted = (steps) => ({ done: steps.filter((s) => s.done).length, total: steps.length });
  const fromPlan = planText(root, task);
  const planned = fromPlan === null ? [] : parseSteps(fromPlan);
  if (planned.length) return counted(planned);
  const secs = sections(task.text);
  const own = secs.State !== undefined ? secs.State : sectionNamed(secs, 'Plan');
  const steps = parseSteps(own);
  if (steps.length) return counted(steps);
  const marks = [...own.matchAll(/^\s*(?:[-*]|\d+[.)])\s+([✅⬜◐⚠])/gmu)].map((m) => m[1]);
  return marks.length ? { done: marks.filter((m) => m === '✅').length, total: marks.length } : null;
}

// Replaces or adds "key: value" lines of the leading --- block; null when there is none.
function setFront(text, updates) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  if (!m) return null;
  let block = m[2];
  for (const [key, value] of Object.entries(updates)) {
    const line = `${key}: ${oneLine(value)}`;
    const re = new RegExp(`^${key}:.*$`, 'm');
    block = re.test(block) ? block.replace(re, () => line) : `${block}\n${line}`;
  }
  return m[1] + block + m[3] + text.slice(m[0].length);
}

module.exports = { given, oneLine, sections, sectionNamed, firstLine, planText, stepCounts, setFront };
