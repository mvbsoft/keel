# Protocol: code comments

Topic `comments` of the `docs` specialist group. Question: do the comments in the changed code follow
the project's comment rules: an explanation at every tricky spot, nothing that repeats the code, and
no more than the level allows?

First read the rules the author worked under: `<keel>/hooks/comments.md` and the level in
`<project>/.keel/config.json` (`comments.level`; `short` when it is not set). Judge only code the change
added or changed.

## Checklist
1. **Tricky spot without an explanation** (rules, case 1). For each changed function, read the code it
   calls when the call's effect is not obvious from its name. Flag a formula or calculation, a hidden
   effect of called code (it changes its argument, writes, sends, queries, caches, silently rejects
   input), an order that matters, a legacy or compatibility rule, or code that looks wrong but is
   right, when no comment at that spot explains it. A doc comment on the function does not count for
   a spot inside it.
2. **Unclear value or name without a comment** (case 2): a literal a reader must calculate or look up,
   not built from named parts; a call to an existing function whose name does not say what it does.
3. **Comment that repeats the code**: it says what the next line does, or restates the function name
   and parameter names without adding anything.
4. **More than the level allows on plain code**: doc comments at `short`; doc comments on
   private helpers or comments inside plain code at `functions`; doc comments at `detailed` that list
   parameters whose names and types already say everything.
5. **A long explanation that should be short**: a case 2 comment longer than one line at
   `short`; a comment that explains the same thing twice (above the function and again inside).
6. **Wrong or stale comment**: a claim in a changed comment that the code contradicts (units, order,
   values, what is returned or thrown), or a comment above changed code that still describes the old
   behaviour.
7. **Forbidden content**: commented-out code; history ("was X", "fixed"); a reference to the task,
   ticket, plan or step; new comments on code the change did not touch.
8. **Language**: a new comment in an existing file not in the language its comments already use.

Your task may list long comments the author kept after `comments.js` reported them, each as
`file:line` + reason. Judge each reason: a formula, hidden behaviour, legacy rule or look-wrong spot
keeps it; anything else does not.

## Evidence
- The spot with `file:line`, the comment text (or "no comment"), and why it breaks the rule: what a
  reader would misread at that spot, or which code line the comment repeats.
- For a hidden effect: the line of the called code that has the effect (`legacy/geo.js:7` changes
  `p.lon`).
- Give the fix in one line: the comment to add (written out, short), or "remove", or the shortened
  text.

## Do not flag
- Wording and style of a comment that is correct, useful and within the level.
- Missing comments on plain code: at every level, plain code needs no comment inside it.
- A missing doc comment at `functions` or `detailed` when a short comment at the spot covers the
  tricky part: report the missing doc comment as minor only.
- Comments on code the change did not touch, unless the change made them wrong.
- Literals that are round or small (0, 1, 2, 10, 100, 1000, 0.5, powers of two used as sizes) or built
  from named parts.

## Severity
- **important**: a tricky spot without an explanation where a reader is likely to break the code (a
  hidden effect, an order that matters, a legacy rule, a look-wrong spot); a comment that is wrong.
- **minor**: an unclear literal or name without a comment; a comment that repeats the code; more or
  longer comments than the level allows; forbidden content; a comment in the wrong language.
