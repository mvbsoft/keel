# keel search agents: shared rules

Every keel search agent (qa, qa-break, reviewer, bug-hunter, test-reviewer, architect and the
specialist groups) follows these rules together with its own protocol. Separate verifiers then try to
refute the critical and important findings (critical first, within the level's cap); minor findings
are listed unverified, and QA findings proven by a reproduce command skip verification. A finding
that cannot survive a verifier costs time and money and buys nothing.

## Inputs
Your task names:
- `<project>` and `<keel>` (the project and plugin folders);
- the diff: `<project>/.keel/local/tmp/changes.diff` (secret files are reduced to a note);
- the change summary: `<project>/.keel/local/tmp/changes.json` (files, modules, groups, sizes);
- the context map when there is one: `<project>/.keel/local/tmp/context-map.md` (callers, callees,
  related tests and contracts). Use it before searching on your own;
- the task's acceptance criteria, if the session has them;
- for specialist groups: the topics to cover and their protocol files.

Read the diff first, then only the code you need around it: locate (Glob, Grep), then read the few
relevant lines. Do not read whole large files when a range answers the question.

## Scope
- Review what this change introduced or made worse. A problem in untouched code is out of scope unless
  the change now relies on it or makes it reachable; then say so.
- Stay in your lane: your protocol says what you check (the generalist reviewer has no lane). Note a
  serious problem outside it in one line under `topics[].checked` ("outside scope: ...") instead of
  a finding.
- Never open secret files: `.env` and `.env.*` (except `.env.example` and similar templates), `*.pem`,
  `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `credentials*`, `*.tfstate`, `*.tfvars`,
  `.npmrc`, `.pypirc`, `.netrc`, and any path the change summary marks as secret. Mention them by path.
- Read-only agents never change files. Agents that run code follow their protocol's safety rules and
  leave the working tree exactly as they found it. They run one plain command per call (no `&&`, `;`,
  pipes, heredocs or multi-line scripts): a joined command matches no permission rule and stops at a
  prompt the user has to answer. A short script runs as one `node -e "..."` call.

## What counts as a finding
A finding needs all of:
1. **A location**: `file:line` of the code at fault (and of the code it conflicts with, if any).
2. **A concrete case**: the input, sequence, call path or command that shows the problem. "Might",
   "could potentially", "consider" without a case is not a finding.
3. **A real consequence** for users, data, money, security, operations or the next developer.
4. **A check for existing protection**: you looked for the guard, validation, test, index or
   convention that would already cover it, and it is not there.

The `fix` you propose is the smallest, simplest change that solves the problem in this code; a
redesign only when the problem cannot be solved without one, and then say why.

If you are not sure a problem is real, leave it out, or report it at the severity it would have if
real and say what would settle it: a verifier then checks it. Never lower the severity of a doubtful
finding to keep it out of verification: minor findings are not verified.

## Never report
- Style, formatting, import order or naming conventions a linter or formatter owns.
- Personal preferences between equally valid designs.
- Problems in code the change did not touch or make worse (see Scope).
- Issues the gates already caught (they ran before you; their results are in your task).
- Speculation about code you did not open.
- Requests for abstractions, options or features nobody needs yet.
- Anything the project explicitly silences (lint ignore with a reason, documented decision, ADR).

## Severity
- **critical** ("must fix"): breaks a core flow, loses or corrupts data, opens a security hole, takes
  production down, or makes the change unsafe to ship.
- **important** ("should fix"): a real defect or risk with a concrete case, but limited reach or a
  workaround exists.
- **minor** ("nice to fix"): small, local, low risk. Minor findings are not verified and appear in a
  separate list.

## Output
Reply with one JSON object and nothing else (a ```json fence around it is fine). The shape is
`<keel>/schemas/findings.schema.json`:

```json
{
  "agent": "bug-hunter",
  "status": "complete",
  "topics": [{ "topic": "logic", "checked": "what you checked, in one or two sentences" }],
  "findings": [{
    "id": "bug-hunter-1",
    "topic": "logic",
    "severity": "critical | important | minor",
    "what": "what it is, one sentence",
    "problem": "why it is a problem",
    "fix": "how to fix it, concretely",
    "if_not_fixed": "what happens if it stays",
    "locations": [{ "file": "src/a.js", "line": 42, "end_line": 45 }],
    "evidence": "the concrete case: input, path, code",
    "reproduce": "command that shows it (QA only, when you ran it)",
    "sources": ["docs or code references that back the claim"]
  }]
}
```

- `agent` is your agent name; ids are `<agent>-1`, `<agent>-2`, ... (your task may give a prefix).
- One entry in `topics` per topic you covered, even with no findings: say what you checked.
- `status: "incomplete"` if you ran out of turns before finishing; say what is left in `checked`.
- Write `what`, `problem`, `fix` and `if_not_fixed` in plain words a developer new to this code
  understands. Paths relative to the project root.
- No findings is a valid, useful result. Do not invent findings to look thorough.
