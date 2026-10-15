# Protocol: architecture and modularity

Used by the `architect` agent and by the `architecture` advisory skill. Question: does each new
thing sit where it belongs, at a size and shape the next change can live with?

## Checklist (answer each with evidence)
1. **Placement.** For each new function, class or file: does a module that already owns this
   responsibility exist? Name it by path. New code belongs next to the code it changes with.
2. **Responsibilities.** Does a touched file or class now have two or more unrelated reasons to
   change? Name both reasons.
3. **Size and growth.** Lines before and after (the change summary has them for big files). A file
   over the project's warning or limit matters only if this change grew it or added a new
   responsibility to it. Split by responsibility, never by line count. When the change grows a file
   that is over the warning, report it even if the new code belongs there and the mix is older than
   the change: minor, naming the responsibility to move out next and where it goes. Important only
   when this change adds an unrelated responsibility to it.
4. **Knowledge in two places.** Is one rule, format, constant or state transition now encoded in two
   modules that must change together? Name both places.
5. **Dependency direction.** Does a core or lower-level module now import an outer one (domain
   importing UI, controller, framework or driver)? New import cycles? Cite the import and the
   project's layering rule (CLAUDE.md, lint config, or the existing import pattern).
6. **Shared or local.** Something put in `shared/`, `common/`, `utils/` or `lib/` with one caller?
   Something copied for the third time that should live in one place?
7. **Duplication.** Does the change re-implement a helper, framework feature or library function the
   project already has? Cite the existing `file:line`.
8. **Dead code.** Unreachable branches, unused parameters or exports, flags nothing sets. Show a
   project-wide search with zero callers and check for dynamic use (reflection, string lookup, config).
9. **Over-engineering.** An interface, factory, plugin point or option with one implementation and no
   caller that needs the variation. A pass-through wrapper that only forwards. A helper for a one-time
   use. Handling for a case that cannot happen (inputs are checked at the edges: users, files,
   networks).
10. **Under-structure.** A new unrelated responsibility pushed into an already large multi-purpose
    file instead of its own module; a function with many unrelated branches.
11. **Names.** Does each name (variable, function, class, file, folder) say what the thing does now?
    Show the call site where a reader would be misled (a `get_x` that writes, domain logic in
    `utils`, a name that kept its old meaning after the behavior changed).
12. **Public surface.** Exported only for internal use? Internals (mutable state, database rows)
    crossing a module boundary?

## Evidence
- Both locations: the new code and the place it should be near, duplicates, or conflicts with.
- Size findings: measured lines before and after, the responsibilities counted, which one to extract
  and where it goes.
- Dependency findings: the import line, the layer it crosses, the rule that defines the layers. No
  stated or visible layering → at most minor.
- The concrete future cost: which next change becomes harder and why.

## Do not flag
- A long but cohesive file or function. Size alone (keel's 700/1,000 lines included) is a signal to
  look, not a finding.
- An abstraction for one or two similar blocks: duplication is cheaper than the wrong abstraction.
  Flag duplication at three copies, or at two when the copies carry a business rule.
- Smells as verdicts: a smell is a reason to look, not a defect.
- Renames or moves outside the task.
- Layering complaints in a project with no layering.

## Severity
- **critical**: a new cycle or layer violation that breaks the build or a stated architecture rule;
  two divergent copies of an authorization, validation or money rule.
- **important**: a new responsibility in an already multi-purpose module with measured growth; a
  shotgun-surgery pattern the change creates; non-trivial duplicated logic; single-use code in a
  shared location others will now depend on; a misleading name on public API.
- **minor**: a helper in the wrong folder, an unused parameter, a vague local name.
