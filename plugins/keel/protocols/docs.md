# Protocol: documentation truthfulness

Topic of the `docs` specialist group. Question: does every documentation claim the change touched or
made stale still match the code?

## Checklist
1. Each changed sentence in README, `docs/`, docstrings, comments, CHANGELOG: does every checkable
   claim (names, flags, defaults, return values, errors, side effects, numbers, paths, commands)
   match the code after the change? Cite the claim and the code line.
2. Docstrings: documented parameters match the real ones (added, removed, renamed, reordered); the
   documented returns and errors match the code. New public API has a docstring that lets a caller
   use it without reading its body.
3. Code examples and shell snippets in the docs still work against the new API: names, argument
   order, flags, import paths (check by reading).
4. Stale elsewhere: the change renamed, removed or changed X. Does an untouched doc, comment, config
   example or CHANGELOG still describe the old X? Search for the old name and the old default.
5. Stale comments in touched code: a comment above a changed block describing the old behavior; a
   TODO the change resolved; a reference to a renamed symbol; a "temporary" note that no longer holds.
6. CHANGELOG, if the project keeps one: user-visible changes listed in the right section; breaking
   changes and deprecations called out.
7. Placement: new docs sit where the project's existing pattern puts them (sibling files, README
   sections, docs layout, ADR folder, the documentation profile in the project config).
8. Links and references: relative links, anchors, referenced files, environment variables, commands
   and config keys exist.

## Evidence
- Both sides: the doc text with `file:line`, and the code with `file:line` that contradicts it, plus
  the concrete case where the claim fails ("README says `--retries` defaults to 3; `config.py:41`
  sets 5").
- Staleness: the old behavior described at `file:line` in the untouched doc, and the diff hunk that
  changed it. "Docs may need updating" is not a finding.

## Do not flag
- Prose style, grammar, tone, Markdown formatting.
- Missing docs for private helpers, unless the project documents them as a rule.
- A comment that restates the code, unless it is wrong.
- Inaccuracies in lines this change did not touch and did not make stale.
- Omitted Args/Returns sections when the signature is self-explanatory.
- Placement preferences without an observable project pattern.
- "Add a CHANGELOG entry" in a project that keeps none, or for internal-only changes.
- "Could be clearer" and missing tutorials.

## Severity
- **critical**: docs that, if followed, cause data loss, a security failure or an outage (a documented
  secure default the code does not apply, a destructive command described wrongly, a wrong migration
  order).
- **important**: a user-facing claim (README, API reference, CLI help, public docstring) contradicted
  by the code; a breaking change without a CHANGELOG or migration note; a documented example that
  fails.
- **minor**: a stale internal comment or TODO, a broken anchor, an entry in the wrong CHANGELOG
  section, a doc in a slightly odd place.
