---
type: plan
status: <draft | ready | exported | abandoned>
feature: <feature name: the folder name>
page: <the code of the feature's page, 8 random hex digits, written by plans.js new; it goes into every exported ticket; keep it>
language: <language of the plan and its tickets>
export: <where the tickets went: pc | repo, written by plans.js export, or ->
branch: <the feature branch, written into every exported ticket; plans.js set changes it>
merge_into: <the branch the feature merges into (git.main_branch by default); plans.js set changes it>
repos: <a feature on several repositories: their ticket prefixes, this project's first, [API, WEB]; plans.js set --repos changes it; or ->
created: <YYYY-MM-DD>
after_commit: <this project's HEAD when the plan's facts were last checked; plans.js set --after-commit, or ->
after_commit_repos: <the same for each other repository of repos, WEB=<commit>, MOB=<commit>; plans.js set --after-commit, or ->
last_ticket: <highest T-number ever given; numbers are never reused>
ready_hash: <set by plans.js state ready; any later change makes the plan a draft again, or ->
---
<!-- The plan of one feature (plans.js new). Headings and front matter keys stay in English; the text is
in the plan's language. plans.js check reads the sections by these names: keep them all, empty when
there is nothing to say; Stubs may be removed. Export builds the feature overview README.md from In
plain words, Level, Decisions, Contract, Out of scope, Terms and Stubs, with a Tickets list of its own.
Level: for a reader who has not seen the levels, which of how many and what the scale means, what this
level builds, and what is left for later and why. Contract: the APIs, events and formats
between repositories. Design sketch of a feature on several repositories: one "### <PREFIX>" part per
repository of repos. What was gathered: what was found before the questions. Stubs: for each part a
repository that is not on this machine would do, "### <repository>: <title>", a line saying it is a stub
for that repository, not planned or built here, then its In plain words; no ticket names a stub in
depends_on. No TBD and no <...> left in the text. Comments are removed when the file is made. -->
# <feature>

## In plain words
<the whole feature in plain words: what and why, how it will work, an example, what is not done, how we know it is done>

## Level
<which level of how many, and what the scale means in plain words; what this level builds; what is put off for later and why>

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
