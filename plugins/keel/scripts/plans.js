'use strict';
// keel's planned features (/keel:start-planning, /keel:end-planning): one folder per feature, on this
// machine (.keel/local/plans/keel/<feature>/) or in the repository (<tickets_dir>/<feature>/), as
// planning.place says (lib/plans.js). Writes only the feature's files (an elsewhere ticket's in its
// repository's folder of the feature), the settings and the chat marks; a dropped feature folder goes
// to keel's trash. Every command is a script: the same result each time,
// no agent. git beyond reading runs only in `tickets --fetch` (a fetch, not confirmed), commit and push
// (lib/plans-git.js); Claude Code confirms each commit and push (hooks/own-files.js).
// The result is the first output line; a refusal is `plans: <command> refused (<why>)`. Exit code 0.
// Usage: node plans.js <projectDir> <command>
//   list                                  the features: name, state (needs review), open questions,
//                                         tickets, last change, folder
//   find <words...>                       the features whose folder name or In plain words has the words:
//                                         one match, several, or none (then all features)
//   new <feature> [--place repo|pc]       a feature folder with plan.md (status draft) where --place, else
//                                         planning.place, else pc says; refused for an invalid or taken name
//   ticket <feature> --title <t> [--slug <english-words>] [--depends "T1,T2"] [--repo <name>]
//                                         tickets/T<n>-<slug>.md, status draft, not reviewed; T-numbers are
//                                         never reused; depends_on names tickets of the feature; --repo:
//                                         planned here for another repository on this machine (its name in
//                                         the repos map, plans.js repos). The plan's status stays
//   ticket <feature> --title <t> [--slug ...] [--depends ...] --elsewhere <name>
//                                         the ticket in that repository (keel set up there):
//                                         <its tickets_dir>/<feature>/tickets/T<n>-<slug>.md, with a plan.md
//                                         that names this project as home when there is none; here a
//                                         type: elsewhere file with the same T<n> (lib/plans-repos.js)
//   ticket <feature> --title <t> [--slug ...] [--depends ...] --stub <name>
//                                         a stub (type: stub) for a repository not on this machine
//                                         (lib/plans-stubs.js)
//   ticket <feature> --from-stub <T<n>>   the stub as a full ticket once its repository is here
//   check <feature>                      the structure (lib/plans-format.js): the "# [id] title" heading,
//                                         sections once and in their order, the Boundaries labels, acceptance
//                                         criteria as a list, no TBD or <...> (not in a closed ticket), the
//                                         files Where to look names exist, status and depends_on valid, no cycles. Another repository's
//                                         ticket (repo:) is checked in its folder, an elsewhere one there;
//                                         without one: a `note:`. Then `warn:` for a ticket whose branch is
//                                         merged into merge_into while it is not done, and `plan:` when every
//                                         ticket is done or abandoned (an elsewhere one whose status cannot
//                                         be read: confirmation needed)
//   review <feature>                      the plan and each ticket: never reviewed, changed since review
//                                         (an essential section or depends_on), unchanged
//   reviewed <feature> <T1|plan> [...]    record the review hashes after the review (plan: its ready hash)
//   state <feature> <draft|ready|in-progress|done|abandoned> [--reason <why>] [--confirm] [--project <path>]
//                                         the plan's status. ready needs a clean check, a ticket and no
//                                         open question, and readies every draft ticket that needs no
//                                         review; abandoned needs --reason and abandons every open ticket
//                                         with it; done waits for every ticket to be done or abandoned
//                                         (--confirm: the user said so for an elsewhere ticket whose status
//                                         cannot be read). Elsewhere tickets change in their repository
//   status <feature> <T<n>> <draft|ready|in-progress|done|abandoned> [--reason <why>] [--branch <b>] [--project <path>]
//                                         one ticket's status. ready waits for its review; abandoned needs
//                                         --reason; in-progress (not from draft; --branch: the task's branch,
//                                         into the ticket's branch field) moves a ready plan to in-progress.
//                                         --project: the project that holds the feature, for a session in
//                                         another repository
//   set <feature> [--branch <b>] [--merge-into <b>] [--after-commit]
//                                         the feature branch and where it merges (plan.md branch,
//                                         merge_into); after_commit and the HEAD of each other repository
//                                         the tickets name (after_commit_repos). The status stays
//   stale <feature>                       which files the tickets name in Where to look changed since
//                                         plan.md after_commit (commits and uncommitted changes); another
//                                         repository's tickets in its folder since its after_commit_repos
//   repos                                 this project and the repositories a feature may also touch: the
//                                         repos map and the git repositories next to this project, each
//                                         with its name (owner/name when two share one) and whether keel is
//                                         set up there
//   report <file>                         a planning reviewer's reply under .keel/local/tmp/planning/
//                                         (absolute, or relative to the project): its
//                                         findings, or `report: failed` and why (never "no findings")
//   commit <feature>                      the feature folder into git as it is, on the current branch, also
//                                         a feature folder removed by drop; never on the main branch
//   push <feature>                        the current branch to the remote; a push failed on the network or
//                                         access: `retry:` and the command
//   tickets [<feature> | <feature>/T<n>] [--fetch]
//                                         the tickets' states from their status fields: no argument, every
//                                         ready or in-progress feature with a ticket not done or abandoned;
//                                         one feature (and its branch); one ticket (and its file, its
//                                         status on the remote's plan branch, `remote:`, and its
//                                         dependencies). `next:` the ticket to take next: ready, no stub,
//                                         reviewed, every dependency done. --fetch: git fetch --prune first
//   move <feature> --to repo|pc           the feature folder as it is between the repository
//                                         (<tickets_dir>/<feature>/) and this machine
//                                         (.keel/local/plans/keel/<feature>/); refused when the target
//                                         exists, a ticket is in progress, a task names a ticket of it
//                                         (task.md `ticket: <feature>/T<n>`) or the folder has uncommitted
//                                         changes. --to pc: once committed, the folder leaves git for everyone
//   drop <feature>                       a feature whose every ticket is done or abandoned: its folder to
//                                         keel's trash (a repository folder only off the branch it merges
//                                         into; then commit <feature>)
//   brief <feature> <file>                a brief of /keel:start-task
//                                         (.keel/local/plans/briefs/<name>-brief.md) into a draft plan.md:
//                                         Goal, Files, Decisions and why, Open questions to In plain words,
//                                         What was gathered, Decisions (D<n>), Open questions (Q<n>); the
//                                         brief to keel's trash
//   settings                              the planning settings: this machine's
//                                         (.keel/local/plans/keel/settings.json) and the project's
//                                         (.keel/config.json planning); `planning: planning is not set up`
//                                         without planning.place
//   settings set --repo <name>=<absolute folder>
//                                         this machine's: where a neighbouring repository is (one per call);
//                                         the name is that repository's (plans.js repos)
//   mark set <feature> --session <id>     this chat plans the feature (not a done or abandoned one)
//   mark get --session <id>               the feature this chat plans, or none
//   mark clear --session <id>             this chat plans nothing
const path = require('node:path');
const { parseArgs } = require('./lib/project.js');
const plans = require('./lib/plans.js');

const COMMANDS = 'list, find, new, ticket, check, review, reviewed, state, status, set, stale, repos, report, commit, push, tickets, move, drop, brief, settings, mark';

// A flag followed by a word takes it as its value (lib/project.js): `tickets --fetch f` names f.
const flagged = (pos, opts, flag) => ({ on: opts[flag] !== undefined, arg: pos[2] ?? (typeof opts[flag] === 'string' ? opts[flag] : undefined) });

function run(root, pos, opts) {
  const command = pos[1] || 'list';
  const feature = pos[2];
  if ((command === 'state' || command === 'status') && opts.project !== undefined) {
    if (typeof opts.project !== 'string' || !opts.project.trim()) return [`plans: ${command} refused (--project needs the project's folder)`];
    root = path.resolve(opts.project);
    if (!require('./lib/plans-repos.js').isFolder(root)) return [`plans: ${command} refused (--project: ${root} is no folder)`];
  }
  if (command === 'list') return plans.draftList(root);
  if (command === 'find') return plans.draftFind(root, pos.slice(2).join(' '));
  if (command === 'new') return plans.draftNew(root, feature, { place: opts.place });
  if (command === 'ticket') return plans.ticketNew(root, feature, opts);
  if (command === 'check') return plans.draftCheck(root, feature);
  if (command === 'review') return plans.draftReview(root, feature);
  if (command === 'reviewed') return plans.draftReviewed(root, feature, pos.slice(3).map((x) => x.toUpperCase()));
  if (command === 'state') return plans.draftState(root, feature, pos[3], { reason: opts.reason, confirm: opts.confirm });
  if (command === 'status') return plans.ticketStatus(root, feature, pos[3], pos[4], { reason: opts.reason, branch: opts.branch });
  if (command === 'set') return plans.draftSet(root, feature, opts);
  if (command === 'stale') return plans.draftStale(root, feature);
  if (command === 'repos') return require('./lib/plans-repos.js').reposCommand(root);
  if (command === 'report') return require('./lib/plans-report.js').reportCheck(root, pos[2]);
  if (command === 'commit' || command === 'push') {
    const step = require('./lib/plans-git.js')[command === 'commit' ? 'commitFeature' : 'pushFeature'];
    return step(root, feature, { repo: opts.repo });
  }
  if (command === 'tickets') { const f = flagged(pos, opts, 'fetch'); return require('./lib/plans-state.js').ticketsCommand(root, f.arg, { fetch: f.on }); }
  if (command === 'move') return require('./lib/plans-state.js').moveCommand(root, feature, opts.to);
  if (command === 'drop') return require('./lib/plans-state.js').dropCommand(root, feature);
  if (command === 'brief') return require('./lib/plans-brief.js').briefCommand(root, feature, pos[3]);
  if (command === 'settings') {
    const settings = require('./lib/plans-settings.js');
    if (!pos[2]) return settings.settingsShow(root);
    if (pos[2] !== 'set') return [`plans: unknown settings command "${pos[2]}" (set)`];
    return settings.settingsSet(root, opts);
  }
  if (command === 'mark') return plans.markCommand(root, pos[2], pos[3], opts.session);
  return [`plans: unknown command "${command}" (${COMMANDS})`];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = require('./lib/project-dir.js').scriptProject(pos[0]);
    lines = run(root, pos, opts);
  } catch (e) {
    lines = [`plans: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { run };
