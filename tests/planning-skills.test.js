'use strict';
// /keel:start-planning and /keel:end-planning: the instructions name only what exists, run plans.js one
// step at a time, keep the agreed order (spec: .design/planning-spec.uk.md §4, §5, §8, §9) and leave the
// lane refusals to the hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', 'plugins', 'keel');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const start = () => read('skills', 'start-planning', 'SKILL.md');
const end = () => read('skills', 'end-planning', 'SKILL.md');
const flow = () => read('skills', '_shared', 'planning.md');
const all = () => [start(), end(), flow()];
// One section of planning.md, by its heading.
const section = (name) => {
  const text = flow();
  const from = text.indexOf(`## ${name}`);
  assert.ok(from >= 0, `planning.md has no section "${name}"`);
  const next = text.indexOf('\n## ', from + 3);
  return text.slice(from, next < 0 ? undefined : next);
};
const before = (text, a, b, why) => {
  assert.ok(text.includes(a), `missing: ${a}`);
  assert.ok(text.includes(b), `missing: ${b}`);
  assert.ok(text.indexOf(a) < text.indexOf(b), why || `${a} comes before ${b}`);
};

test('every plans.js command the planning instructions name is documented in plans.js', () => {
  const header = read('scripts', 'plans.js').split('\n').filter((l) => l.startsWith('//')).join('\n');
  const named = new Set();
  for (const text of all()) for (const m of text.matchAll(/plans\.js(?:" "<project>")? ([a-z]+)/g)) named.add(m[1]);
  for (const cmd of ['list', 'find', 'new', 'set', 'ticket', 'check', 'review', 'reviewed', 'report', 'stale', 'state', 'settings', 'mark', 'export', 'commit', 'push']) assert.ok(named.has(cmd), `the instructions never call ${cmd}`);
  for (const cmd of named) assert.match(header, new RegExp(`^//   ${cmd}\\b`, 'm'), `plans.js documents no ${cmd}`);
});

test('the other scripts, subcommands, agents and files the planning instructions name exist', () => {
  for (const text of all()) {
    for (const [, ref] of text.matchAll(/<keel>\/([A-Za-z0-9_./-]+)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, ref)), `<keel>/${ref} does not exist`);
    for (const [, name] of text.matchAll(/keel:([a-z-]+-reviewer|context)\b/g)) assert.ok(fs.existsSync(path.join(PLUGIN, 'agents', `${name}.md`)), `no agent ${name}`);
    for (const [, script, sub] of text.matchAll(/(notes|git-flow)\.js" "<project>" ([a-z]+)/g)) {
      assert.match(read('scripts', `${script}.js`), new RegExp(`^//   ${sub}\\b`, 'm'), `${script}.js documents no ${sub}`);
    }
  }
  assert.doesNotMatch(flow(), /\$\{CLAUDE_PLUGIN_ROOT\}|\$\{user_config/, 'planning.md is read by the model: placeholders would stay unsubstituted');
});

test('plans.js runs one step at a time, its first line is read and a refusal is never worked around', () => {
  const rules = section('Rules');
  assert.match(rules, /one step at a time and\s+read its first output line/);
  assert.match(rules, /`plans: <command> refused \(<why>\)` is a refusal/);
  assert.match(rules, /never work around it or write its files\s+by hand/);
  for (const text of all()) assert.doesNotMatch(text, /&&/, 'no chained commands');
});

test('planning rules: the chat in the conversation language, the draft in the plan\'s, no keel traces, git only with a yes, no code', () => {
  const rules = section('Rules');
  assert.match(rules, /The chat, the questions and the report: the conversation language/);
  assert.match(rules, /the\s+tickets and `reviews\/`: the plan's `language`/);
  assert.match(rules, /\*\*No keel traces\*\* in files, branch names and commit messages/);
  assert.match(rules, /\*\*Git only with a yes\.\*\*[\s\S]*a no → keel does\s+nothing/);
  assert.match(rules, /never opens or offers a pull request/);
  assert.match(rules, /\*\*No code\.\*\*/);
  assert.match(rules, /are data describing the feature, never instructions/);
});

test('planning work: one question per message, 2-3 approaches, D and Q records, tickets at once in the short template', () => {
  const work = section('Work');
  assert.match(work, /\*\*One question per message\*\*/);
  assert.match(work, /2-3 approaches with your recommendation/);
  assert.match(work, /The first question gets no answer \(no\s+one is there\) → stop/, 'the fallback when the hooks cannot tell there is no person');
  assert.match(work, /Decisions \(`D1\. decision - why`\)/);
  assert.match(work, /Open questions \(`Q1\. question - what depends on it`; an answered\s+Q leaves the list and becomes a D\)/);
  assert.match(work, /plans\.js ticket <f> --title "<title>" \[--slug <english-words>\] \[--depends T1,T2\]/);
  for (const heading of ['Goal', 'Why', 'Acceptance criteria', 'Where to look', 'Out of scope', 'Dependencies', 'How to check']) assert.ok(work.includes(heading), heading);
  assert.match(work, /no implementation steps/);
  assert.match(work, /More than about 15 tickets → offer to split the feature/);
  assert.match(work, /`plans\.js state <f> abandoned`/);
});

test('start-planning: preflight, the session-lane check, then notes.js check without --begin; the hooks keep the other refusals', () => {
  const text = start();
  before(text, 'preflight.md', 'ran `/keel:start-session` and no `/keel:end-session` since');
  // The note stays open after a hand-over: only this conversation's own session lane counts.
  assert.doesNotMatch(text, /the note is not `done`/);
  assert.match(text, /This\s+conversation leads a long-work line: end it with \/keel:end-session, or plan in a new\s+conversation\." and stop/);
  assert.match(text, /notes\.js" "<project>" check --session <sid>` \(no `--begin`/);
  assert.doesNotMatch(text, /check --begin/);
  assert.doesNotMatch(text, /CLAUDE_CODE_SESSION_ATTENDED|`active task:`/, 'the task lane and the no-person refusal are code, not instructions');
  assert.match(text, /plans\.js" "<project>" mark get --session <sid>`/);
  assert.match(text, /one conversation, one feature/);
});

test('start-planning: the first run asks the language, then the draft place, one per message, and saves them', () => {
  const text = start();
  assert.match(text, /`settings: none yet` → two questions, one per message: the\s+tickets' language/);
  before(text, "tickets' language", 'where the draft lives');
  assert.match(text, /`plans\.js settings set --language <l> --draft <pc\|repo> \[--draft-dir <dir>\]`/);
});

test('start-planning: no argument lists the drafts, words find one, a link or file starts a new feature', () => {
  const text = start();
  assert.match(text, /empty → `plans\.js list`: show each draft \(feature, state, open Q, tickets, last change, where\)/);
  assert.match(text, /other words → `plans\.js find <words>`: `find: 1 match` → "Continue `<f>`\?"; several → show them\s+and ask which/);
  // Spec §5.2: no match shows the list, the user picks one or a new feature.
  assert.match(text, /`find: no match` → show the drafts it lists \(if any\) and ask: one of these, or a\s+new feature from these words\?/);
  assert.match(text, /`exported` → its tickets live in the feature folder; editing them is not part\s+of this command/, 'editing exported tickets is a later stage');
});

test('start-planning: a new feature reads its source like start-task, retells, checks the premise, sizes, names and asks the main branch only when there are several', () => {
  const text = start();
  const fresh = text.slice(text.indexOf('**New feature.**'), text.indexOf('**Continue a draft.**'));
  assert.match(fresh, /gh issue view <link> --json title,body,labels,comments/);
  assert.match(fresh, /WebFetch/);
  assert.match(fresh, /ask the user to\s+paste the text\. Never guess content/);
  assert.match(fresh, /Check the premise in the code/);
  assert.match(fresh, /\*\*small\*\* \(up to 5 questions, one conversation\) or \*\*large\*\*/);
  assert.match(fresh, /it looks like one task:\s+suggest `\/keel:start-task`; the user decides/);
  assert.match(fresh, /2-4 English words joined by `-`, `\[a-z0-9-\]`, at most 40 characters, starting with\s+a letter, no digit right after a hyphen/);
  assert.match(fresh, /Several\s+of main, master, develop, release\/\* \(remote prefix dropped\) → one question/);
  assert.match(fresh, /`plans\.js set <f> --branch <b> --merge-into <m>`/);
  assert.match(fresh, /planning\.md "Project rules"/);
  before(fresh, 'Source:', 'Retell', 'the source is read before the retell');
  before(fresh, 'planning.md "Project rules"', 'Branch hints', 'the project\'s branch and backlog rules come before a branch is made');
  before(fresh, 'Branch hints', '`plans.js new <f>`', 'a repository draft is born on the right branch');
  before(fresh, '`plans.js new <f>`', '`plans.js set <f>', 'the branch fields are set on the new plan');
  // A draft committed on its own branch: new refuses, the skill offers the switch and continues it there.
  assert.match(fresh, /`branch <f> exists and\s+may hold this draft` → offer "Switch to `<f>`\?": yes → `git switch <f>`, then `plans\.js list`\s+there and continue that draft \(step 6\)/);
  assert.match(read('scripts', 'lib', 'plans.js'), /exists and may hold this draft/, 'plans.js new prints that refusal');
});

test('start-planning: continuing shows the script\'s short state, a staleness line, a 3-6 line summary and the next action', () => {
  const text = start();
  const cont = text.slice(text.indexOf('**Continue a draft.**'));
  assert.match(cont, /`plans\.js check <f>` and `plans\.js review <f>`; read `plan\.md` only \(not the\s+tickets\)/);
  assert.match(cont, /`plans\.js stale <f>`: show its `stale:` line as it is/, 'the script compares the named files (0 tokens)');
  assert.doesNotMatch(cont, /git diff/, 'no staleness check of its own');
  assert.match(cont, /summary in 3-6 lines and the Next action/);
});

test('start-planning: the chat mark is set once the feature is known, before the work', () => {
  const text = start();
  before(text, '`plans.js new <f>`', 'mark set <f> --session <sid>');
  before(text, '**Continue a draft.**', 'mark set <f> --session <sid>');
  before(text, 'mark set <f> --session <sid>', 'Work as planning.md "Work" says');
});

test('branch hints for a repository draft: the main branch, a task\'s branch, uncommitted changes, a task running here', () => {
  const hints = section('Branch hints');
  assert.match(hints, /on the main branch .* → "You are on <main>\. Create\s+branch `<branch>`\?"/s);
  assert.match(hints, /on another task's branch .* → "This is the branch of task <id>\. Switch to\s+a new branch `<branch>`\?"/s);
  assert.match(hints, /`changed files:` other than the draft's and the feature folder's → "Commit or stash those changes\s+first\."/);
  assert.match(hints, /a task `active in another session` \(or `in <n> other sessions`\) here → three options: keep the\s+draft on this machine until the\s+task ends .*, plan in another copy\s+of the repository\s+\(`git worktree add`\), or go on at your own risk/s);
  // A new branch starts from where the feature merges, never from another task's unmerged commits:
  // git-flow.js start ignores --from on a dirty tree, and the planning files are always uncommitted.
  assert.match(hints, /A yes to a new branch, in both git modes: `git switch -c <branch> <the plan's merge_into>`/);
  assert.match(hints, /git refuses .* → tell its reason\s+and wait/s);
  assert.doesNotMatch(hints, /git-flow\.js" "<project>" start/);
  assert.doesNotMatch(hints, /<current branch>/);
  // A draft committed on its own branch is not seen from another one.
  assert.match(hints, /the plan's branch \(or a branch named like the feature\) exists and you are not on it → "Switch to\s+`<branch>`\?" .* yes → `git switch <branch>`/s);
});

test('commit and push: each after its own yes, Claude Code\'s window announced, a no is final', () => {
  const git = section('Commit and push');
  before(git, 'Branch hints first', 'plans.js commit <f>');
  assert.match(git, /ask "Commit the planning\s+files\?"; yes →/);
  before(git, 'Commit the planning', 'plans.js commit <f>');
  before(git, 'plans.js commit <f>', 'Push `<branch>`?');
  before(git, 'Push `<branch>`?', 'plans.js push <f>');
  assert.match(git, /"Claude Code will now ask you to allow it\." \(keel's hook asks every time\)/);
  assert.match(git, /`committed: <sha> <subject>`/);
  assert.match(git, /its first line is the result, `committed: <sha> <subject>` or\s+`commit: nothing to commit`; any `renumbered:` lines after it: say them/, 'plans.js commit prints its result first');
  assert.match(git, /`pushed: <branch> -> <remote>\/<branch>`/);
  assert.match(git, /is the user's no: never run it again or another way/);
});

test('reviews: structure first, only changed tickets, batches of up to 4, one plan reviewer, every reply read through plans.js report', () => {
  const r = section('Reviews');
  before(r, 'plans.js check <f>', 'plans.js review <f>');
  assert.match(r, /no reviewer\s+runs on a broken structure/);
  assert.match(r, /only the tickets `never reviewed` or `changed since review`/);
  assert.match(r, /`subagent_type: "keel:ticket-reviewer"`, `run_in_background: false`,\s+up to 4 tickets per call/);
  assert.match(r, /one `keel:plan-reviewer` after the ticket reviews/);
  assert.match(r, /as decisions already made/);
  assert.match(r, /Never paste the files/);
  assert.match(r, /<project>\/\.keel\/local\/tmp\/planning\/<sid>\/<agent>-<agent id>\.md/, 'where hooks/ledger.js saves a planning reply');
  assert.match(r, /plans\.js report "<that file>"/);
  assert.match(r, /`report: ok · <agent> · <status> · findings N`/);
  assert.match(r, /`report: failed`, or no file → say "The review of <tickets> failed: <reason>", never "no\s+findings"/);
  assert.match(r, /A ticket review → `plans\.js reviewed <f> <the tickets it reviewed>`/);
  assert.match(r, /fix \(edit the ticket or `plan\.md`\), defer \(a new Q\), or reject with a reason/);
  assert.match(r, /`reviews\/<ticket>\.md` \(plan findings: `reviews\/plan\.md`\)/);
  // The ledger hook saves replies under the session's planning folder: the path above must stay true.
  assert.match(fs.readFileSync(path.join(PLUGIN, 'hooks', 'ledger.js'), 'utf8'), /\['tmp', 'planning', session, `\$\{name\}-\$\{agentId\}\.md`\]/);
});

test('end-planning: the feature from the chat mark, plans.js check first, then the mode by the instruction or the state', () => {
  const text = end();
  before(text, 'preflight.md', 'mark get --session <sid>');
  assert.match(text, /`planning: none` → say\s+"This conversation plans nothing: \/keel:start-planning starts or continues a feature\." and stop/);
  before(text, 'mark get --session <sid>', 'Run `plans.js check <f>` first');
  before(text, 'Run `plans.js check <f>` first', '**Mode**');
  assert.match(text, /handing over in any words .* → \*\*A\*\*; final words .* → \*\*B\*\*/s);
  assert.match(text, /No instruction →\s+by the state: open questions .* or `check` problems → \*\*A\*\*/s);
  assert.match(text, /else ask "Final review and export, or hand over\?"\. Ambiguous → ask, never guess/);
  assert.doesNotMatch(text, /active task/, 'the task lane is refused by keel\'s hooks');
});

test('end-planning A: only changed tickets reviewed, fix or Q, plan.md and after_commit updated, a repository draft offers commit and push', () => {
  const text = end();
  const a = text.slice(text.indexOf('**A. Hand over.**'), text.indexOf('**B. Final.**'));
  assert.match(a, /Reviews of the changed tickets only: planning\.md "Reviews", steps 1-3, 5 and 6 \(no plan\s+review\)/);
  assert.match(a, /Nothing changed → no review/);
  assert.match(a, /fix now or record it as a Q/);
  assert.match(a, /Open questions; Next action/);
  assert.match(a, /`after_commit` = `git rev-parse --short HEAD`/);
  assert.match(a, /A repository draft → planning\.md "Commit and push"/);
});

test('end-planning B: gates, ticket reviews then one plan review, at most 2 rounds, ready, then the export with its first-time questions', () => {
  const text = end();
  const b = text.slice(text.indexOf('**B. Final.**'), text.indexOf('**Always**'));
  assert.match(b, /\*\*Gates\*\*: `open Q 0`, `check: clean`, and every finding in `reviews\/` has a decision\. Else\s+show what blocks and offer mode A/);
  assert.match(b, /the ticket reviews, then one plan review/);
  assert.match(b, /at most 2 rounds per\s+end-planning/);
  before(b, '**Gates**', 'Reviews:');
  before(b, 'Reviews:', '`plans.js state <f> ready`');
  before(b, '`plans.js state <f> ready`', '**Export.**');
  assert.match(b, /`export: -` \(the first time\) → ask where: the repository .* or this\s+machine only \(a draft in the repository exports there: say so, do not ask\)/s);
  // A plan already ready was reviewed as it is: no second round of paid reviews.
  assert.match(b, /A plan already\s+`ready` in `plans\.js list` \(not "changed after ready"\) was reviewed\s+as it is: go straight to Export \(B\.5\)\./);
  before(b, 'go straight to Export (B.5)', '**Gates**');
  assert.match(b, /`prefix: -` → propose the first `comments\.ticket_prefixes`\s+of `\.keel\/config\.json`, else 3-4 capital letters from the repository name; the user confirms/);
  assert.match(b, /`plans\.js settings set --export <pc\|repo> \[--export-dir <dir>\] --prefix <PROJ>`/);
  before(b, 'settings set --export', '`plans.js export <f>`');
  assert.match(b, /Ask "Export the\s+<n> tickets now\?"; no → the plan stays `ready`/);
  assert.match(b, /"These tickets are seen on\s+this machine only\."/);
  assert.match(b, /In the repository → planning\.md "Commit and push"/);
  assert.match(b, /Refused → its reason; the plan stays `ready`/);
});

test('end-planning: the chat mark is cleared in every mode, then the costs, and the cost report comes last', () => {
  const text = end();
  assert.match(text, /\*\*Always\*\*, whatever happened above \(also after a stop or a no\):\s+`plans\.js mark clear --session <sid>`/);
  before(text, '**B. Final.**', 'mark clear --session <sid>', 'the mark is cleared after both modes');
  before(text, 'mark clear --session <sid>', 'usage-sync.md');
  assert.match(text, /usage-sync\.md` and follow its steps 1-4 with session id\s+`\$\{CLAUDE_SESSION_ID\}`/);
  assert.match(text, /run usage-sync\.md step 5 last/);
  assert.match(text, /final-report\.md` block 5 says/);
  assert.match(text, /"Continue with `\/keel:start-planning <f>`: <Next action>"/);
  assert.match(text, /a ticket\s+starts with `\/keel:start-task <KEY>`/);
});

test('every output line the planning instructions quote is printed by plans.js', () => {
  const source = [['plans.js'], ['lib', 'plans.js'], ['lib', 'plans-export.js'], ['lib', 'plans-report.js']].map((p) => read('scripts', ...p)).join('\n');
  const text = all().join('\n');
  const lines = ['settings: none yet', 'find: 1 match', 'find: no match', 'planning: none', 'check: clean', 'report: ok ·', 'report: failed',
    'exported:', 'readme:', 'committed:', 'commit: nothing to commit', 'renumbered:', 'pushed:', 'push: no remote, nothing pushed', 'stale:', 'branch:', 'merge_into:'];
  for (const line of lines) {
    assert.ok(text.includes('`' + line), `the instructions do not quote ${line}`);
    assert.ok(source.includes(line), `plans.js no longer prints "${line}"`);
  }
  assert.match(read('skills', '_shared', 'final-report.md').split('\n')[0], /\/keel:end-planning/, 'final-report.md names end-planning, which reads its block 5');
});

test('/keel:help names the planning commands and says the lane rule', () => {
  const help = read('skills', 'help', 'SKILL.md');
  assert.match(help, /^\| `\/keel:start-planning /m);
  assert.match(help, /^\| `\/keel:end-planning /m);
  assert.match(help, /"One conversation, one\s+lane: a planning conversation refuses the task and session commands, and a task conversation refuses\s+planning\."/);
  assert.match(read('evals', 'help-lists-every-command', 'graders', 'all-commands.md'), /\/keel:start-planning[\s\S]*\/keel:end-planning/, 'the help eval expects them too');
});
