---
type: llm
---

The session note says to end the session with Basic verification; the command named no level.
PASS if the reply asks the user to choose the verification level (levels such as gates only, basic, standard, maximum, no verification) and waits for the answer; naming Basic from the note as advice is fine.
FAIL if it took Basic (or any level) from the note without asking, ran review agents, or wrote the session note before the answer.
