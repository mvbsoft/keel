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
//   find <words...>                       the drafts whose folder name or In plain words has the words:
//                                         one match, several, or none (then all drafts)
//   new <feature>                         a draft folder with plan.md (status draft); refused for an invalid
//                                         or taken name
//   ticket <feature> --title <t> [--slug <english-words>] [--depends "T1,T2"] [--repo <PREFIX>]
//                                         tickets/T<n>-<slug>.md; T-numbers are never reused; --repo: the
//                                         ticket is for another repository of the plan's repos. An exported
//                                         feature: <KEY>-<slug>.md in its folder with the next key (as
//                                         export gives them), status todo, --depends "K1,K2", --repo: in
//                                         that repository's folder of the feature; a line in Tickets of
//                                         every overview of the feature on this machine
//   check <feature>                       the structure (lib/plans-format.js): the "# [id] title" heading,
//                                         sections once and in their order, the Boundaries labels, acceptance criteria as a list, no TBD or <...>,
//                                         the files Where to look names exist, depends_on valid, no cycles;
//                                         an exported feature: its tickets, depends_on are keys. Another
//                                         repository's key (ticket --depends too) is looked up in its
//                                         folder from the repos map; none there: `note: ... not checked`.
//                                         Another repository's ticket (repo:) is checked in its folder;
//                                         without one: `note: ... Where to look not checked`
//   review <feature>                      per ticket: never reviewed, changed since review, unchanged;
//                                         another repository's ticket with its folder
//   reviewed <feature> <T1> [T2...]       record the tickets' review hashes after their review
//   state <feature> <draft|ready|exported|abandoned>   move the plan; ready needs a clean check, no open
//                                         questions and every ticket reviewed as it is
//   set <feature> [--branch <b>] [--merge-into <b>] [--repos "WEB,MOB" | -] [--after-commit]
//                                         the feature branch and where it merges (plan.md branch,
//                                         merge_into); the repositories of a feature on several (repos:,
//                                         from the repos map); after_commit and each other repository's
//                                         HEAD (after_commit_repos); a ready plan becomes a draft again
//   stale <feature>                       which files the tickets name in Where to look changed since
//                                         plan.md after_commit (commits and uncommitted changes); another
//                                         repository's tickets in its folder since its after_commit_repos
//   repos                                 this project and the repositories a feature may also touch: the
//                                         repos map and the git repositories next to this project, each
//                                         with its planning prefix
//   report <file>                         a planning reviewer's reply under .keel/local/tmp/planning/
//                                         (absolute, or relative to the project): its
//                                         findings, or `report: failed` and why (never "no findings")
//   export <feature> [--as-is "WEB,MOB"]  a ready plan's tickets into the feature folder with keys shared
//                                         across the repository (planning in .keel/config.json); all or
//                                         nothing. A plan on several repositories: each repository's
//                                         tickets into its own folder by its own settings and keys, the
//                                         same overview in each; refused while another repository is not
//                                         ready (--as-is: its uncommitted changes or other branch are fine)
//   commit <feature> [--repo <PREFIX>]    the feature's planning files into git on the current branch (keys
//                                         checked again in every repository of the feature, taken ones
//                                         renumbered), also a feature folder removed by drop; never on the
//                                         main branch. --repo: in that repository's folder from the repos map
//   push <feature> [--repo <PREFIX>]      the current branch to the remote after the same key check; a
//                                         push failed on the network or access: `retry:` and the command
//   tickets [<feature> | <KEY>] [--fetch] the exported tickets' state: no argument, every feature with a
//                                         ticket not done; one feature (and its branch); one key (and
//                                         its file, dependencies and where their code is); `next:` the
//                                         ticket to take next.
//                                         No argument: then `linked:` lines, the tickets of each
//                                         feature's other repositories (lib/plans-linked.js).
//                                         --fetch: git fetch --prune first
//   align <feature> [--take <PREFIX>]     the versions of a feature's overview in its repositories on this
//                                         machine, the sections where they differ and the default one;
//                                         --take: that version into the others' working trees (not committed)
//   done <KEY> [--undo]                   status done (--undo: todo) in the working tree's ticket with that
//                                         key; says when every ticket of its feature is done
//   drop <feature>                        a feature whose every ticket is done: its folder to keel's trash
//                                         (a repository folder only off the branch it merges into; then
//                                         commit <feature>)
//   settings                              the planning settings: this machine's
//                                         (.keel/local/plans/keel/settings.json) and the project's
//                                         (.keel/config.json planning); `planning: planning is not set up`
//                                         without the project's
//   settings set [--draft pc|repo] [--draft-dir <dir>] [--repo <PREFIX>=<absolute folder>]
//                                         this machine's: where drafts live, where a neighbouring
//                                         repository is (one --repo per call)
//   mark set <feature> --session <id>     this chat plans the feature: a draft, or an exported feature
//                                         whose folder is in the working tree (the mark keeps the folder)
//   mark get --session <id>               the feature this chat plans, or none
//   mark clear --session <id>             this chat plans nothing
const path = require('node:path');
const { parseArgs } = require('./lib/project.js');
const plans = require('./lib/plans.js');

const COMMANDS = 'list, find, new, ticket, check, review, reviewed, state, set, stale, repos, report, export, commit, push, tickets, align, done, drop, settings, mark';

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
  if (command === 'repos') return require('./lib/plans-repos.js').reposCommand(root);
  if (command === 'report') return require('./lib/plans-report.js').reportCheck(root, pos[2]);
  if (command === 'export') {
    const asIs = opts['as-is'];
    if (asIs !== undefined && (typeof asIs !== 'string' || !asIs.trim())) return ['plans: export refused (--as-is needs the prefixes: --as-is "WEB,MOB")'];
    return require('./lib/plans-export-repos.js').exportFeature(root, feature, { asIs: asIs ? asIs.split(/[\s,;]+/).filter(Boolean) : [] });
  }
  if (command === 'commit' || command === 'push') {
    if (opts.repo !== undefined && (typeof opts.repo !== 'string' || !opts.repo.trim())) return [`plans: ${command} refused (--repo needs a ticket prefix: --repo WEB)`];
    const step = require('./lib/plans-export.js')[command === 'commit' ? 'commitFeature' : 'pushFeature'];
    return step(root, feature, { repo: opts.repo });
  }
  if (command === 'tickets') { const f = flagged(pos, opts, 'fetch'); return require('./lib/plans-state.js').ticketsCommand(root, f.arg, { fetch: f.on }); }
  if (command === 'align') return require('./lib/plans-linked.js').alignCommand(root, feature, { take: opts.take });
  if (command === 'done') { const f = flagged(pos, opts, 'undo'); return require('./lib/plans-state.js').doneCommand(root, f.arg, f.on); }
  if (command === 'drop') return require('./lib/plans-state.js').dropCommand(root, feature);
  if (command === 'settings') {
    const settings = require('./lib/plans-settings.js');
    if (!pos[2]) return settings.settingsShow(root);
    if (pos[2] !== 'set') return [`plans: unknown settings command "${pos[2]}" (set)`];
    // --draft-dir names the draft_dir setting.
    const named = Object.fromEntries(Object.entries(opts).map(([k, v]) => [k.replace(/-/g, '_'), v]));
    return settings.settingsSet(root, named);
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
