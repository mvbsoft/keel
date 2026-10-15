---
name: documentation-philosophy
description: Use when writing or updating docs, comments, ADRs, specs or project rules. Puts each fact in one right place, keeps docs true in the same change, and follows the project's documentation profile.
---

# Documentation philosophy

## Easy to miss
- After adding or changing a fact (a default, port, path, variable, limit, or a behaviour such as "uses
  an in-memory database"), search the same file and the docs folder for its other mentions, including
  code-block comments, and remove or link them. Facts written twice drift apart.
- Check each claim against the code line it describes, including what happens when a value is unset,
  empty or invalid.

## One fact, one home (link, don't copy)
- **CLAUDE.md / AGENTS.md:** durable rules every session must follow in this project. Keep each under
  about 200 lines: they load every session and longer files are followed less well.
- **Skill:** how to do a recurring task here, with a clear trigger.
- **ADR** (`docs/adr/`): why an architectural decision was made. See `adr-required`.
- **Docs** (`docs/`): prose for users and contributors.
- **Code comment:** as much as the project's comment level allows (`comments.level`); never restate the code.

## Rules
- Docs and the behaviour they describe change in the same commit. A doc that became false is fixed or
  deleted: stale docs are worse than none.
- A fact true for the whole machine is not project documentation.
- Templates are referenced, not copied into every file. Logs and journals archive old entries instead
  of growing without limit.

## Documentation profile (`.keel/config.json` → `docs`)
The profile is a maximum: a small task never gets a spec. What each profile and pattern writes:
`${CLAUDE_PLUGIN_ROOT}/skills/_shared/docs-profiles.md`.
