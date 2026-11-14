'use strict';
// Messages and edges of plans.js: a stub key in a report, a flag in a refusal, a repeated export, an
// exported draft's files in a project below the top folder of its repository, a draft that is not seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { tempDir } = require('./fixtures/tmp.js');
const { LOCAL, write, readRel, run, planning, setup, ready, gitTest } = require('./fixtures/plans-export.js');
const { SCRIPTS } = require('./fixtures/keel-project.js');
const { TICKET } = require(path.join(SCRIPTS, 'lib', 'plans-report.js'));
const schema = require(path.join(SCRIPTS, '..', 'schemas', 'plan-findings.schema.json'));

test('report: a stub key is a ticket the schema allows', () => {
  const dir = tempDir('keel-report-');
  const finding = { id: 'ticket-reviewer-1', place: 'ADM-S1', check: 'scope', severity: 'minor', what: 'w', problem: 'p', fix: 'f', evidence: 'e' };
  const reply = { agent: 'ticket-reviewer', status: 'complete', checks: [{ place: 'ADM-S1', check: 'scope', answer: 'no' }], findings: [finding] };
  write(dir, '.keel/local/tmp/planning/s1/ticket-reviewer-a1.md', `\`\`\`json\n${JSON.stringify(reply)}\n\`\`\`\n`);
  assert.deepEqual(run(dir, 'report', '.keel/local/tmp/planning/s1/ticket-reviewer-a1.md'), [
    'report: ok · ticket-reviewer · complete · findings 1',
    '- ticket-reviewer-1 ADM-S1 minor scope: w',
  ]);
});

test('report: the ticket keys the script takes are the ticket keys of the schema place pattern', () => {
  const pattern = schema.$defs.place.pattern;
  const tickets = pattern.slice('^('.length, pattern.indexOf('|plan|'));
  assert.equal(TICKET.source, `^(${tickets})$`);
});

gitTest('settings set: a refusal names the flag as it is typed', () => {
  const { work } = setup({ remote: false });
  assert.deepEqual(run(work, 'settings', 'set', '--draft-dir', '../x'), ['plans: settings set refused (--draft-dir: contains ..)']);
  assert.deepEqual(run(work, 'settings', 'set', '--draft', 'nope'), ['plans: settings set refused (--draft: pc or repo)']);
});

gitTest('export: a feature that is exported already says so, not "no draft"', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  assert.match(run(work, 'export', 's3-storage')[0], /^exported: /);
  assert.deepEqual(run(work, 'export', 's3-storage'), [`plans: export refused (s3-storage is exported already: its tickets are in ${LOCAL}/s3-storage/tickets/)`]);
  assert.match(run(work, 'export', 'no-such-plan')[0], /refused \(no draft "no-such-plan"/);
});

gitTest('a plan.md whose status is in quotes is a draft all the same; two ticket files with one number are a problem', () => {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  const plan = `${LOCAL}/s3-storage/plan.md`;
  write(work, plan, readRel(work, plan).replace(/^status: ready$/m, 'status: "draft"'));
  assert.match(run(work, 'list')[1], /^- s3-storage: draft /);
  assert.match(run(work, 'check', 's3-storage')[0], /^check: /);
  const tickets = `${LOCAL}/s3-storage/tickets`;
  write(work, `${tickets}/T01-ticket-one-again.md`, readRel(work, `${tickets}/T1-ticket-1.md`));
  assert.ok(run(work, 'check', 's3-storage').includes('- T1: two files have this number: T01-ticket-one-again.md, T1-ticket-1.md'), run(work, 'check', 's3-storage').join('\n'));
});
