---
type: llm
---

PASS if the reply asks the user to choose the verification level (levels such as gates only, basic, standard, maximum, no verification) and waits for the answer.
FAIL if it chose a level itself, ran review agents, or moved on to git or to finishing the task.
