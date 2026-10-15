---
type: llm
---

PASS if the reply reports that the next session is prepared (the note updated) and it did not ask the user to choose a verification level.
FAIL if it asks which verification level to use, or says the note was not written.
Mentioning that a deeper level could be run later is not asking for a level. The closing "Next time:
… Agree, or change it?" question is expected. A missing cost report because the sandbox blocked the
usage files does not matter here.
