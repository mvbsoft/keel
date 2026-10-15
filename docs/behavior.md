# How keel behaves

[Українська](behavior.uk.md)

This page lists what keel does in each situation and what makes sure it happens.

**In short:**

- **Enforced by code** while keel's hooks are on: Claude Code's confirmation before six steps that are
  hard to undo, keel's script guards (for example: a task is finished only with a verification
  recorded for the code as it is now; the main branch and the current branch are never deleted), one
  narrow Stop hook for an autonomous finish, and keel staying out of projects that are not set up.
- **Instructions** the model follows: everything else, such as how keel reads and retells the task,
  when it asks, which git steps it runs and what it writes. They usually hold, but no code makes them
  hold.
- **Your Claude Code permission rules** decide every other command, also one that keel's instructions
  forbid.

## What guarantees a step

| Guarantee | What it means |
|---|---|
| **Claude Code's confirmation** | Six steps: moving a finished task's folder to keel's trash, dropping a task, emptying keel's trash, deleting a branch, merging, and turning on autonomous git. keel's hook makes Claude Code ask before each, even when your allow rules would let it run. It asks only for the plain form `node "<keel>/scripts/<name>.js" "<project>" ...` on the current project. A keel script run with keel's folder written out but in any other shape (shell variables, node options, `env`, `bash -c`, a wrapper, joined commands, in PowerShell `--%` or an empty argument) is refused, and so is one of these six steps named with another project's path, and any keel script command that holds such a step's words (`delete`, `drop`, `empty-trash`, `merge`, `delete-branch`, `trust`) but does not read as that step, and one of these steps with keel's script named through another path (`$CLAUDE_PLUGIN_ROOT`, `~`, another copy of keel), and any `node`, `bun` or `deno` command that names keel's library (`scripts/lib/`), which no keel step runs directly; the model then sends the plain form. So an allow rule such as `Bash(node *)` does not skip the question for keel's steps; the library guard is best effort (it catches the library named on the command line, not code in a file that loads it), and an allow rule for arbitrary code lets the model run any code, which no hook can judge. The one exception you can choose: a merge in autonomous git confirmed on this machine with `git.ask_before_merge: false`. The question is in your `conversation_language` setting of the project (else of this machine) when keel has a catalog for it (English and Ukrainian); other languages get English. With hooks switched off there is no confirmation ([below](#non-interactive-runs-and-bypass-mode)). |
| **Script guard** | keel's script refuses a step that comes in the wrong order or would do harm, and says what to do instead. The same change done another way (raw git, moving files by hand) is outside the guard: keel's instructions forbid it, and your Claude Code permission rules decide it. |
| **Stop hook** | One case only: in autonomous git, when this conversation moved a finished task's folder to keel's trash and no commit holds it, Claude Code does not let keel end its answer and tells it to go on with git or put the task back. It pushes once: when keel stops again right after, the answer ends. It does not block when keel's last message ends with a question, and it ignores a finish older than a day or a task no longer in keel's trash. |
| **Hook** | Another of keel's hooks, such as the one that keeps keel out of projects that are not set up. |
| **Instruction** | The model follows keel's instructions; nothing checks it in code. |
| **Instruction + eval** | The same, and a behaviour test suite (`npm run eval`, 18 cases) checks it. The suite is run by hand before each release, not on every change; it is not a guarantee for every run. |

## Before any command

| Situation | What keel does | Guaranteed by |
|---|---|---|
| A project without `.keel/config.json` | keel stays out of the way: its hooks add nothing to the conversation, its agents are refused until `/keel:configure` has started there, and keel's skills that Claude would call by itself are refused (configure and help run only when you type them). Usage recording and the status line keep working. | Hook |
| You type a keel command in such a project | Says the project has no keel settings and offers `/keel:configure`; no → the command does not run. | Instruction |
| No git repository | The check reports `git: none`; keel offers `git init` and a first commit of the current state, with secret files (`.env`, keys) put in `.gitignore` first. No → the command stops. | Script check + instruction |
| git does not trust the folder's owner ("dubious ownership") | The check reports `git: refused` with git's own fix, `git config --global --add safe.directory "<folder>"`, which you run yourself; the command stops. | Script check + instruction |
| The project folder is a sub-folder of its git repository | keel's git steps (all but the status and the confirmation of autonomous git) stop with the reason; they run only in the repository's top folder. | Script guard |

## Starting a task

| Situation | What keel does | Guaranteed by |
|---|---|---|
| You give a link (Jira, Linear, GitHub, any page) | Reads it with the matching connector, `gh` or a web fetch. When it cannot, it says so and asks you to paste the text; it never guesses the content. | Instruction + eval |
| You give a key and nothing in the project matches it | Says nothing was found and asks for a link or the text. | Instruction + eval |
| You describe the task in your words | Retells it (goal, how we know it is done, what is out of scope) and asks one question: is it new, with a proposed name. | Instruction + eval |
| The task is new, clear and small (one module, nothing to ask) | Fast start: the retell, a short plan and the branch choice in one message, with one question; a yes names the task, picks the branch and starts. | Instruction + eval |
| An unfinished task is about the same thing | Names it and asks: a continuation, or a new task? | Instruction + eval |
| The goal is vague or needs a design choice | Offers a brainstorm and starts it only after your yes. | Instruction + eval |
| The key belongs to the long-work note | Stops: "this is led by /keel:start-session". A task with that key or link cannot be created, however the key is written (a link with or without `https://`, a markdown link, quotes, a list). | Script guard (`task new` refuses it) |
| The task is new | Plan, then the branch, then the task folder on that branch, only after your yes to the plan. | Instruction |
| Which branch to work in | The "Start?" question or the plan's first Execution step names the current branch and offers: a new branch `<id>-<short-name>` from it (recommended), the current branch, or your own git steps. On the main branch keel says plainly that the changes would stay there until git time, when keel moves them to a new branch (it never commits on the main branch), and recommends a new branch now. Your answer is run in both git modes, one step at a time, stopping on a conflict or a refusal; no push and no merge into the main branch unless you said so. | Instruction |
| Uncommitted changes before a branch change | Stops and offers: hand off the current task, commit, or stash. Changes go into a task only when you say they belong to it; keel's own setup files left by `/keel:configure` are offered to the first task. | Instruction |

## While you code

keel adds its coding standards to every conversation in a set-up project (the file
`hooks/standards.md` of the plugin). The main ones:

| Situation | What keel does | Guaranteed by |
|---|---|---|
| A request that can be read two ways, or leaves a choice open | Reads the code first, names the open choices (with a proposed default) and asks before writing code. A clear request gets no extra questions. | Instruction + eval |
| A bug fix | First a test that reproduces the bug, run and seen failing, then the smallest fix; the test passes after it. | Instruction + eval |
| Code next to the change looks untidy or has its own problem | Left as it is: no reformatting, renames or "improvements" the task does not need. A problem it notices is named in the reply, not fixed. | Instruction + eval |
| A new feature | The smallest solution that fully does the task: no options, layers or helpers it does not need, and no handling for cases that cannot happen. Data that crosses an edge (users, files, networks) is still checked on the way in and escaped on the way out. Existing validation is never removed. | Instruction |

## Finishing a task

| Situation | What keel does | Guaranteed by |
|---|---|---|
| `/keel:end-task` with no words | Shows a menu: finish, hand off, or your own instruction. | Instruction + eval |
| An unclear word such as `push` | Asks whether to finish or hand off; never guesses. | Instruction + eval |
| You did not name a level | Asks the verification level before any review agent runs. | Instruction + eval |
| No "must fix" or "should fix" finding | Does not ask what to fix; lists the "nice to fix" items as not verified and goes on. | Instruction |
| The task folder is about to go to keel's trash | keel's script moves it only when a verification is recorded for the code as it is now, also "none". Committing the verified code keeps it verified; any other change to the code needs a new verification. With nothing to verify, keel records "none" by itself. | Script guard (that the level was your choice: instruction) |
| Moving the folder | Claude Code asks: "keel: task CAN-123 is done? Its folder .keel/tasks/CAN-123/ goes to keel's trash." keel says one line before it and does not ask the same in the chat. | Claude Code's confirmation |
| You answer no | The folder stays and the task stays active on its branch. keel runs no git step; run `/keel:end-task` again when it is done. | Claude Code's confirmation (the folder) + instruction (no git) |
| Autonomous git: a git step stops after the folder moved and before the commit (a failing commit hook) | The git script itself puts the task folder back and makes the task active again, because keel runs each git step of a finish with `--finish`; the report says what stopped. | Instruction + script (`git-flow.js --finish`) |
| Autonomous git: the update from the base branch or the push stops after the commit (a conflict, a refused push) | The task is not put back: its removal is committed, and the script says so. Fix the cause, then keel runs that step again. | Script (`git-flow.js --finish`) + instruction |
| New commits from the base branch turn the gates red after the folder moved (the removal is committed, nothing pushed) | keel stops git and offers: fix them now (then commit and push) or put the task back; then run `/keel:end-task` again. | Instruction |
| Verification is red and your instruction says push or merge | The folder question has already come (it is before git). keel stops before any git step and asks; stopping puts the task back. | Instruction |
| Autonomous git: keel would end its answer with the folder in the trash and nothing committed | Claude Code keeps it working: go on with git, or put the task back. | Stop hook |
| Merging into the main branch | Only when your instruction asks for it, or in a finish with `git.ask_before_merge: false`. Claude Code asks before each merge, except in autonomous git confirmed on this machine with that setting. Details: [merging](workflows.md#merging-into-the-main-branch). | Instruction (when) + Claude Code's confirmation (each merge) |
| Merging while your local main branch has commits that are not on the remote | Stops before the merge and says so: those commits would be published with it. | Script guard |
| Turning on autonomous git on this machine | Claude Code asks: "keel: let keel run its git steps (branch, commit, push) in this project on this machine without asking each time?" | Claude Code's confirmation |
| Manual git mode | keel runs no git step you did not ask for: it gives the commit command, which includes the folder's removal. When you say you did not commit, it puts the task back. | Instruction |

## Handing a task off

| Situation | What keel does | Guaranteed by |
|---|---|---|
| `/keel:end-task hand off` | Gates only, the task file updated (state, next action, branch), then commit, push and back to the base branch (manual git: the commands). | Instruction |
| A handoff whose instruction asks to merge | With the task folder in git, keel first says the task is not finished and the merge puts `.keel/tasks/<id>/` into the target, and asks: "Finish the task instead, or merge anyway?" | Instruction + Claude Code's confirmation (the merge) |
| The gates are red | The handoff still goes on and keel does not fix them; the failure is written under the task's open questions. | Instruction |
| The task has no branch of its own (it works in the base or the main branch) and you gave no git instruction | Before any git step keel asks, in both git modes: a new branch from here (commit and push there, then back on the current branch; recommended), commit and push to the current branch (not on the main branch), no commit (the changes stay uncommitted and move with you if you switch branches), or your own instruction. The answer is run, in manual git too. | Instruction |

## Long-work sessions

| Situation | What keel does | Guaranteed by |
|---|---|---|
| `/keel:start-session` with a key an unfinished task owns | Stops: "tasks use /keel:start-task". | Instruction + eval |
| A key both lanes claim (the note names an unfinished task) | `notes.js check` reports the conflict; keel shows it and asks which lane leads it before anything else. When it writes the note, a key a task owns is left out. | Script check + instruction |
| A new line while a note is open | Asks: continue the written line or start a new one. There is one note, so a new line asks next: end the old line, or carry its open steps into the new note's **Later**. | Instruction |
| `/keel:end-session` with no level | Asks the verification level (with the gate results) before any review agent runs, before the note and before git. | Instruction + eval |
| `/keel:end-session we continue tomorrow, prepare` | Gates only, no level question, then the note for the next session. | Instruction + eval |
| An action in the instruction (push, merge) | Done after the verification and the note; merging as in [merging](workflows.md#merging-into-the-main-branch). | Instruction + Claude Code's confirmation (the merge) |

## Dropping a task

| Situation | What keel does | Guaranteed by |
|---|---|---|
| `/keel:tasks drop <id>` | Lists what the task left (folder, branch, commits, changed files) and asks what to remove. | Instruction |
| The task's folder is on another branch | keel switches there first (that needs a clean working tree). | Script guard (`task drop` works only on this working tree) + instruction |
| Removing the folder | Claude Code asks; the folder goes to keel's trash and leaves your task list at once. When it was committed and its branch stays, keel commits the removal on that branch so teammates stop listing it. | Claude Code's confirmation + instruction (the commit) |
| Removing the branch | Claude Code asks. The script never deletes the main branch or the current one, also when the name is written in another case on Windows or macOS, and prints the command that brings the local branch back; for a pushed branch also the remote branch's last commit and the `git push` that brings it back while that commit is still in your repository. | Script guard + Claude Code's confirmation |
| Changes already in the base branch | Only `git revert` of the commits you name, after your yes; never a history rewrite. | Instruction |
| Manual git mode | keel gives the git commands to copy and waits. | Instruction |

## Cleanup and keel's trash

| Situation | What keel does | Guaranteed by |
|---|---|---|
| `/keel:cleanup` | Lists leftovers in three groups; you pick in the chat what moves to keel's trash. The move runs without a Claude Code prompt, because it can be undone. | Instruction |
| A secret file, or an item in the "do not touch" group | The script never moves or opens a secret file, nor a folder that holds one (it refuses it and names the file). A "do not touch" item moves only when it is named a second time, which keel does after your answer to a second question about what may break. | Script guard + instruction |
| The gates turn red after a cleanup | keel puts the batch back and runs the gates again. | Instruction |
| `/keel:cleanup restore [batch]` | Puts the batch back; without a name, the newest batch of any kind. Files come back into the branch checked out now, uncommitted: for a task's folder, switch to its branch first. A path that exists again stays in the trash. | Script |
| `/keel:cleanup empty-trash` | Says what would be deleted for good; Claude Code asks, naming exactly which batches (with `--older-than`, the number of days). A value the script would refuse is refused before the question. Besides this, only `/keel:tasks drop` deletes for good: a branch on the remote, after your confirmation. | Claude Code's confirmation |

## Setting up (`/keel:configure`)

| Situation | What keel does | Guaranteed by |
|---|---|---|
| Any run without `machine` | The first question is always: this project, or only this machine's settings. | Instruction |
| Writing anything | Shows what it will write and writes only after your yes. Writing Claude Code settings or moving an old notes system's files also goes through Claude Code's permission prompt (unless your own allow rules allow it). | Instruction + Claude Code's permission prompt |
| The end of a project setup | Offers two ways for the new setup files: the commands to commit them on the main branch now, or leave them uncommitted and let the first `/keel:start-task` take them into its branch. | Instruction |

## Non-interactive runs and bypass mode

Tested with Claude Code 2.1.296:

- **`claude -p`**: nobody can answer a confirmation, so Claude Code denies the step and keel reads the
  reason. This holds even with an allow rule such as `Bash(node *)`. keel treats it as your "no": a
  finish verifies, keeps the task active and runs no git. Finish tasks in an interactive conversation.
- **`claude -p --permission-mode bypassPermissions`**: the same. keel's confirmation is not skipped;
  the step is denied with the reason, and the task folder stays.
- **All hooks switched off** (`disableAllHooks`): keel's own confirmations, its pre-approvals and the
  Stop hook are gone, so every keel step follows your normal permission rules. The script guards
  still hold.
- Interactive bypass mode was not tested.

## What is not guaranteed

- **Understanding the task**: the retell, the right question, new or continuation, when to offer a
  brainstorm. These are instructions; the eval suite checks some of them, and you see the retell and
  can correct it.
- **Asking at the right moment**: the menu, the level question and "finish or hand off?" are
  instructions checked by the eval suite.
- **What the review agents find**: see [Verification](verification.md).
- **Steps keel does not confirm itself**: keel's hook pre-approves its own scripts that only read,
  write keel's own files or can be undone and, after you confirm autonomous git on this machine, its git steps (start, switch,
  commit, update from the base branch, and push except from the main branch). Everything else follows
  your Claude Code permission rules, and your deny and ask rules still apply to keel's steps too.

More: [Under the hood](under-the-hood.md), [Security policy](../SECURITY.md).
