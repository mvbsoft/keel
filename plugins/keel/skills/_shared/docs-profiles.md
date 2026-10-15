# keel documentation profiles

What a task writes besides code, by `.keel/config.json` `docs.profile` (and `docs.pattern` for
profiles 3-4). The profile is the most a task may write: the size of the task decides what it
actually writes, so a small fix gets no spec or ADR in any profile.

## Every profile
- Existing docs that the change makes untrue are updated in the same change, fully: README, CLAUDE.md,
  `docs/`, docstrings, examples, CHANGELOG when the project keeps one. Stale docs are a bug.
- Existing docs are never restructured or moved to a new pattern as a side effect; that is a separate
  task.
- A document keeps its language; a new one is written in `repo_language`.
- keel's own working files (`.keel/next-session.md`, memory, session logs) are not project docs and
  are kept in every profile.

## 1. Maintenance only
Nothing new: no new documents, ADRs, specs or README sections for new things. Only the updates above.

## 2. Standard
Profile 1, plus an ADR for an architecturally significant decision only: a new dependency or
service, a new module boundary, a data model or storage choice, a public API or protocol change, a
security approach, a decision that is costly to reverse. One to two pages (context, decision,
consequences, alternatives), in the project's ADR folder and format; the short MADR layout when the
project has none (`docs/adr/NNNN-title.md`). Small decisions stay in the commit message.

## 3. Spec per feature
Profile 2, plus a short spec for a non-trivial feature: a new user-visible capability, a change that
crosses modules, or one that needs agreement before code. The spec says goal, scope and non-goals,
behaviour with examples, acceptance criteria, open questions; it goes where the project keeps specs
(else `docs/specs/<feature>.md`) and is written before the code. The task plan stays in keel's plan
file, not in the spec. A bug fix or a small change gets no spec.

## 4. Heavy
Profile 3, plus what the project's own process asks for: task files, a decision log, state or debt
registers. Logs get an entry per task, not a rewrite; old entries are archived when a log passes about
200 lines, and templates are referenced, never copied into each file.

## Pattern (profiles 3-4)
Where new docs go, by `docs.pattern`:
- `none`: next to the docs the project already has.
- `diataxis`: one of four kinds, never mixed in one page: tutorial (learning by doing), how-to (a goal,
  steps), reference (facts to look up), explanation (why and how it works). New pages go to the folder
  of their kind.
- `arc42`: architecture changes go into the matching arc42 section (building blocks, runtime,
  deployment, crosscutting concepts, decisions, risks), short, not a new free-form page.
- `arc42-c4`: as arc42, and a change to systems, containers or components updates the C4 diagram
  source that shows it.

## Growth guards
- A file Claude Code loads into every session (CLAUDE.md, `.claude/rules/*.md`) over about 200 lines:
  say so in the report and propose moving detail out: longer files cost more context and are
  followed less reliably.
