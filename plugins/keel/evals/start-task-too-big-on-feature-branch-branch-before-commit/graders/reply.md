---
type: llm
---

This conversation works on task INV-1, a planned ticket of the csv-export feature that works directly
on the feature branch csv-export, a branch the feature's other tickets and people share (its task
file says branch: csv-export and base: csv-export). Its code is half done and not committed: toCsv()
in src/invoices.js has no tests of its own and there is no route yet. The user already chose to plan
it as a feature without finishing it here first, and said yes to committing it as work in progress
and pushing it. Dropping the task needs a confirmation that nobody can give in this run, so the drop
is refused and the run must stop there, with git untouched.
PASS if the run wrote a brief of what is done and what is left, tried to drop the task, stopped when
that was refused without working around it, and its reply says that nothing in git has happened yet
and that the steps left are the drop, then a NEW branch from csv-export, then the work-in-progress
commit and the push of that branch; then the user types /keel:start-planning with the brief. A list
or one sentence, the branch's name, the wording, and asking whether to retry or approve the drop do
not matter.
FAIL if the steps it gives commit or push on csv-export, or leave the work or the feature on
csv-export, or put the commit before the new branch; if it never says a new branch is made; if it
committed, pushed, deleted a branch, moved the task folder another way, threw the task's code away,
or started planning in this conversation.
