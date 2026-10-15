---
type: llm
---

The project has no unfinished tasks.
PASS if the reply retells the task in its own words (the goal and how we know it is done) and, in the same message, proposes a task id or name and asks the user to confirm it: either it asks whether the task is new, or it says the task is new because there are no unfinished tasks and asks whether the name is right. Extra clarifying questions (any number) or a short plan in the same message are fine.
FAIL if it asks the user nothing about the new task's name, proposes no id or name, writes code or files, or says it has already created the task.
