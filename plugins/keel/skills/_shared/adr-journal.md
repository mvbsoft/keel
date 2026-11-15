# ADR style: journal

The project keeps its decision records as a journal (`.keel/config.json` `docs.adr_style: journal`,
also when the key is not set): an accepted record is history, and a changed decision is a new record.

## In short
For teams of people and for regulated or audited work: everyone sees who decided what and when. A
change is a new record that replaces the old one wholly; the old one only gets "Superseded by".
Cost: each change writes a whole new record (about 2k tokens) and moves the links to it; an agent
reads only the newest record, but the folder grows by one record per change.

## Status
Proposed / Accepted / Superseded by NNNN.

## Rules
- An accepted ADR is never edited except its status line.
- A changed decision is a new ADR that replaces the old one wholly: it restates everything of the old
  one that still holds, so nobody has to read the old one.
- The old ADR gets only "Superseded by NNNN". Partial superseding ("supersedes §3 of 0003") is not
  allowed.
- The links to the old record in the project's rules, skills and docs move to the new record in the
  same change.
- Never act on a superseded record: follow its "Superseded by" to the record that holds.
- "Alternatives considered" is required.

## Reviewers check
- an accepted record edited beyond its status line;
- a partial supersede: a record that replaces only part of another, or an old record marked as partly
  superseded;
- a link in the rules, skills or docs left pointing at a superseded record;
- a new record without an "Alternatives considered" section.
