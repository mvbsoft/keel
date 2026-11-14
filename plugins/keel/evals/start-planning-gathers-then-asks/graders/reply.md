---
type: llm
---

PASS if the reply ends with a question to the user about the notification system that refers to something the look-up found in the shop's code: a file (such as src/payment.js, src/auth.js or src/server.js) or a fact of the shop (such as "charge() returns paid but nothing calls it" or "there is no customer contact data"). A question offered with options and a recommendation counts as one question. Writing the findings into the draft's plan.md is expected, not a fault.
FAIL if the reply asks the user nothing, asks two separate questions, asks a generic question that names nothing found in the code (such as "what should the notifications do?"), or changes the shop's code or writes tickets.
