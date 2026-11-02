---
type: plan
status: <draft | ready | exported | abandoned>
feature: <feature name: the folder name>
language: <language of the plan and its tickets>
export: <where the tickets went: pc | repo, written by plans.js export, or ->
branch: <the feature branch, written into every exported ticket; plans.js set changes it>
merge_into: <the branch the feature merges into (git.main_branch by default); plans.js set changes it>
created: <YYYY-MM-DD>
after_commit: <git rev-parse --short HEAD while writing, or ->
last_ticket: <highest T-number ever given; numbers are never reused>
ready_hash: <set by plans.js state ready; any later change makes the plan a draft again, or ->
---
<!-- The plan of one feature (plans.js new). Headings and front matter keys stay in English; the text is
in the plan's language. plans.js check reads the sections by these names: keep them all, empty when
there is nothing to say; Stubs may be removed. Export builds the feature overview README.md from In
plain words, Level, Decisions, Contract, Out of scope, Terms and Stubs, with a Tickets list of its own.
Level: the level of the feature chosen (what is built) and what is left for later. Contract: the APIs, events and formats
between repositories. What was gathered: what was found before the questions. Stubs: a title and In plain
words for each part a repository that is not on this machine would do. No TBD and no <...> left in the text. Comments are removed
when the file is made. -->
# <feature>

## In plain words
<the whole feature in plain words: what and why, how it will work, an example, what is not done, how we know it is done>

## Level

## Decisions
<D1. decision - why>

## Contract

## Out of scope

## Design sketch

## Terms

## What was gathered

## Open questions
<Q1. question - what depends on it>

## Tickets
<T1 title, one line per ticket>

## Stubs

## Next action
