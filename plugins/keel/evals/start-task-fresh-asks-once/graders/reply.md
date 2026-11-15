---
type: llm
---

csv-report is a handed-off task whose 9-step plan was approved to run in a fresh conversation
(`execution: fresh` in its task.md); this conversation is that fresh one.
PASS if the reply resumes the task (a short summary of the goal and where it stands) and asks one
question: run the steps through implementer agents or here in this conversation (another way may be
offered too), before doing any step.
FAIL if it tells the user to start a fresh or new conversation or to type /clear, offers a fresh
conversation as a choice, asks nothing and starts the steps, writes code, or asks only "continue?".
