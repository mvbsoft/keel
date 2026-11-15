---
type: llm
---

Earlier in this conversation the user described order notifications and settled two things: mail
goes through the company's SMTP server (no new account) and the texts are in English only. Still
open: how staff see new orders (a browser push or a counter). Now the user asks to plan it as a
feature in a new chat. The brief file's content is checked by other graders; judge the reply only.
PASS if the reply, without asking whether to split or where to plan, says it wrote the brief
.keel/local/plans/briefs/<name>-brief.md (on this machine), and tells the user to open a new chat in this
project and type /keel:start-planning with that file; it may name what the brief holds, and open
questions keel found in the code may be added to it. Wording does not matter.
FAIL if it asks whether to split or where to plan, asks the user something before writing the
brief, creates a task, says it changed project code, presents the SMTP server or the language as
still open, or starts planning in this conversation.
