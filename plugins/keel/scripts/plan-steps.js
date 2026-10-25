'use strict';
// The steps of a task plan: checks that every step can be handed to an implementer (files, model,
// effort, a "done when" list), counts steps and files against .keel/config.json `delegation`, and
// proposes "here" or "delegate". Only reads.
// Plans are written in the user's language, so nothing here depends on words: a step is a level-3
// heading "<word> <n>: <title>" (numbered from 1, the same word each time), its fields are the
// top-level list items in a fixed order (files, model, effort, do, done when, then optionally the
// implementer's id, then status), and a status is a symbol: ✅ done, ⬜ not done, ◐ <n>% partial,
// ⚠ broken (worked once, fails now).
// Usage: node plan-steps.js <projectDir> <planFile> [--remaining]
//   planFile     a plan (templates/keel/plan.md format), a task file (.keel/tasks/<id>/task.md) or the note
//   --remaining  count only the steps that are not done (start-session: the work that is left)
// Above a threshold it also prints `ask:`, the here-or-delegate question in its only wording.
const fs = require('node:fs');
const path = require('node:path');
const { checkConfig, loadSchema } = require('./lib/config.js');
const os = require('node:os');
const { parseArgs } = require('./lib/project.js');
const { clean } = require('./lib/repo-read.js');

const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const ORDER = ['files', 'model', 'effort', 'do', 'done when'];
// Advice only: past this a Haiku or Sonnet step is probably several steps (or one piece that belongs on Opus).
const BIG_STEP = { files: 6, criteria: 6 };

const STEP = /^###\s+(?:([\p{L}<>]+)\s+)?(\d+)\s*[:.)]\s*(.*)$/u;
const HEADING = /^#{1,6}\s/;
const TOP_ITEM = /^ ?[-*]\s+(.*\S)\s*$/;
const SUB_ITEM = /^\s{2,}(?:\d+[.)]|[-*])\s+(.*\S)/;
const AGENT_ID = /^a?[0-9a-f]{12,}$/i;

// "label: value" (the label is in the user's language and only shown back).
function splitField(text) {
  const i = text.indexOf(':');
  return i > 0 && i < 40 ? { label: text.slice(0, i).trim(), value: text.slice(i + 1).trim() } : { label: '', value: text };
}

// The status is the leading word or else the first symbol: "⚠ broken, was ✅" is broken.
const SYMBOL_STATUS = { '✅': 'done', '⚠': 'broken', '◐': 'partial', '⬜': 'not done' };
function readStatus(value) {
  const v = (value || '').trim();
  const pct = /(\d+)\s*%/.exec(v);
  const word = /^(not done|done|broken|partial)\b/i.exec(v);
  const symbol = /[✅⬜◐⚠]/u.exec(v);
  const s = word ? word[1].toLowerCase() : symbol ? SYMBOL_STATUS[symbol[0]] : 'not done';
  if (s === 'partial') return { status: `partial${pct ? ` ${pct[1]}%` : ''}`, done: false };
  return { status: s, done: s === 'done' };
}
const isStatus = (value) => /[✅⬜◐⚠]/.test(value) || /^(done|not done|partial|broken)\b/i.test(value.trim());

// The step word: of the words that number level-3 headings from 1, the one used most often.
function stepWord(lines) {
  const count = new Map();
  const hasOne = new Set();
  for (const line of lines) {
    const head = STEP.exec(line);
    if (!head) continue;
    const w = (head[1] || '').toLowerCase();
    count.set(w, (count.get(w) || 0) + 1);
    if (Number(head[2]) === 1) hasOne.add(w);
  }
  let best = null;
  for (const [w, n] of count) if (hasOne.has(w) && (best === null || n > count.get(best))) best = w;
  return best;
}

function parseSteps(text) {
  const steps = [];
  const lines = text.split(/\r?\n/);
  const word = stepWord(lines);
  let step = null;
  for (const line of lines) {
    const head = STEP.exec(line);
    if (head) {
      const n = Number(head[2]);
      const w = (head[1] || '').toLowerCase();
      if (word !== null && w === word) {
        step = { n, title: head[3].trim(), items: [] };
        steps.push(step);
        continue;
      }
    }
    if (!step) continue;
    if (HEADING.test(line)) { step = null; continue; }
    const sub = SUB_ITEM.exec(line);
    if (sub && step.items.length) { step.items[step.items.length - 1].sub.push(sub[1]); continue; }
    const top = TOP_ITEM.exec(line);
    if (top) step.items.push({ ...splitField(top[1]), sub: [] });
  }
  for (const s of steps) {
    const rest = s.items.slice(ORDER.length);
    const statusItem = rest.find((it) => isStatus(it.value));
    const idItem = rest.find((it) => AGENT_ID.test(it.value));
    const [files, model, effort, todo, doneWhen] = s.items;
    s.fields = { files, model, effort, do: todo, doneWhen };
    s.files = [...((files && files.value) || '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
    s.model = ((model && model.value) || '').toLowerCase().split(/[\s(,;]/)[0];
    s.effort = ((effort && effort.value) || '').toLowerCase().split(/[\s(,;]/)[0];
    s.criteria = doneWhen ? doneWhen.sub : [];
    s.implementer = idItem ? idItem.value : null;
    Object.assign(s, readStatus(statusItem && statusItem.value));
  }
  return steps;
}

function problems(steps) {
  const out = [];
  if (!steps.length) return ['no steps: the plan needs level-3 headings "<word> 1: <title>", "<word> 2: ..." with the fields of the template'];
  steps.forEach((s, i) => {
    const at = `step ${s.n}`;
    const raw = (k) => (s.fields[k] ? s.fields[k].value : '');
    if (s.n !== i + 1) out.push(`${at}: numbered out of order (expected ${i + 1})`);
    if (s.items.length < ORDER.length) out.push(`${at}: ${s.items.length} fields; expected at least ${ORDER.length}, in this order: ${ORDER.join(', ')}, status`);
    if (!s.files.length) out.push(`${at}: field 1 (files) names no file in backticks`);
    if (!MODELS.includes(s.model)) out.push(`${at}: field 2 (model) "${raw('model')}" - use haiku, sonnet or opus`);
    if (!EFFORTS.includes(s.effort)) out.push(`${at}: field 3 (effort) "${raw('effort')}" - use ${EFFORTS.join(', ')}`);
    if (!raw('do')) out.push(`${at}: field 4 (do) is empty`);
    if (!s.criteria.length) out.push(`${at}: field 5 (done when) has no numbered list under it`);
    if ((s.model === 'sonnet' || s.model === 'haiku') && (s.files.length > BIG_STEP.files || s.criteria.length > BIG_STEP.criteria)) {
      out.push(`${at}: large for one ${s.model === 'haiku' ? 'Haiku' : 'Sonnet'} step (${s.files.length} files, ${s.criteria.length} criteria) - split it, or make it one Opus step and say why it is one piece`);
    }
  });
  return out;
}

function thresholds(root) {
  const { state, config } = checkConfig(root);
  if (state === 'ok' && config.delegation) return { ...config.delegation, from: '.keel/config.json delegation' };
  const d = loadSchema().properties.delegation.properties;
  return { min_plan_steps: d.min_plan_steps.default, min_plan_files: d.min_plan_files.default, from: `keel defaults${state === 'ok' ? '' : `, config ${state}`}` };
}

// The places keel's flows keep plans: the project (a task folder's plan.md, plansDirectory
// ./.keel/local/plans/claude) and Claude Code's own plans folder. Links are resolved first.
function planAllowed(root, file) {
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
  // A missing file is checked as written, so reading it reports ENOENT.
  const f = real(file) || path.resolve(file);
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const dirs = [root, path.join(claude, 'plans')];
  return [...dirs, ...dirs.map(real)].some((dir) => {
    if (!dir) return false;
    const r = path.relative(dir, f);
    return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r);
  });
}

// Text from the plan shown in a table cell or a line: no control characters, | escaped.
const cell = (v) => clean(v, 120).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

function summary(root, planFile, remaining) {
  if (!planAllowed(root, planFile)) throw new Error("the plan file must be inside the project or in Claude Code's plans folder");
  const steps = parseSteps(fs.readFileSync(planFile, 'utf8'));
  const counted = remaining ? steps.filter((s) => !s.done) : steps;
  const files = new Set(counted.flatMap((s) => s.files));
  const t = thresholds(root);
  const reasons = [];
  if (counted.length >= t.min_plan_steps) reasons.push(`${counted.length} steps >= ${t.min_plan_steps}`);
  if (files.size >= t.min_plan_files) reasons.push(`${files.size} files >= ${t.min_plan_files}`);
  const done = steps.filter((s) => s.done).length;
  const out = [
    `plan: ${clean(planFile, 400)}`,
    `steps: ${steps.length} (${done} done, ${steps.length - done} left)${remaining ? `; counted: the ${counted.length} left` : ''}`,
    `files: ${files.size} distinct in the counted steps`,
    `thresholds: ${t.min_plan_steps} steps or ${t.min_plan_files} files (${t.from})`,
    `suggest: ${reasons.length ? `delegate (${reasons.join(', ')})` : 'here (below both thresholds)'}`,
    ...(reasons.length ? [`ask: ${remaining ? 'Left' : 'Plan'}: ${counted.length} steps, ~${files.size} files. Do it here or delegate to implementers (each step to a fresh implementer on its model)?`] : []),
    `models: ${MODELS.map((m) => [m, counted.filter((s) => s.model === m).length]).filter(([m, n]) => n || m !== 'haiku').map(([m, n]) => `${m} ${n}`).join(', ')}`,
  ];
  if (steps.length) {
    out.push('| # | step | model | effort | files | criteria | status |', '|---|---|---|---|---|---|---|');
    for (const s of steps) out.push(`| ${s.n} | ${cell(s.title || '-')} | ${cell(s.model || '?')} | ${cell(s.effort || '?')} | ${s.files.length} | ${s.criteria.length} | ${s.status} |`);
  }
  const p = problems(steps);
  out.push(p.length ? 'problems:' : 'problems: none', ...p.map((x) => `- ${clean(x, 400)}`));
  return out;
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    if (!pos[1]) throw new Error('usage: plan-steps.js <projectDir> <planFile> [--remaining]');
    lines = summary(root, path.resolve(root, pos[1]), !!opts.remaining);
  } catch (e) {
    lines = [`plan-steps: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { parseSteps, problems, summary, planAllowed };
