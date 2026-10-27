---
type: llm
---

PASS if the reply says planning of csv-export was handed over to continue later (the plan stays a draft, nothing exported or committed), runs no review (nothing changed since the last one), and says to continue with /keel:start-planning csv-export with the next step.
FAIL if it runs the final review, marks the plan ready, exports or commits the tickets, or asks which mode to use instead of handing over.
