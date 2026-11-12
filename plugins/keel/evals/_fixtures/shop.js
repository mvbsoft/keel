'use strict';
// Builds the eval project in the current folder: a small configured shop with git and a bare remote
// in .git/eval-remote.git (inside the workspace, so the sandboxed run can push to it).
// Usage: node shop.js <base | tasks | finish | session | session-level | messy | overbuilt | planning |
//                      planning-openq | planning-ready | planning-repo | planning-new | planning-brief | planned |
//                      task-active | task-fresh | task-on-main | ticket-on-feature | worktree | db | db-rule |
//                      db-big | db-renamed | db-renamed-open | planning-db | adr-journal | adr-mixed |
//                      adr-living | adr-journal-breach | adr-living-breach>
//   base            no tasks, no note
//   worktree        base, and a linked worktree of it at .claude/worktrees/wt on branch wt (not entered)
//   tasks           handed-off tasks CAN-123 (discount, Jira link) and fix-reset-500 on their branches; on main
//   finish          task CAN-200 done and committed on its branch, checked out there
//   session         a long-work note (keys PAY-1) on branch payments-rework, checked out there, with this
//                   session's work not committed yet (the invoice provider)
//   session-level   as session, its Next action also says to end the session with Basic verification
//   messy           on main, committed: src/auth.js with the same reset() crash but tempting to tidy (var,
//                   mixed quotes, an unused helper, a stale comment), and an untidy src/report.js
//   overbuilt       task avg-total on its branch, its start recorded; not committed: a correct but
//                   over-engineered average() with its test, and an unexplained restyle of src/cart.js
//   task-active     tasks, with CAN-123 active again for the chat SID (status active, started recorded,
//                   committed), checked out on CAN-123-discount
//   task-fresh      tasks, with csv-report handed off on its branch after its plan was approved for a fresh
//                   conversation (execution: fresh): plan.md has 9 steps, none done; on main
//   task-on-main    task order-history working directly on main (branch = base = main), active for the chat
//                   SID, pushed; not committed: half of it, src/history.js with no tests, used nowhere
// The database variants (shop-db.js) add PostgreSQL migrations, users (about 2,000 rows), orders and a
// partner API (GET /api/orders with API keys), no maintenance mode:
//   db              committed on main
//   db-rule         db, and a committed CLAUDE.md: schema changes ship in one release, just apply the migration
//   db-big          db-rule, and the README says orders has about 3.5 million rows, busy all day
//   db-renamed      db-rule; not committed: users.name renamed to full_name in one migration, src/users.js moved to it;
//                   keel's protocols copied into .keel/local/tmp/keel for the reviewing agent
//   db-renamed-open as db-renamed on db: no rule, so the way to ship the rename was never chosen
//   planning-db     db, then planning-new
// The ADR variants (shop-adr.js) set docs profile 2 and commit records in docs/adr:
//   adr-journal     a journal (0001 superseded by 0003), no ADR style chosen
//   adr-mixed       neither style (0003 amends part of 0002, a correction note in 0001), no style chosen
//   adr-living      living records, one per topic, style living
//   adr-journal-breach  adr-journal with style journal; not committed: 0002 edited, 0004 supersedes part
//                   of 0002, docs/ops.md links the superseded 0001; keel's review rules in .keel/local/tmp/keel
//   adr-living-breach   adr-living; not committed: history marks in 0001, 0004 amends 0002, 0003 deleted
//                   while CLAUDE.md links it; keel's review rules in .keel/local/tmp/keel
// Every variant's config has the planning settings: ticket prefix INV, tickets in the repository.
// The planning variants add the invoices (src/invoices.js, src/server.js, public/invoices.html) on main:
//   planning        a draft csv-export on this machine (draft pc): plan.md and tickets T1, T2 (T2 depends
//                   on T1) written, both reviewed as they are, check clean, no open question; the chat SID
//                   plans csv-export; on main
//   planning-openq  as planning, with one open question Q1 in plan.md
//   planning-ready  as planning, the plan ready, and a committed AGENTS.md
//                   that says tickets live in Jira
//   planning-repo   as planning, the draft in the repository (draft repo): tickets/csv-export/ not committed
//   planning-new    a new draft notification-system on this machine, as plans.js new writes it, nothing
//                   gathered or asked yet; the chat SID plans it; on main
//   planning-brief  as planning-new, the draft made from start-task's brief (notification-system-brief.md):
//                   plans.js brief moved its sections into plan.md and the brief to keel's trash
//   planned         csv-export exported into tickets/csv-export/ (INV-1..INV-4, branch csv-export, merge_into
//                   main) and merged into main: INV-1 done on origin/main, INV-2 in progress (branch
//                   INV-2-download-button, its tip by Dana Smith), INV-3 done on its branch INV-3-date-range
//                   only (waiting for merge into the feature branch), INV-4 to do (depends on INV-3); on main
//   ticket-on-feature  csv-export exported and pushed; ticket INV-1 a task working directly on the shared
//                   feature branch (branch = base = csv-export), active for the chat SID; not committed:
//                   half of it, toCsv() in src/invoices.js with no tests and no route; on csv-export
const { base, worktree, messy } = require('./shop-base.js');
const { tasks, finish, session, overbuilt, taskActive, taskFresh, taskOnMain } = require('./shop-tasks.js');
const { planning, planningReady, planningNew, planningBrief, planned, ticketOnFeature } = require('./shop-planning.js');
const { db, dbRule, dbBig, dbRenamed } = require('./shop-db.js');
const { adrJournal, adrMixed, adrLiving, adrJournalBreach, adrLivingBreach } = require('./shop-adr.js');

const variant = process.argv[2] || 'base';

base();
if (variant === 'tasks') tasks();
else if (variant === 'finish') finish();
else if (variant === 'session') session();
else if (variant === 'session-level') session({ level: 'Basic' });
else if (variant === 'messy') messy();
else if (variant === 'overbuilt') overbuilt();
else if (variant === 'planning') planning();
else if (variant === 'planning-openq') planning({ openq: true });
else if (variant === 'planning-ready') planningReady();
else if (variant === 'planning-repo') planning({ where: 'repo' });
else if (variant === 'planning-new') planningNew();
else if (variant === 'planning-brief') planningBrief();
else if (variant === 'planned') planned();
else if (variant === 'task-active') taskActive();
else if (variant === 'task-fresh') taskFresh();
else if (variant === 'task-on-main') taskOnMain();
else if (variant === 'ticket-on-feature') ticketOnFeature();
else if (variant === 'worktree') worktree();
else if (variant === 'db') db();
else if (variant === 'db-rule') dbRule();
else if (variant === 'db-big') dbBig();
else if (variant === 'db-renamed') dbRenamed();
else if (variant === 'db-renamed-open') dbRenamed({ rule: false });
else if (variant === 'planning-db') { db(); planningNew(); }
else if (variant === 'adr-journal') adrJournal();
else if (variant === 'adr-mixed') adrMixed();
else if (variant === 'adr-living') adrLiving();
else if (variant === 'adr-journal-breach') adrJournalBreach();
else if (variant === 'adr-living-breach') adrLivingBreach();
else if (variant !== 'base') throw new Error(`unknown variant "${variant}"`);
