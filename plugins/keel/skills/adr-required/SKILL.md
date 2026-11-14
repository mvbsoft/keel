---
name: adr-required
description: Use when a change alters an architectural decision (a new dependency, datastore, protocol, module boundary, cross-cutting pattern, public contract) and before writing or changing a decision record. Follows the project's ADR style.
---

# ADR for architectural decisions

## Easy to miss
- A new package: before installing, give the user its docs link, licence, maintenance (last release,
  open issues), install size and native build needs, then wait for yes. Do not run `npm install`,
  `pip install` or the like first. Take the version from the registry, never from memory.

Propose an ADR before or with the code when the change introduces or alters:
- an external dependency or library;
- a datastore, queue or transport;
- a module or bounded-context boundary;
- a cross-cutting pattern (auth, caching, error model, concurrency);
- a public contract (API, event, file format).

Routine changes do not need one: bug fixes, refactors inside a boundary, styling. Do not manufacture
ADRs. When unsure, ask: "this looks architectural - write an ADR?"

## The project's documentation profile decides
Read `docs.profile` in `.keel/config.json` first:
- **1 (maintenance only) or no keel config:** write no ADR file. Say in one line that this is an
  architectural decision and offer an ADR; write it only when the user says yes.
- **2 or higher:** write the ADR with the code.

## The project's ADR style decides
Read `docs.adr_style` in `.keel/config.json` and follow only that style's rules (the status list, what
to do with a changed or dead decision):
- `journal`, or no key: `${CLAUDE_PLUGIN_ROOT}/skills/_shared/adr-journal.md`;
- `living`: `${CLAUDE_PLUGIN_ROOT}/skills/_shared/adr-living.md`;
- `custom`: the project's own rule in the ADR folder's README (for example `docs/adr/README.md`); no
  such rule there → ask the user how they keep their ADRs.

## Format
File `docs/adr/NNNN-short-title.md` (zero-padded sequence; follow the project's existing scheme if it
has one). Under one page:
- **Status:** the list of the project's style
- **Context:** the forces and constraints
- **Decision:** what was decided, in one sentence
- **Consequences:** trade-offs, what gets harder
- **Alternatives considered:** and why they were not chosen; required in both of keel's styles
