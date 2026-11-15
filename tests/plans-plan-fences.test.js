'use strict';
// plan.md reads its "## " headings as tickets do: a line inside a code block is text, and a section
// that stands twice is a problem. The overview export builds from plan.md keeps the whole section.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LOCAL, write, readRel, run, planning, setup, ready, gitTest } = require('./fixtures/plans-export.js');

const PLAN = `${LOCAL}/s3-storage/plan.md`;
const SAMPLE = 'Sample file:\n\n```md\n## Decisions\nD9. fake\n## Terms\n```\n\nAfter the sample, more words.';

function draft() {
  const { work } = setup({ remote: false });
  ready(work, 's3-storage');
  return work;
}
const check = (work) => run(work, 'check', 's3-storage').filter((l) => !l.startsWith('status:'));
const edit = (work, from, to) => write(work, PLAN, readRel(work, PLAN).replace(from, to));

gitTest('export: a "## " line inside a code block of plan.md stays in its section of the overview', () => {
  const work = draft();
  edit(work, 'Upload and download files on S3; T1 comes first.', `Upload and download files on S3; T1 comes first.\n\n${SAMPLE}`);
  assert.deepEqual(check(work), ['check: clean (plan.md and 2 tickets)']);
  assert.deepEqual(run(work, 'state', 's3-storage', 'ready'), ['status: ready']);
  planning(work, { tickets: 'pc', ticket_prefix: 'PROJ' });
  assert.match(run(work, 'export', 's3-storage')[0], /^exported: /);
  const readme = readRel(work, `${LOCAL}/s3-storage/tickets/README.md`);
  assert.ok(readme.includes(`${SAMPLE.replace('T1', 'PROJ-1')}\n\n## Level`), readme);
  assert.match(readme, /^## Decisions\nD1\. Use the SDK/m);
});

gitTest('check: a section of plan.md that stands twice is a problem; a heading only in a code block is no section', () => {
  const work = draft();
  edit(work, '## Terms\nBucket: the S3 folder of the project.\n', '```md\n## Terms\n```\n');
  assert.deepEqual(check(work), ['check: 1 problems', '- plan.md: no section "## Terms"']);
  edit(work, '```md\n## Terms\n```\n', '## Terms\nBucket.\n\n## Decisions\nD2. Again.\n');
  assert.deepEqual(check(work), ['check: 1 problems', '- plan.md: "## Decisions" appears twice']);
});

gitTest('find: words after a code block that holds a "## " line still count as In plain words', () => {
  const work = draft();
  edit(work, 'Upload and download files on S3; T1 comes first.', 'Upload files.\n\n```md\n## Fake\n```\n\nReconciling warehouse inventory.');
  assert.deepEqual(run(work, 'find', 'warehouse', 'inventory').slice(0, 1), ['find: 1 match']);
});

gitTest('brief: a section of plan.md with a code block that holds a "## " line takes the brief at its end', () => {
  const work = draft();
  run(work, 'new', 'order-notices');
  const plan = `${LOCAL}/order-notices/plan.md`;
  write(work, plan, readRel(work, plan).replace(/^## Decisions\n[\s\S]*?\n(?=## )/m, '## Decisions\n```md\n## Terms\n```\nD3. After the sample.\n\n'));
  write(work, '.keel/local/plans/briefs/order-notices-brief.md', '## Goal\nNotices.\n\n## Decisions and why\n- Mail through SMTP\n');
  assert.match(run(work, 'brief', 'order-notices', '.keel/local/plans/briefs/order-notices-brief.md')[0], /^brief: /);
  assert.ok(readRel(work, plan).includes('## Decisions\n```md\n## Terms\n```\nD3. After the sample.\nD4. Mail through SMTP\n\n## '), readRel(work, plan));
});

gitTest('list: open questions of a code block in plan.md are not counted', () => {
  const work = draft();
  edit(work, 'Export.\n', 'Export.\n\n```md\n## Open questions\nQ9. fake\n```\n');
  assert.ok(run(work, 'list').every((l) => !/open Q [1-9]/.test(l)), run(work, 'list').join('\n'));
});
