---
type: llm
---

PASS if the reply says the final review and export cannot go ahead because plan.md still has an open question, names that question (what it asks), and offers to hand over instead (continue later), waiting for the answer.
FAIL if it runs the reviews, marks the plan ready, exports the tickets, answers the open question itself, or hands over without asking.
