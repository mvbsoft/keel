# Verification levels

[Українська](verification.uk.md)

When you run `/keel:end-task` or `/keel:end-session`, keel checks your change before you commit. There are
four levels, from the project's own checks only to a full team of agents. keel proposes a level from the
change; you choose. This page explains what each level does, how the proposal is made, what the report
contains and which level to pick. The agents are Claude Code subagents today. Handing a task off
(`/keel:end-task hand off`) or preparing the next session (`/keel:end-session we continue tomorrow,
prepare`) runs only the gates, unless you name a level. A hand off never fixes red gates: it notes them in
the task file as open questions.

Verification needs git to see what changed; in a folder without git keel offers `git init`. Untracked
files that existed when the task started and did not change are not this task's work: they are left out
and listed in the report. When keel has no record of the task start, it lists the untracked files and
asks "Are all of these part of this task?".

## The four levels

First keel checks the comments of the new code against the comment rules and fixes them. Then every
level runs the **gates**: the tests, linters, type checks and security scanners of your project (set in
`/keel:configure`). A scanner that is not installed is a loud warning in the report, not a failure. Red
gates that this change caused are fixed first. Red gates that look older make keel ask: fix them first,
or continue with the report marked "gates were red before verification". The level decides which agents
run on top of the gates.

| Level | Who checks | Verifiers (cap) | Who merges and ranks |
|---|---|---|---|
| **Gates only** | no agents | none | none |
| **Basic** | one generalist reviewer (Haiku) | up to 2, Sonnet | the main conversation |
| **Standard** | context map (Haiku), generalist reviewer, bug hunter, architect, QA (also tries to break the change), test reviewer, up to 4 specialist groups | up to 5, Sonnet; Opus for findings of the bug hunter and the security group | a judge agent (Sonnet) |
| **Maximum** | context map (Haiku), two Opus bug hunters (one on the changed lines, one on the change in the context of the whole project), Opus architect, security group always (Opus), other triggered groups up to 4 in total, Opus QA, a separate "break it" QA (Sonnet), test reviewer | up to 8, Opus; three per critical finding while the cap allows | a judge agent (Opus) |

There is also **none** (no verification): the report says "not verified".

Notes:

- At Basic, architecture is the file-size check of the script, with no architect agent, and no code is
  run by an agent (QA runs from Standard up).
- The architect runs on Opus at Standard when the change has architecture signals (new files, files over
  the size warning), otherwise on Sonnet.
- At Standard and Maximum the docs group always runs when a changed file changes behavior; it also
  reviews the comments of the changed code.
- If `allow_opus` is off, every agent above that would run on Opus runs on Sonnet instead.
- You can add or remove an agent or a specialist group before the run. Ask for "cheaper" or "deeper" and
  keel proposes an effort level per agent.

### What the agents do

| Agent | What it checks |
|---|---|
| generalist reviewer | one broad pass over the change against its task: logic, security, data, docs, duplication, names, size, weak tests |
| bug hunter | logic errors, load problems, framework duplicates, API misuse |
| QA | runs the changed functionality and checks the acceptance criteria; reports failures with a reproduce command |
| QA "break it" | tries boundaries, empty input, zero/one/many, permissions, interruptions, concurrency |
| architect | where each new thing sits, size and growth, duplication, dead code, names |
| test reviewer | whether the tests would catch the change breaking; proves key tests by reverting the change and watching them fail |
| context map | maps the files related to the change for the other agents |
| security group | traces input to dangerous operations; tries to bypass the business rules |
| data group | database changes and migrations, API compatibility, input validation, performance |
| env group | dependencies (need, lock files, licenses, trust), infrastructure (Docker, CI, deploy, configuration, secrets) |
| docs group | docs and comments match the code, comment rules, requirements done without extras |

Agents that only read cannot write. The agents that run code (QA, "break it", test reviewer) run one
after another, and after each one keel compares the working tree (tracked files and untracked files git
does not ignore) with a snapshot. If anything changed, it stops and offers to restore. The QA agents may
write only in `.keel/local/tmp/qa/`; a hook refuses any other path.

## How keel proposes a level

keel computes the proposal from the change. It checks the rows from the top, and the first match wins.

| Signal | Proposes | Setting (`.keel/config.json`) | Default |
|---|---|---|---|
| a database migration | Maximum | none | none |
| added code that deletes data in bulk: SQL `DROP` or `TRUNCATE`, a `DELETE` without `WHERE` on its line, an ORM bulk delete (`deleteMany`, `destroyAll`, `delete_all`, `dropColumn` and similar) | Maximum | none | none |
| a money word or a security word (see below) in added code of a file that matches the project's security paths | Maximum | none | none |
| the change is this many lines or more | Maximum | `verification.tier_rules.very_large_change_lines` | 1000 |
| a behavior change in a file that this many non-test files import (core code) | Maximum | `verification.tier_rules.core_fan_in` | 5 |
| the change is this many lines or more | Standard | `verification.tier_rules.large_change_lines` | 400 |
| the change touches more than this many modules | Standard | `verification.tier_rules.basic_max_modules` | 1 |
| the security group is triggered | Standard | none | none |
| this many files or fewer, none of them changes behavior (text, comments, docs) | Gates only | `verification.tier_rules.gates_only_max_files` | 1 |
| anything else | Basic | none | none |

A change that touches data, an API or dependencies (the data or env group) is still proposed for
Basic, with a reason that names it: on the test set Basic's must or should list matched Standard's at
about a seventh of the price. Choose Standard when you want the specialist reviewers for it.

**What is measured and what is judgement.** Measured on the test set: data, API and dependency changes
stay at Basic, and Basic's reviewer runs on Haiku. Judgement, not measured with keel: every Maximum
row, more than one module, the security group, and the 400 and 1000 line thresholds; they follow
where a missed defect costs most (money, access, data, code many files depend on). On the test set
Basic's must or should list matched Standard's at every size, the 1083-line change included.

What triggers a specialist group:

- **security**: a changed file in the project's security paths; or added code with a security word:
  `password`, `secret`, `api key`, `private key`, `bearer`, `jwt`, `oauth`, `csrf`, `authorize`,
  `authenticate`, `permission`, `is_admin`, `has_role`, `can_access`; a call that runs code or
  commands (`eval`, `exec`, `spawn`, `system`, `popen`, `unserialize`, `pickle.loads`, `yaml.load`);
  an HTML sink (`innerHTML`, `dangerouslySetInnerHTML`, `v-html`); weak hashing or randomness (`md5`,
  `sha1`, `createCipher`, `Math.random`); or a recursive file removal (`rm -rf`, `shutil.rmtree`,
  `fs.rm` or `fs.rmSync` with `recursive: true`). A file removal deletes files, not data, so it
  proposes Standard, not Maximum; the security group checks what the removed path can be.
- **data**: a migration, a schema or model file (`.sql`, `models/`, `entities/`, `schema/`,
  `schema.prisma`), an API file (routes, controllers, endpoints, handlers), or the project's data paths.
- **env**: a dependency manifest or lock file, or the project's environment paths.
- **docs**: a text file, a file under `docs/`, or the project's docs paths.

The specialist groups run at Standard and Maximum; only the security group raises the proposal.

Content words are read only in added lines of code: test files and text files do not count. A money
word (`price`, `amount`, `balance`, `currency`, `payment`, `refund`, `invoice`, `payout`, `charge`,
`discount`, `vat`, `tax_rate`) outside the security paths calls no group: it is only listed among the
change's signals. The project's paths per group are in `.keel/profile.json` (`triggers`); change them
with `/keel:configure scan`. A Standard reason names what triggered the group, for example
`security group triggered (code src/auth.js: ...)`.

Lines are added plus removed. Lock files, generated files and vendored files are not counted: they say
nothing about the size of the work. The number of verifiers per level is `verification.verifier_caps`
(defaults 2, 5, 8 for Basic, Standard, Maximum). Agent turn caps are set in the agent files
(60 for review agents, 350 for implementers), not in the config.

All of these are configurable; see [settings](settings.md#this-project) for the full list. The proposal
always comes with its reasons, and you choose the level.

## What verifiers and the judge do

Every agent that reports a finding gives it a severity: critical (must fix), important (should fix) or
minor (nice to fix). A finding needs a location, a concrete case, a real consequence, and a check that no
guard already covers it. An agent that is not sure a problem is real either leaves it out or reports it
at the severity it would have if real, and says what would settle it, so that a verifier checks it. It
never lowers the severity of a doubtful finding: minor findings are not verified.

1. **Verifiers.** A separate verifier agent tries to refute each critical and important finding, up to
   the level's cap: it restates the claim, reads the code itself, and tests it against four gates
   (reachable, real impact, no existing defense, a concrete case). Its verdict is confirmed, refuted or
   unclear, with `file:line` evidence.
2. **Who is verified.** Findings at the same place (often one issue that several agents reported)
   share one verifier launch, up to 4, critical ones included; each still gets its own verdict.
   Critical findings come first, each with its own launch. At Maximum a critical finding gets three
   launches with different lenses (reachability, impact, defenses) while the cap leaves every critical
   finding at least one: it is confirmed when two of the three confirm it, dropped only when two of the three refute it,
   and otherwise shown as unclear. Other important findings go up to 3 per launch, with the same verifier
   model, by file and then by folder. Minor findings are not verified. What does not fit under the cap
   is shown as "not verified" with the reason.
3. **QA findings.** A QA finding that comes with a reproduce command skips the verifiers, and an
   important finding at the same place is not verified again. Instead the main conversation re-runs the
   command when keel's command check says it is safe to run. If it does not fail as QA described, the
   finding is shown as unclear; if it does, as proven by QA. A command the check refuses is not run, and
   the finding stays proven by QA with the note "not run again". The check also refuses a command that
   would discard the change under verification (such as `git restore`, `git stash`, `git reset`,
   `git checkout --`, `find -delete`, `rm` or `mv`), and keel compares the working tree before and
   after the re-runs: any difference stops the verification, as it does after an agent that runs code.
4. **The judge** merges duplicates, drops refuted findings, marks contradictions side by side, sorts by
   severity and numbers the list. It adds no findings of its own. At Basic the main conversation does
   this job.
5. **The main conversation's opinion.** For every item the main conversation opens the code and says "agree" or
   "disagree, because ...". It does not hide a disagreement with a confirmed finding. A problem the
   main conversation notices itself while reading goes into the list as its own item, marked "not
   verified (session)".

## The report

keel shows the result in plain words. When there is a must or should item, it stops for your answer,
also when you named the level in advance. With no must or should item it does not ask what to fix: it
shows the nice-to-fix line and goes on, and you can still ask for a nice item. Apart from the comment
fixes and the red gates described above, no code is changed before you choose.

| Part | What you see |
|---|---|
| Must fix | numbered items in full: what it is, the problem, how to fix it, what happens if you do not; its status (confirmed, proven by QA, unclear, not verified, not verified (session)) and the main conversation's opinion |
| Should fix | the same |
| Nice to fix | one line marked "not verified": the numbers and short titles; details on request |
| Contradictions | two findings whose fixes conflict, side by side |
| Not verified | items with the reason, and how many findings the verifiers refuted |
| Warnings | scanners that are not installed, gates that were red before, incomplete agents, no app run by QA |

You answer per item: fix, skip or not a problem. keel fixes the chosen items one at a time, then:

- runs the gates again;
- spawns a new verifier for each fixed must or should item, to **re-check** the fix (one round);
- shows any item the re-check says is still there, and you decide.

The final report of `/keel:end-task` or `/keel:end-session` shows the verification as a table: per
severity how many were found, fixed and left, then the items left by number and title, the gates line
and the warnings; its Costs block shows what the whole session cost, agent by agent
([an example](workflows.md#the-final-report)). When only
the gates ran, it is the gates line alone. If you ask again for the same level or lower on exactly the same code, keel
advises against it: the result would be the same and cost about the same. A finished task needs a
recorded verification (choosing none is recorded too); it stays valid after you commit the verified code, and any other change needs a
new one.

## Cost

When you choose a level, keel shows a rough estimate for each one; the report at the end shows the real
cost, agent by agent. The numbers below were **measured**, not guessed: each is a real run of keel on
a test project, and the sections after the table say on what and how. They change from time to time,
because the measurements are repeated on new versions of keel and new model prices. The runs used
keel 1.0 before its last fix, which gave the QA agents the Write tool for their helper scripts (fewer
permission prompts, the same checks); scoring was done by a separate model, without a human check.

### Measured in October 2026 (keel 1.0)

| Level | Estimate keel shows | Cost per change: mean, median (lowest-highest) | Defects found (of 17, mean per run of the 8 changes): any severity / in must or should | False alarms in must or should |
|---|---|---|---|---|
| Gates only | ≈$0.2 | $0.21, $0.20 ($0.18-0.27) | 0.7 / 0.7 | 0 in 24 runs |
| Basic | ≈$0.25-0.5 | $0.34, $0.34 ($0.25-0.41) | 15.3 / 15.0 | 0 in 24 runs |
| Standard | ≈$1.4-4.3 | $2.38, $2.00 ($1.39-4.30) | 16.3 / 15.0 | 1 in 24 runs |
| Maximum | ≈$2.7-7.6 | $4.97, $4.74 ($2.72-7.60) | 17 / 14 | 0 in 8 runs |

**On what.** 8 changes of 73 to 1083 lines, all JavaScript, with 17 known defects: 3 real bugs from
two open-source projects (ws: 1, Express: 2; proven by the projects' own fixes), 11 written into three
changes for the test (each proven by a failing script), 3 subtle defects in a natural change (found
and proven by an earlier keel Standard run, which made them the answer key for that change, a key that
may favor Standard), and 2
clean changes with no defect, to see whether keel invents one. Decoys, correct code that looks wrong,
were mixed in. Every change was run 3 times at gates only, Basic and Standard (24 runs per level) and
once at Maximum (8 runs), 80 in all; with one run per change, Maximum's small differences are within
noise. 14 of the 17 defects were found in every run of Basic and Standard, so the numbers tell the
levels apart mainly on the 3 subtle ones; a test set this small and this narrow shows what keel does
on these changes, not a general rate.

**How it was scored.** A separate model, blind to the level, compared each run's final list with the
answer key. "Found" counts a defect reported at any severity, a half-found one as 0.5. A decoy reported
as a problem counts as a false alarm when it reaches the must or should list; as a nice-to-fix item it
is not verified and not counted (Basic did that 2 times, Standard 4 times).

**How the cost is counted.** Claude Code records every request to a model, of the main conversation and
of every agent, with its tokens of four kinds (input, cache write, cache read, output). Each kind is
multiplied by Anthropic's list price for the model that answered, and everything is added up. A
Standard run of $1.47, for example, was $1.30 of Sonnet (the main conversation and most agents), $0.16
of Opus and $0.01 of Haiku. Of the Sonnet part, cache reads were most of the tokens (1.8 million) but
only $0.18 of the money; output ($0.56) and cache writes (about $0.55) cost more. On a subscription no dollars are charged: the same tokens count against your plan limits.

**What the cost covers.** Only the verification: from `/keel:end-task finish, level ...` to the list
of what to fix (gates, the agents, the check of their findings). Not included: writing the code,
fixing what was found and checking the fixes, git, the cost report. Each run started in a fresh
conversation. Run at the end of the conversation that wrote the code (one change, 2 runs), the same
Basic verification cost $0.21 against $0.26-0.29 in a fresh conversation on the same code: that conversation
already held the changed files, was short (about 17k tokens more at the start) and its cache was
still warm. A longer conversation costs more per request: on Sonnet each 100k tokens more add about
$0.01 of cache reads to every request (a Basic run makes 10-13 requests in the main conversation),
and after a pause longer than the cache lives the whole conversation is written to the cache again,
about $0.25-0.40 per 100k tokens (computed from the list prices, not measured).

**Where the levels differ.** On the real bugs and the planted ones both levels found nearly all. The
difference is the change with 3 subtle defects: Basic found 4 of 9 there over its 3 runs, Standard 7
of 9; Standard's extra finds were all nice-to-fix items, so in the must or should list both found 3
of 9. Standard also reported more true problems that were not in the key (64 against 39), at about 7
times the price. Maximum found all 17, the 3 subtle ones too, but reported 3 of them (2 subtle, 1
planted) as nice-to-fix, so its must or should list held 14; it costs about 2 times Standard and 15
times Basic. At gates only the tests passed on every change; in 2 of 51 defect-runs the main
conversation itself noticed a defect while reading the code and named it as its own, unverified item.
Gates only checks that nothing broke; it is not a review.

Against one plain AI review (an earlier run), Basic costs about 1.5 times as much and
finds about as many known defects; what it changes is the fix list: 2.7 items a run with none false,
against 5.5 a run in the plain review, 4 of them false over its 8 runs.

### For comparison: a plain reviewer without keel

One plain Sonnet reviewer, without keel, was measured once on the same 8 changes (one run per change,
an earlier date): $0.14-0.38 per change ($0.22 on average), 15.5 of 17 defects found, with 4 false
alarms in its must or should list over the 8 runs.

## Which level when

| Change | Level |
|---|---|
| an ordinary change in one module, also one that touches a model, an API or a dependency | Basic |
| a large change, new behavior across modules, a triggered security group (for example code with passwords, tokens, permissions, `eval` or `innerHTML`, a recursive file removal), or a model, API or dependency change you want specialist reviewers for | Standard |
| a migration, a bulk data deletion (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`, an ORM bulk delete), money or access code in the project's security paths, a very large change, or core code that many files depend on | Maximum |
| a one-file change without behavior change (text, comments, docs) | Gates only |

The proposal is built from these same signals ([what is measured and what is
judgement](#how-keel-proposes-a-level)); you choose. The 400-line default for a "large" change is a rule
of thumb from code-review studies (human reviewers find fewer defects beyond
200-400 lines), not measured with keel: in keel's test set ([Cost](#cost)) every level found every
defect of the largest change too.

See [cost optimization](cost-optimization.md) for more on spending less.
