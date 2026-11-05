'use strict';
// `plans.js brief <feature> <file>`: a brief that /keel:start-task wrote for a task too big for one
// (.keel/local/plans/briefs/<name>-brief.md, the sections Goal, Files, Decisions and why, Open
// questions of keel's handoff format) goes into a new draft's plan.md, and the brief to keel's trash.
// The planning conversation may not run cleanup, so this command is how the brief leaves.
const fs = require('node:fs');
const path = require('node:path');
const { moveToTrash } = require('./trash.js');
const { read, clean } = require('./repo-read.js');
const { linkOnWay, unsafeRel } = require('./safe-path.js');
const { sections } = require('./tasks.js');
const plans = require('./plans.js');

// The brief's name is the feature's (lib/plans.js validFeature).
const BRIEF = /^\.keel\/local\/plans\/briefs\/([a-z0-9-]+)-brief\.md$/;
// The brief's section -> plan.md's section, and the prefix its list items are numbered with.
const MOVES = [
  { from: 'Goal', to: 'In plain words' },
  { from: 'Files', to: 'What was gathered' },
  { from: 'Decisions and why', to: 'Decisions', number: 'D' },
  { from: 'Open questions', to: 'Open questions', number: 'Q' },
];

const refuse = (why) => [`plans: brief refused (${why})`];
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

// For each line, whether it is outside ``` and ~~~ fences (fence lines themselves count as inside).
function outsideFences(lines) {
  let fence = null;
  return lines.map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && (!fence || (m[1][0] === fence[0] && m[1].length >= fence.length))) { fence = fence ? null : m[1]; return false; }
    return !fence;
  });
}

// Each top-level list item ("- x", "* x", "1. x") becomes "<prefix><n>. x", n the next number after
// the highest the section already has that the brief does not use itself. An item already numbered
// ("D3", "- D3", "- **D3**", read as lib/plans.js openQuestions reads them) keeps its number unless
// the section has it, then it takes the next one. Other lines and fenced blocks stay as they are.
function numbered(text, prefix, existing) {
  const own = new RegExp(`^\\s*(?:[-*]\\s+)?(\\*\\*)?${prefix}(\\d+)\\b`);
  const numbers = (lines) => {
    const open = outsideFences(lines);
    return lines.flatMap((l, i) => { const m = open[i] && own.exec(l); return m ? [Number(m[2])] : []; });
  };
  const had = new Set(numbers(existing.split('\n')));
  const lines = text.split('\n');
  const taken = new Set([...had, ...numbers(lines)]);
  let n = Math.max(0, ...had);
  const next = () => { do n += 1; while (taken.has(n)); taken.add(n); return n; };
  const open = outsideFences(lines);
  return lines.map((line, i) => {
    if (!open[i]) return line;
    const m = own.exec(line);
    if (m) return line.replace(own, (_, bold) => `${bold || ''}${prefix}${had.has(Number(m[2])) ? next() : m[2]}`);
    const item = /^(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
    return item ? `${prefix}${next()}. ${item[1]}` : line;
  }).join('\n');
}

// A template's line that says what goes there: "<D1. decision - why>".
const PLACEHOLDER = /^<[^<>]*>$/;

// plan.md with `content` added to the section `name`, after what it already holds (the template's
// placeholder lines give way).
function withSection(text, name, content) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${name}`);
  if (at < 0) return null;
  let end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const had = lines.slice(at + 1, end).filter((l) => !PLACEHOLDER.test(l.trim())).join('\n').trim();
  const body = had ? `${had}\n${content}` : content;
  return [...lines.slice(0, at + 1), body, '', ...lines.slice(end)].join('\n');
}

function briefCommand(root, feature, file) {
  if (typeof file !== 'string' || !file.trim()) return refuse('needs the brief file: plans.js brief <feature> .keel/local/plans/briefs/<name>-brief.md');
  const r = path.isAbsolute(file) ? rel(root, path.resolve(file)) : file.replace(/\\/g, '/').replace(/^\.\//, '');
  const named = BRIEF.exec(r);
  if (!named || !plans.validFeature(named[1])) return refuse(`${clean(file)} is not a brief: .keel/local/plans/briefs/<name>-brief.md`);
  const full = path.join(root, ...r.split('/'));
  const why = unsafeRel(root, r) || linkOnWay(root, full);
  if (why) return refuse(`${r}: ${why}`);
  const text = read(full);
  if (text === null || !fs.lstatSync(full).isFile()) return refuse(`no brief ${r}`);
  const brief = sections(text);
  if (!brief.Goal) return refuse(`${r} has no Goal section`);

  const { d: found, why: missing } = plans.needDraft(root, feature, 'brief');
  if (!found) return missing;
  let d;
  try { d = plans.settle(root, found); } catch (e) { return refuse(e.message); }
  if (d.fm.status !== 'draft') return refuse(`the plan is ${d.fm.status}`);

  let plan = d.text.replace(/\r\n/g, '\n');
  const moved = [];
  for (const m of MOVES) {
    const part = (brief[m.from] || '').replace(/\r\n/g, '\n');
    if (!part) continue;
    const next = withSection(plan, m.to, m.number ? numbered(part, m.number, sections(plan)[m.to] || '') : part);
    if (next === null) return refuse(`plan.md has no ${m.to} section`);
    plan = next;
    moved.push(m.to);
  }
  const planFile = path.join(d.folder, plans.PLAN_FILE);
  try { plans.writeFile(root, d, planFile, plan); } catch (e) { return refuse(e.message); }
  const out = [`brief: ${r} -> ${rel(root, planFile)} (${moved.join(', ')})`];
  const t = moveToTrash(root, [r], 'planning');
  out.push(t.batch ? `moved to keel's trash: batch ${t.batch} (/keel:cleanup restore ${t.batch} puts it back)`
    : `warning: ${r} not moved to keel's trash (${t.failed.map((f) => f.reason).join(', ')}): it stays, and brief again would add its sections a second time`);
  return out;
}

module.exports = { briefCommand };
