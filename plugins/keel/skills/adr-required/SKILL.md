---
name: adr-required
description: Use when a change alters an architectural decision - a new dependency, datastore, protocol, module boundary, cross-cutting pattern or public contract. Propose a short ADR with the code.
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

## Format
File `docs/adr/NNNN-short-title.md` (zero-padded sequence; follow the project's existing scheme if it
has one). Under one page:
- **Status:** Proposed / Accepted / Superseded by NNNN
- **Context:** the forces and constraints
- **Decision:** what was decided, in one sentence
- **Consequences:** trade-offs, what gets harder
- **Alternatives considered:** and why they were not chosen

A superseded ADR stays; the new one links to it.
