'use strict';
// plans.js report: reads one planning reviewer's reply (ticket-reviewer, plan-reviewer), saved by
// hooks/ledger.js under .keel/local/tmp/planning/. The reply is checked against
// schemas/plan-findings.schema.json, then for what that schema cannot say (its validator has no oneOf
// or if): plan-reviewer has at most 10 findings and answers its checks for the plan; ticket-reviewer has
// at most 5 findings per ticket and speaks only of tickets; every finding id starts with the report's
// agent; an incomplete report says in `note` what is left. A report that fails is shown as failed, so it
// is never read as "no findings".
const fs = require('node:fs');
const path = require('node:path');
const { read, clean } = require('./repo-read.js');
const { linkOnWay } = require('./safe-path.js');
const { validate } = require('./schema.js');
const { extractJson } = require('../votes.js');

const SCHEMA = path.join(__dirname, '..', '..', 'schemas', 'plan-findings.schema.json');
const PLAN_MAX = 10;
const TICKET_MAX = 5;
const MAX_REASONS = 10;
// A draft ticket (T3) or an exported one, reviewed by its key when its feature is reopened.
const TICKET = /^(T[1-9][0-9]*|[A-Z][A-Z0-9]+-[0-9]+)$/;

const refuse = (why) => [`plans: report refused (${why})`];
const failed = (reasons) => ['report: failed', ...reasons.slice(0, MAX_REASONS).map((r) => `- ${clean(r, 200)}`), ...(reasons.length > MAX_REASONS ? [`- (+${reasons.length - MAX_REASONS} more)`] : [])];

// What the schema cannot check, as reasons.
function rules(r) {
  const out = [];
  if (r.agent === 'plan-reviewer') {
    if (r.findings.length > PLAN_MAX) out.push(`plan-reviewer has ${r.findings.length} findings; at most ${PLAN_MAX}`);
    r.checks.forEach((c, i) => { if (c.place !== 'plan') out.push(`checks[${i}] (${c.check}) is about ${c.place}; plan-reviewer answers its checks for the plan`); });
  } else {
    const per = new Map();
    for (const f of r.findings) per.set(f.place, (per.get(f.place) || 0) + 1);
    for (const [place, n] of per) if (TICKET.test(place) && n > TICKET_MAX) out.push(`${place} has ${n} findings; at most ${TICKET_MAX} per ticket`);
    r.checks.forEach((c, i) => { if (!TICKET.test(c.place)) out.push(`checks[${i}] (${c.check}) is about ${c.place}; ticket-reviewer speaks only of tickets (T<n> or a key)`); });
    r.findings.forEach((f) => { if (!TICKET.test(f.place)) out.push(`finding ${f.id} is about ${f.place}; ticket-reviewer speaks only of tickets (T<n> or a key)`); });
  }
  for (const f of r.findings) if (!f.id.startsWith(`${r.agent}-`)) out.push(`finding ${f.id} does not start with ${r.agent}`);
  if (r.status === 'incomplete' && !(typeof r.note === 'string' && r.note.trim())) out.push('status incomplete without a note of what is left');
  return out;
}

function reportCheck(root, file) {
  const dir = path.join(root, '.keel', 'local', 'tmp', 'planning');
  const full = path.resolve(root, typeof file === 'string' ? file : '');
  const inside = path.relative(dir, full);
  if (typeof file !== 'string' || !file || !inside || inside.startsWith('..') || path.isAbsolute(inside)) return refuse('only a file under .keel/local/tmp/planning/');
  const link = linkOnWay(root, full);
  if (link) return refuse(`${link}: keel does not read through it`);
  let text = null;
  try { if (fs.statSync(full).isFile()) text = read(full); } catch { /* missing */ }
  if (text === null) return failed(['the file cannot be read']);
  const r = extractJson(text);
  if (!r) return failed(['no JSON object in the reply']);
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const errors = validate(r, schema);
  if (errors.length) return failed(errors);
  const broken = rules(r);
  if (broken.length) return failed(broken);
  return [
    `report: ok · ${r.agent} · ${r.status} · findings ${r.findings.length}`,
    ...(r.status === 'incomplete' ? [`note: ${clean(r.note, 300)}`] : []),
    ...r.findings.map((f) => `- ${f.id} ${f.place} ${f.severity} ${f.check}: ${clean(f.what, 200)}`),
  ];
}

module.exports = { reportCheck };
