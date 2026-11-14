'use strict';
// The shop with decision records in docs/adr, for the ADR-style cases: records kept as a journal, as
// living records, or mixed (records that amend each other), and an uncommitted change that breaks the
// chosen style for the docs reviewer.
const fs = require('node:fs');
const path = require('node:path');
const { KEEL, root, write, commitAll } = require('./shop-base.js');

const adr = (n, title, status, body) => write(`docs/adr/${n}.md`, `# ${title}\n\nStatus: ${status}\n\n${body}`);
const section = (context, decision, consequences, alternatives) =>
  `## Context\n${context}\n\n## Decision\n${decision}\n\n## Consequences\n${consequences}\n\n## Alternatives considered\n${alternatives}\n`;

function docs(change) {
  const file = path.join(root, '.keel', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.docs = { ...config.docs, ...change };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

const QUEUE = section('Payment confirmations and e-mails must not be lost when the app restarts.',
  'Background jobs go through a Redis queue (BullMQ); a failed job is retried 3 times.',
  'Redis is one more service to run and back up.',
  '- RabbitMQ: more to operate for a few hundred jobs a day.\n- Jobs in memory: lost on restart.');

// The journal: 0001 superseded by 0003, which restates it; the rules link the current records.
function adrJournal() {
  docs({ profile: 2 });
  adr('0001-database', 'PostgreSQL on our own server', 'Superseded by 0003', section('Orders and users need transactions.',
    'Orders and users live in PostgreSQL 16 on our own server.', 'We run backups ourselves.', '- MySQL: weaker JSON support.'));
  adr('0002-job-queue', 'Job queue', 'Accepted', QUEUE);
  adr('0003-managed-database', 'Managed PostgreSQL', 'Accepted', `Supersedes 0001.\n\n${section('Our own server needs backups and upgrades by hand.',
    'Orders and users live in PostgreSQL 16, managed by the hosting provider, with daily backups.', 'A monthly fee; no superuser access.', '- PostgreSQL on our own server (0001): backups and upgrades by hand.\n- MySQL: weaker JSON support.')}`);
  write('CLAUDE.md', '# mini-shop rules\n\nDecisions: the database is in docs/adr/0003-managed-database.md, the job queue in docs/adr/0002-job-queue.md.\n');
  commitAll('Decision records');
}

// Neither style: one record amends another and has a correction note.
function adrMixed() {
  docs({ profile: 2 });
  adr('0001-database', 'PostgreSQL', 'Accepted', `${section('Orders and users need transactions.', 'Orders and users live in PostgreSQL 16.', 'We run backups ourselves.', '- MySQL: weaker JSON support.')}\nCorrection 2026-05-04: backups are daily, not weekly.\n`);
  adr('0002-job-queue', 'Job queue', 'Accepted', QUEUE);
  adr('0003-queue-retries', 'More retries for jobs', 'Accepted', 'Amends 0002, part "Decision": a failed job is retried 5 times instead of 3; the rest of 0002 holds.\n');
  write('CLAUDE.md', '# mini-shop rules\n\nDecisions: docs/adr/ (read 0003 together with 0002).\n');
  commitAll('Decision records');
}

// Living records, one per topic; the rules link the cache record.
function adrLiving() {
  docs({ profile: 2, adr_style: 'living' });
  adr('0001-database', 'Database', 'Accepted', section('Orders and users need transactions.', 'Orders and users live in PostgreSQL 16.', 'We run backups ourselves.', '- MySQL: weaker JSON support.'));
  adr('0002-job-queue', 'Job queue', 'Accepted', QUEUE);
  adr('0003-price-cache', 'Price cache', 'Accepted', section('The price list is read on every cart change.', 'Prices are cached in the process (an LRU of 1,000 items, 5 minutes).', 'Each app instance has its own cache.', '- A Redis cache: a network hop for a small list.'));
  write('CLAUDE.md', '# mini-shop rules\n\nDecisions: docs/adr/. The price cache: docs/adr/0003-price-cache.md.\n');
  commitAll('Decision records');
}

// A non-interactive run cannot read outside its workspace, so keel's review rules are copied into
// .keel/local/tmp/keel (ignored by git) for the reviewing agent to read there.
function copyRules() {
  for (const rel of ['protocols', 'skills/_shared/adr-journal.md', 'skills/_shared/adr-living.md']) {
    if (fs.existsSync(path.join(KEEL, rel))) fs.cpSync(path.join(KEEL, rel), path.join(root, '.keel', 'local', 'tmp', 'keel', rel), { recursive: true });
  }
}

// The journal, chosen; not committed: an accepted record edited, a partial supersede, a new link to a
// superseded record.
function adrJournalBreach() {
  adrJournal();
  docs({ adr_style: 'journal' });
  commitAll('ADR style: journal');
  copyRules();
  adr('0002-job-queue', 'Job queue', 'Accepted', QUEUE.replace('retried 3 times', 'retried 5 times'));
  adr('0004-queue-retries', 'Retry delays', 'Accepted', 'Supersedes the "Decision" part of 0002 only: retries wait 1, 5 and 25 minutes. The rest of 0002 holds.\n\n## Alternatives considered\n- Retry at once: a down mail server gets hammered.\n');
  write('docs/ops.md', '# Operations\n\nThe database and its backups: see docs/adr/0001-database.md.\n');
}

// Living, chosen; not committed: history marks in a record, a new record that amends another, a deleted
// record still linked from the rules.
function adrLivingBreach() {
  adrLiving();
  copyRules();
  adr('0001-database', 'Database', 'Accepted', `${section('Orders and users need transactions.', 'Orders and users live in PostgreSQL 17.', 'We run backups ourselves.', '- MySQL: weaker JSON support.')}\nAmended 2026-11-12 (correction): was: PostgreSQL 16.\n`);
  adr('0004-queue-retries', 'More retries for jobs', 'Accepted', 'Amends 0002: a failed job is retried 5 times instead of 3.\n\n## Alternatives considered\n- Keep 3 retries: too many lost e-mails.\n');
  fs.rmSync(path.join(root, 'docs', 'adr', '0003-price-cache.md'));
}

module.exports = { adrJournal, adrMixed, adrLiving, adrJournalBreach, adrLivingBreach };
