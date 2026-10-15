# Protocol: requirements audit

Topic of the `docs` specialist group. Runs only when the task has explicit requirements or
acceptance criteria (the session passes them in your task). Question: is everything promised done,
and nothing unrequested added?

## Steps
1. **List the requirements.** Split the task's requirements into atomic, checkable items and number
   them. Quote each one.
2. **Promised → done?** For each item, find the code that implements it. Evidence, strongest first:
   a test that exercises it (name and `file:line`), then the implementing hunk, then a file alone.
   The author's word is not evidence. Status: done, partial, or missing.
3. **Unrequested?** For each substantial hunk, which requirement does it serve? Unrelated refactors,
   new public API, new options or flags, speculative generality and drive-by behavior changes with no
   requirement behind them are findings.
4. **Named edge cases.** Errors and edge cases the task named: handled and tested?

## Evidence
- Missing: the requirement quoted, a search showing no hunk touches the relevant path, and the
  identifier existing nowhere in the changed tree.
- Partial: the requirement, the hunk, and the part that is missing.
- Unrequested: the hunk, and that no requirement maps to it, with a visible effect (public symbol,
  behavior change, new dependency, new config key).

## Do not flag
- Mechanical necessities: imports, lock files, generated files, fixtures, renames forced by the change.
- Requirements with two plausible readings: report the ambiguity in `checked`, not a "missing" finding.
- Code quality: other protocols cover it.

## Severity
- **critical**: a core requirement entirely unimplemented or implemented backwards.
- **important**: a partial requirement; a significant unrequested behavior change or public API.
- **minor**: a small unrequested addition with no behavior effect on users.

## Principles
- The change does what was asked, and nothing that is not needed now.
- Evidence ranks: a test beats a diff hunk, a hunk beats a file path, a bare assertion is rejected.
