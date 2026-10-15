---
name: python-conventions
description: Use when writing or reviewing Python. Baseline conventions - typed public functions, validated boundaries, no blocking I/O in async code, explicit errors, behaviour tests. The project's own rules win.
---

# Python conventions (baseline)

## Easy to miss
- `with sqlite3.connect(...) as conn` only commits or rolls back; it does not close the connection.
  Use `contextlib.closing(...)` or close it in `finally`. Check the same for other DB-API drivers.
- A script gets a test like any other code (pytest), unless the project has no Python tests at all;
  then say so.

The project's own tools and rules come first; this is the fallback.

- **Tooling:** use what the project uses (uv, poetry or pip; ruff, black, mypy or pyright). Its
  linters, type checker and import contracts are gates, not suggestions.
- **Types:** type hints on public functions; validated models at I/O boundaries (e.g. pydantic); no
  bare `Any`; `Protocol` for seams that tests replace.
- **Async:** never block the event loop (no synchronous I/O in async paths); use the async drivers
  the project already has.
- **Layers:** the domain does not import infrastructure; adapters implement the interfaces the domain
  defines.
- **Errors:** specific exception types per failure; never catch and swallow; log with the project's
  logger, without secrets.
- **Tests:** pytest (plus its async plugin where needed); test behaviour at seams; cover the happy
  path, failures and boundaries; follow the project's layout.
- **Standard library first:** `pathlib`, `dataclasses`, `itertools`, `functools`, `datetime` with time
  zones before a new dependency.
