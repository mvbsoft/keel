# keel verification (core of /keel:end-task and /keel:end-session)

The calling command gives you `<keel>` (plugin folder), `<project>` (project folder), the language to
talk in, the task (from the task file, the note or the conversation: goal and acceptance criteria) and
any choices the user already made in their instruction (e.g. a level). This flow covers steps
1-12 (12 keeps the result for the final report). Git and the ending belong to the calling command.

Principles: scripts decide what scripts can decide; the user chooses the level and what to fix; only
summaries and failures go into this conversation; every agent gets the same files, never the chat.
Run every keel script exactly as written here, one plain command each (preflight.md).

Two hard rules for the whole flow:
- **No code changes before step 10**, except the comment notes (step 1) and fixing red gates this
  change caused (step 2). A problem
  you notice yourself while reading goes into the list as your own item (source "session", status
  "not verified (session)") for steps 8-9. Agents must see the change as it was written, and the user
  decides what gets fixed.
- **Step 9 always stops for the user's answer** when there is a must or should item, also in a
  non-interactive run and also when the instruction chose a level: a level is not an answer to "what
  to fix". With no must or should item, step 9 only reports (nice items as one line) and goes on to
  step 12 with nothing fixed; the user can still ask for a nice item.
- **Steps 6 and 7 always run** once agents ran: `votes.js plan` decides which findings need a verifier
  (proven QA findings and minor ones skip it by its rules), not you; "obvious from the code" is not a
  reason to skip. A fingerprint compare that is not `same` stops the flow at once (step 5b): ask before
  anything else, ending the turn with that question when you cannot ask interactively.

Paths used below (all under `<project>/.keel/local/tmp/`): `changes.json`, `changes.diff`,
`context-map.md`, `agents/` (each keel agent's reply, saved by keel's SubagentStop hook),
`verify-plan.json`, `verify-tasks/`, `verify-result.json`.

## 1. Overview of the change (script)
`<base>` = the commit or branch the calling command names, else none. Both scripts below take
`--base <base>` when there is one; git takes the merge base, so a branch name covers its whole work.

First the comment notes, so that the overview, the diff and every agent see the final code. Run
`node "<keel>/scripts/comments.js" "<project>"`. Act on each note now, as the comment rules say: add
the missing comment, shorten, or keep a long comment that explains tricky code and note
"file:line + reason" for it; an id of a ticket, record or commit is always rewritten into the reason in
plain words, never kept. Notes are not a red gate.

Then run `node "<keel>/scripts/changes.js" "<project>" --start`. Read its summary.
- `changes: unavailable (...)` → tell the user why in plain words and stop. Not a git repository:
  verification needs git to see what changed; offer `git init` with a first commit of the state
  before the task, if the user can tell which state that is. Not configured: the command's preflight
  should have caught it.
- `untracked before the task, not verified:` → files that were outside git when the task started and
  did not change: not this task's work. Mention them in one report line with the advice shown; never
  edit them as part of this task.
- `untracked with no task-start record` → keel cannot tell which of these files the task created. Ask
  once, listing them: "Are all of these part of this task?" Files the user names as not part of it:
  run step 1 again with one `--skip "<path>"` per file.
- `proposal: none` → nothing to verify: run `node "<keel>/scripts/fingerprint.js" "<project>" save --tier none`
  (a finish needs this record), say so and return to the calling command.
- A `last verify:` line means the tree is exactly as it was at the last verification. When the user
  asks for the same level or a lower one (or gives no level and that run had agents), say: "The last
  verification ran at <time> on this exact code at <level>; the result would be the same and cost
  about the same again. I do not recommend it. Run anyway?" Default: no. When that run was lower
  (e.g. gates only) and a higher level is on the table, only mention it: agents would add something.
- A `scanners:` line lists configured scanners that are not installed: skip them at step 2 and put a
  loud warning in the report ("<name> is not installed: secrets/vulnerabilities were not scanned").

## 2. Gates (this session)
1. From `.keel/config.json` `gates.checks`, run the checks of the parts the change touches (`part`
   `.` always; a monorepo part when a changed file is under it), then every `gates.security_scanners`
   entry.
2. Run each command once; keep only the result line, failing test names and the first lines of each
   error in this conversation (redirect long output to `<project>/.keel/local/tmp/gates/<n>.log`
   and read only what you need). Run the configured command as it stands, alone or with only that
   redirect (`<command> > <log> 2>&1`): no `$?` or other shell variables and nothing joined to it,
   because Claude Code asks the user before a command it cannot check, and the tool result already
   gives a failing exit code.
3. A scanner that is not installed is a **loud warning in the report**, not a red gate.
4. **Red gates**: show the failures in plain words. If they are clearly caused by this change, fix
   them first (that is part of the task) and run the gates again. If they look older than the change,
   ask: "fix them first (recommended)" or "continue and mark the report 'gates were red before
   verification'".

## 3. Choose the level and the team (the user)
Show, in the user's language and in plain words:
- the proposal and its reasons (from step 1), and the gate results;
- for each level: which agents run, the verifier cap, who judges, the estimate (estimates are rough;
  the final report shows the real cost).
Ask with one question: gates only / Basic / Standard / Maximum / No verification (none), the proposal
marked as recommended. Basic = one generalist reviewer (Haiku) whose must/should findings the verifiers
check; it suits ordinary changes. When the reasons say the change touches data, an API or dependencies,
say in one line that Standard adds specialist reviewers for them. A `core code:` reason means many files depend on a changed file: say so in
plain words (a mistake there spreads); the user still chooses.
The user may also add or remove an agent or a specialist group. Change an agent's effort only when
the user asks ("cheaper", "deeper"): then propose a level per agent, and pass it as the Agent tool's
`effort` after their yes. Otherwise never pass `effort`.
- **Gates only** → skip to step 12.
- **No verification** → skip to step 12 and mark the report "not verified".
A level given in the user's instruction counts as the user's choice; still show the team in one line.

Read `levels.<chosen level>` in `changes.json` for the exact team: agent, model, phase, topics, focus.

## Agent prompts (steps 4-6)
Spawn keel agents with the Agent tool, `subagent_type: "keel:<agent>"` and `model` set to the team's
model, and always `run_in_background: false`: every step needs its agents' results before it goes on,
and step 5b must not overlap. Several agents at once = several Agent calls in one message. Every prompt is short and contains only:
- `<keel>` = the plugin folder and `<project>` = the project folder (absolute paths);
- the diff `<project>/.keel/local/tmp/changes.diff`, the summary `<project>/.keel/local/tmp/changes.json`,
  and the context map `<project>/.keel/local/tmp/context-map.md` when step 4 ran;
- the task goal and acceptance criteria, quoted;
- the gate results in a few lines (what ran, passed or failed, scanners missing);
- for a specialist group: its topics and their protocol files `<keel>/protocols/<topic>.md`
  (add topic `requirements` to the docs group only when the task has explicit requirements; if the
  docs group is not in the team but requirements exist, ask the user whether to add it); for topic
  `comments`: the long comments you kept in step 1, each "file:line + reason" (Basic has no docs
  group, so nobody reviews them there);
- for QA: the run command from `.keel/profile.json` (`parts[].run_command`) or "none", the
  allowed test commands, and "also tries to break the change" when the team says so;
- for `qa-break`: the test commands and the path of QA's saved reply in
  `<project>/.keel/local/tmp/agents/` (it does not repeat QA's scenarios);
- for `test-reviewer`: the test commands;
- for the second bug hunter on Maximum: its focus and the id prefix `bug-hunter-b`.
Never paste the conversation, file contents or the diff itself into a prompt.

## 4. Context map (Standard and Maximum)
Spawn `keel:context` (model from the team): "Build the context map for this change." plus the paths.
Wait for it. keel's hook saves the map to `context-map.md`. If it fails, continue without a map and
say so in the report.

## 5. Search
**5a, in parallel**: spawn every phase-`5a` agent of the team in **one message** (several Agent calls
at once). They only read.

**5b, one after another** (Basic has no 5b agents: go to step 6): these agents run code, so they never
run at the same time.
1. `node "<keel>/scripts/fingerprint.js" "<project>" snapshot before-5b`.
2. Run `qa`; then `qa-break` (Maximum); then `test-reviewer` (Standard, Maximum).
3. After each one: `node "<keel>/scripts/fingerprint.js" "<project>" compare before-5b`. Anything but
   `same` → stop, show the user which files changed, and offer to restore them (a test reviewer that
   left the change reverted: `git apply "<project>/.keel/local/tmp/revert-change.patch"`) or to look
   together. Nothing continues
   until the tree is as before.
5a and 5b may overlap to save time: take the 5b snapshot first, then send one message with every 5a
agent and the first 5b agent; the other 5b agents follow one at a time, each after its compare.

## 6. Verify findings
1. `node "<keel>/scripts/votes.js" "<project>" plan --tier <level>`. It lists verifier launches (model,
   lens, findings, task file), proven QA findings, minor findings and anything left unverified.
2. Spawn one `keel:verifier` per launch, all in one message, `model` from the plan, prompt: the task
   file path, the diff path, the context map path, `<keel>` and `<project>`.
   While they run, check the "proven by QA" findings yourself: an agent's claim that a command fails
   is not yet proof. First `node "<keel>/scripts/fingerprint.js" "<project>" snapshot before-repro`.
   For each, `node "<keel>/scripts/safe-command.js" "<project>" "<part>" -- <its reproduce command>`;
   `safe` → run it once; it fails as the finding says → "reproduced", otherwise "not reproduced";
   `refused` → leave it out. Then `node "<keel>/scripts/fingerprint.js" "<project>" compare before-repro`:
   anything but `same` → stop as step 5b says. Write the results with the Write tool to
   `<project>/.keel/local/tmp/reproduce.json` as `{ "<finding id>": "reproduced" | "not reproduced" }`.
3. `node "<keel>/scripts/votes.js" "<project>" tally` (a proven finding that did not reproduce becomes
   unclear).
Invalid agent reports in the plan or tally output: offer to re-run that agent once.

## 7. Merge and rank
- Standard and Maximum: spawn `keel:judge` (model from the team) with the path of `verify-result.json`.
- Basic: do the judge's job yourself: read `<keel>/agents/judge.md` (sections Steps and Output) and
  follow it on `verify-result.json`.

## 8. Your opinion
For every item: open the code at its location and form your own view, "agree" or "disagree,
because ...". If you disagree with a confirmed finding, say so; do not hide it.

## 9. What to fix (the user)
Report in the user's language, plain words first, short:
- numbered "must fix" and "should fix" items in full: each with its four parts (what it is, the
  problem, how to fix, what happens if not), its status (confirmed, proven by QA, unclear, not
  verified) and your opinion;
- "nice to fix" as one line, marked "not verified": the numbers and short titles only, then "details
  on request" (give an item's four parts, and your own check of it, when the user asks);
- contradictions from the judge, side by side;
- "not verified" items with the reason; how many findings verifiers refuted;
- missing scanners, incomplete agents, "gates were red".
Ask what to do with each item: fix / skip / not a problem. Short answers count ("fix all must, 4 skip").
"Fix nothing" → step 12 with the list of unfixed items.

## 10. Fix
Fix the chosen items one at a time. Mark each: fixed / skipped / not needed, with a short reason. If
while fixing you see that an item is wrong (the judge or a verifier erred), stop and ask the user
before changing course. A fix must not break what worked.

## 11. Check the fixes
1. Run the gates of step 2 again.
2. For each fixed must or should item (critical or important; nice items need no re-check), spawn
   a new `keel:verifier` (model as in step 6) for a **re-check**: give it the finding (from `verify-result.json`), the files and lines you changed to
   fix it, `<keel>` and `<project>`, and say "re-check after a fix". Run them in one message. One round
   only.
3. A re-check that says the problem is still there: show it; the user decides.

## 12. Result
Keep for the calling command's final report (`<keel>/skills/_shared/final-report.md`, block
Verification): level, team, what was verified, the gate results; per severity how many were found,
fixed and left, and the unfixed items; warnings (missing scanners, red gates, incomplete agents, no app
run by QA). No cost line here: the final report's only cost numbers come from `usage.js report`.
Files written into the repository use `repo_language`.
Then run `node "<keel>/scripts/fingerprint.js" "<project>" save --tier <level>` (also for gates only;
`--tier none` when the user chose no verification). A finish moves its task only after this record.
Return to the calling command for git and the ending.

## When something goes wrong
(Red gates, missing scanners, a changed tree in 5b and re-checks: the steps above say what to do.)
| Situation | What to do |
|---|---|
| an agent fails (API error, timeout) | say which agent and why; offer one retry |
| too many agents at once | run the rest one after another |
| an agent reports `status: "incomplete"` (turn cap) | ask: continue it (send it a message to resume) or accept as is |
| no command to start the app | QA works through tests and direct calls and says it did not start the app |
