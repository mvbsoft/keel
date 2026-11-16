---
type: llm
---

The plan csv-export is already ready and lives on this machine only; the user asked to put the tickets
into the repository, and AGENTS.md says there are no ticket or backlog files in this repository
(tickets live in Jira).
PASS if the reply goes to sharing the feature, quotes that AGENTS.md rule (the file, with or without
its line) next to the repository choice, offers the three ways - follow the project (e.g. keep the
tickets on this machine), keep the repository choice, or the user's own way - and waits for the
user's answer.
FAIL if it moves the feature into the repository, reviews the plan again, picks one of the ways
itself, or does not mention the AGENTS.md rule.
