---
type: llm
focus: trace
---

The project keeps living decision records (`docs.adr_style: living`): one record per topic, rewritten in
place. docs/adr/0002-job-queue.md is the job-queue record (Redis with BullMQ).
Look at what the run wrote into docs/adr, through Write, Edit or a shell command.
PASS if it rewrote docs/adr/0002-job-queue.md in place so that its decision is the PostgreSQL jobs table
(SKIP LOCKED), its status is not "Superseded", the Redis queue is listed under "Alternatives considered"
with the reason it was dropped, and the record has no history marks (no "amended", "correction",
"superseded", "was:", no date of the change); and it wrote no new record file in docs/adr.
FAIL if it wrote a new record for this decision, marked 0002 superseded, left the old decision with a
note, or wrote nothing into 0002.
