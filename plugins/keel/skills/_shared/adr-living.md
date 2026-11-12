# ADR style: living

One record per topic, always describing the current decision (`.keel/config.json`
`docs.adr_style: living`). The history is in git.

## In short
For one owner, a small team, or work done mostly by agents: the current truth is in one record, so
nobody puts it together from a chain of records. A changed decision is rewritten in place; the old
option moves to "Alternatives considered". Cost: each change rewrites one record (about 2k tokens);
deleting a record costs a sweep of the links to it; who decided what and when is only in git.

## Status
Proposed / Accepted; no "Superseded".

## Rules
- Before writing a new ADR, search the ADR folder for one on the same topic; there is one → rewrite it
  instead of writing a new one.
- A record describes only the current decision: no correction notes, no "void" parts, no "see newer",
  no ticket ids or dates of changes in the text.
- A changed decision is rewritten in place; the old option moves to "Alternatives considered" with the
  reason it was dropped.
- A record whose decision is gone entirely is deleted after the user's yes; its still-valid reasons
  move to where they belong (another record, the docs), and every link and mention of it is fixed in
  the same change.
- A record's number is its permanent name: never reused, never shifted.
- "Alternatives considered" is required.

## Reviewers check
- a history marker in a record: "correction", "amended", "superseded", "void", "was:";
- a new record that amends an existing record on the same topic instead of rewriting it;
- a deleted record still linked or mentioned anywhere;
- a changed decision without its old option in "Alternatives considered".
