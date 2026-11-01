---
id: <T-number, as in the file name>
depends_on: <[T1, T2] or []>
review_hash: <set by plans.js reviewed; a different text means the ticket changed since its review, or ->
---
<!-- A draft ticket (plans.js ticket). The sections stay in this order; Example and Correct the priors
may be removed when there is nothing to say. In plain words is for a person and is as long as it needs;
the rest, the technical part, is 150-400 words: what to do and how to check it are exact, how to do it
is free (no implementation steps). Plain markdown, no HTML; code blocks name their language. Headings,
the Boundaries labels and front matter keys stay in English; the text is in the plan's language.
Comments are removed when the file is made. -->
# [<T-number>] <title>

## In plain words
<the whole task in plain words, without code or paths: what changes for a person, how it works step by step, what is in and what is not, examples>

## Example
<what happens -> what we see, one pair per line; or remove this section>

## Goal
<1-2 sentences: what to do and how to tell it is done>

## Acceptance criteria
- [ ] <one behaviour that an action checks>

## How to check
<a command in a code block with its language, and the manual steps>

## Boundaries
- always: <what to do every time in this ticket>
- ask first: <what needs a yes before it is done>
- never: <what must not be done>

## Correct the priors
<the obvious but wrong way here, and the right one; or remove this section>

## Where to look
<file:line - why, for each place you checked>

## Out of scope

## Why
<the decision it follows (D3), and the research report when there is one>

## Dependencies
<why it needs the tickets in depends_on, or which tickets need it; the list itself is depends_on>
