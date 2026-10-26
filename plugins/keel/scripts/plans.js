'use strict';
// keel's planning drafts (/keel:start-planning, /keel:end-planning): one folder per feature, on this
// machine (.keel/local/plans/keel/<feature>/) or in the repository (<draft_dir>/<feature>/), as the
// planning settings say (lib/plans.js). Writes only the draft files, the exported tickets (and their
// status), the settings and the chat marks; an abandoned or exported draft on this machine and a dropped
// feature folder go to keel's trash. git beyond reading runs only in export and `tickets --fetch` (a
// fetch, not confirmed), commit and push (lib/plans-export.js); Claude Code confirms each commit and
// push (hooks/own-files.js). The state of exported tickets: lib/plans-state.js.
// The result is the first output line; a refusal is `plans: <command> refused (<why>)`. Exit code 0.
// Usage: node plans.js <projectDir> <command>
//   list                                  the drafts: feature, state, open questions, tickets, last change
//   find <words...>                       the drafts whose folder name or Summary has the words: one match,
//                                         several, or none (then all drafts)
//   new <feature>                         a draft folder with plan.md (status draft); refused for an invalid
//                                         or taken name
//   ticket <feature> --title <t> [--slug <english-words>] [--depends T1,T2]
//                                         tickets/T<n>-<slug>.md; T-numbers are never reused. An exported
//                                         feature: <KEY>-<slug>.md in its folder with the next key (as
//                                         export gives them), status todo, --depends K1,K2
//   check <feature>                       the structure: sections, acceptance criteria, no TBD or <...>, the
//                                         files Where to look names exist, depends_on valid, no cycles; an
//                                         exported feature: its tickets, depends_on are keys
//   review <feature>                      per ticket: never reviewed, changed since review, unchanged
//   reviewed <feature> <T1> [T2...]       record the tickets' review hashes after their review
//   state <feature> <draft|ready|exported|abandoned>   move the plan; ready needs a clean check, no open
//                                         questions and every ticket reviewed as it is
//   set <feature> [--branch <b>] [--merge-into <b>]   the feature branch and where it merges (plan.md
//                                         branch, merge_into); a ready plan becomes a draft again
//   stale <feature>                       which files the tickets name in Where to look changed since
//                                         plan.md after_commit (commits and uncommitted changes)
//   report <file>                         a planning reviewer's reply under .keel/local/tmp/planning/
//                                         (absolute, or relative to the project): its
//                                         findings, or `report: failed` and why (never "no findings")
//   export <feature>                      a ready plan's tickets into the feature folder with keys shared
//                                         across the repository (export, export_dir, prefix settings); all
//                                         or nothing
//   commit <feature>                      the feature's planning files into git on the current branch (keys
//                                         checked again, taken ones renumbered), also a feature folder
//                                         removed by drop; never on the main branch
//   push <feature>                        the current branch to the remote after the same key check
//   tickets [<feature> | <KEY>] [--fetch] the exported tickets' state: no argument, every feature with a
//                                         ticket not done; one feature (and its branch); one key (and
//                                         its file and dependencies); `next:` the ticket to take next.
//                                         --fetch: git fetch --prune first
//   done <KEY> [--undo]                   status done (--undo: todo) in the working tree's ticket with that
//                                         key; says when every ticket of its feature is done
//   drop <feature>                        a feature whose every ticket is done: its folder to keel's trash
//                                         (a repository folder only off the branch it merges into; then
//                                         commit <feature>)
//   settings                              the planning settings (.keel/local/plans/keel/settings.json)
//   settings set [--language <l>] [--draft pc|repo] [--draft-dir <dir>] [--export pc|repo]
//                [--export-dir <dir>] [--prefix <PROJ>]
//   mark set <feature> --session <id>     this chat plans the feature: a draft, or an exported feature
//                                         whose folder is in the working tree (the mark keeps the folder)
//   mark get --session <id>               the feature this chat plans, or none
//   mark clear --session <id>             this chat plans nothing
const path = require('node:path');
const { parseArgs } = require('./lib/project.js');
const plans = require('./lib/plans.js');

const COMMANDS = 'list, find, new, ticket, check, review, reviewed, state, set, stale, report, export, commit, push, tickets, done, drop, settings, mark';

// A flag followed by a word takes it as its value (lib/project.js): `done --undo PROJ-1` names PROJ-1.
const flagged = (pos, opts, flag) => ({ on: opts[flag] !== undefined, arg: pos[2] ?? (typeof opts[flag] === 'string' ? opts[flag] : undefined) });

function run(root, pos, opts) {
  const command = pos[1] || 'list';
  const feature = pos[2];
  if (command === 'list') return plans.draftList(root);
  if (command === 'find') return plans.draftFind(root, pos.slice(2).join(' '));
  if (command === 'new') return plans.draftNew(root, feature);
  if (command === 'ticket') return plans.ticketNew(root, feature, opts);
  if (command === 'check') return plans.draftCheck(root, feature);
  if (command === 'review') return plans.draftReview(root, feature);
  if (command === 'reviewed') return plans.draftReviewed(root, feature, pos.slice(3).map((x) => x.toUpperCase()));
  if (command === 'state') return plans.draftState(root, feature, pos[3]);
  if (command === 'set') return plans.draftSet(root, feature, opts);
  if (command === 'stale') return plans.draftStale(root, feature);
  if (command === 'report') return require('./lib/plans-report.js').reportCheck(root, pos[2]);
  if (command === 'export') return require('./lib/plans-export.js').exportFeature(root, feature);
  if (command === 'commit') return require('./lib/plans-export.js').commitFeature(root, feature);
  if (command === 'push') return require('./lib/plans-export.js').pushFeature(root, feature);
  if (command === 'tickets') { const f = flagged(pos, opts, 'fetch'); return require('./lib/plans-state.js').ticketsCommand(root, f.arg, { fetch: f.on }); }
  if (command === 'done') { const f = flagged(pos, opts, 'undo'); return require('./lib/plans-state.js').doneCommand(root, f.arg, f.on); }
  if (command === 'drop') return require('./lib/plans-state.js').dropCommand(root, feature);
  if (command === 'settings') {
    if (!pos[2]) return plans.settingsShow(root);
    if (pos[2] !== 'set') return [`plans: unknown settings command "${pos[2]}" (set)`];
    // --draft-dir and --export-dir name the draft_dir and export_dir settings.
    const named = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k.replace(/-/g, '_'), v]));
    return plans.settingsSet(root, named);
  }
  if (command === 'mark') return plans.markCommand(root, pos[2], pos[3], opts.session);
  return [`plans: unknown command "${command}" (${COMMANDS})`];
}

if (require.main === module) {
  let lines;
  try {
    const { opts, pos } = parseArgs(process.argv.slice(2));
    const root = path.resolve(pos[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    lines = run(root, pos, opts);
  } catch (e) {
    lines = [`plans: unavailable (${e.message})`];
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

module.exports = { run };
