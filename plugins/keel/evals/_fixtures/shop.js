'use strict';
// Builds the eval project in the current folder: a small configured shop with git and a bare remote
// in .git/eval-remote.git (inside the workspace, so the sandboxed run can push to it).
// Usage: node shop.js <base | tasks | finish | session | session-level | messy | overbuilt | planning |
//                      planning-openq | planning-ready | planning-repo | planning-new | planning-brief | planned |
//                      task-active | task-fresh>
//   base            no tasks, no note
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
const { base, messy } = require('./shop-base.js');
const { tasks, finish, session, overbuilt, taskActive, taskFresh } = require('./shop-tasks.js');
const { planning, planningReady, planningNew, planningBrief, planned } = require('./shop-planning.js');

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
else if (variant !== 'base') throw new Error(`unknown variant "${variant}"`);
