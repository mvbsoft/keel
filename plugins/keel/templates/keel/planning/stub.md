---
id: <T-number, as in the file name>
type: stub
repo: <the ticket prefix of the repository that is not on this machine>
depends_on: <[T1, T2] or []>
review_hash: <set by plans.js reviewed; a different text means the stub changed since its review, or ->
---
<!-- A stub (plans.js ticket --stub): a ticket for a repository that is not on this machine, with only
what can be written without its code. No Boundaries, Correct the priors or Where to look: they come when
the repository is here and the stub becomes a full ticket (plans.js ticket --from-stub). The sections stay
in this order; Example may be removed when there is nothing to say. Every section is for a reader who has
not seen the feature: short, but in whole sentences, with concrete people and values; a term, a T or a D
number comes with its words. How to check holds only manual steps a person does: no commands, no file
paths. Plain markdown, no HTML. Headings and front matter keys stay in English; the text is in the plan's
language. Comments are removed when the file is made. -->
# [<T-number>] <title>

## In plain words
<the whole task in plain words, without code or paths: what changes for a person, how it works step by step, what is in and what is not, examples>

## Example
<what happens -> what we see, one pair per line; or remove this section>

## Goal
<1-2 sentences: what changes, and how to tell it is done>

## Acceptance criteria
- [ ] <situation -> what we see: a whole sentence with concrete people and values; one behaviour per item that an action checks>

## How to check
<the manual steps: what a person does and what they see>

## Out of scope
<what this stub does not do, and which ticket or later work does it>

## Why
<the decision it follows with its words (D3: one event for every client), and the research report when there is one>

## Dependencies
<why it needs the tickets in depends_on, or which tickets need it; the list itself is depends_on>
