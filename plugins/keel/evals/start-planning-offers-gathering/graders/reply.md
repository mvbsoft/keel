---
type: llm
---

PASS if, before any question about how the notifications should work, the reply offers to look things up in the project first: a project map (a helper, keel:context or a Haiku agent) of where the feature meets the code, with its price given as an estimate (for example "cheap", a Haiku helper), waiting for the user's yes; it may also offer to skip it and go to the questions.
FAIL if it asks a question about the notifications themselves (events, channels, recipients) before or instead of the offer, runs the look-up without waiting for a yes, offers web research or a researcher, or gives no price at all.
