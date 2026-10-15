---
name: architecture
description: Use before coding a feature or non-trivial change, in an unfamiliar area, or when deciding how to structure new logic. Maps the code, checks where each piece belongs, file size, names, and whether an abstraction is earned.
---

# Architecture: map, place, size, structure

## Easy to miss
- Growing a file that is over the warning: say which responsibility moves out next and where, even
  when the new code belongs in that file.

The same protocol the `keel:architect` agent uses in verification. Run it on the **plan**, before the
code exists; skip it for trivial edits (one-line fix, rename, pure data or config).

## 1. Map the area first (unfamiliar code)
1. Read the contract: `AGENTS.md`, `CLAUDE.md` (root and nested), `README`, `docs/`, ADRs. They override defaults.
2. Entry points: app bootstrap, routes, CLI or worker entries. Note file paths.
3. Architecture rules: layers, dependency direction, module boundaries; checkers such as
   dependency-cruiser, import-linter, deptrac.
4. Tests: where they live, how to run them, what a good test looks like here.
5. The 1-3 files the change touches and their direct collaborators.
Report the map in a few bullets before editing when anything is ambiguous.

## 2. Check the planned change
- **Placement:** each new piece lives with the code it changes together with; data flow obeys the
  project's layers; the domain does not depend on infrastructure.
- **Boundaries:** no new cross-module import where an existing seam exists; no circular dependency;
  one domain's concepts do not leak into another.
- **Shared or local:** shared code only when two or more real callers need it today.
- **Size and growth:** a file over the warning threshold (`.keel/config.json` →
  `architecture.file_lines_warn`, default 700) or the limit (`file_lines_max`, default 1000) is a
  signal to look, not a rule to split. Split by responsibility, never by line count.
- **Lean:** no dead code, no duplicate of an existing helper, no layer that only forwards calls.
- **Names:** variables, functions, classes, files and folders say what they are and do (a function
  that returns products is not `getVariants`).
- **Anti-patterns:** business logic in controllers or handlers, god objects, new global state,
  validation duplicated instead of shared.
Verdict: OK, or a corrected placement with reasons, before writing code.

## 3. Structure of new logic: is an abstraction earned?
Default to simple code; the wrong abstraction costs more than duplication. Advise in both
directions, even when the user asked for "modular"; the user decides.
- **Plugin family (registry):** only when all three hold: three or more real variants (or a concrete
  roadmap naming them), a deep interface that hides more than it exposes, one axis of variation.
- **Single seam:** logic crosses an I/O boundary (network, DB, process, clock, filesystem) and the core
  must be testable offline → one narrow interface, one real implementation, one test fake. A test
  being the only second user is fine here.
- **Not yet:** one or two kinds today, more plausible → simple code, a clean boundary and a concrete
  revisit trigger ("when a second engine lands, extract a registry").
- **Simple code:** a closed case set, variation that is only parameters, a one-shot transform, or
  imagined future variants.
Give the verdict with its pros, its cost now, its risk, and how painful adding it later would be.
Talk to the user in the language of keel's session-start line (else ${user_config.conversation_language}).
