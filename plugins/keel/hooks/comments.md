# Code comments in this project (level: {{LEVEL}})

This project's comment policy, for code you write or change here. It replaces any default you have
about comments, such as "write no comments" or "one short line max".

Why: every comment is read again on each later visit, by people and by models that pay for every
token, so a comment that repeats the code is a cost with no return. A missing comment on tricky code
costs far more: someone misreads it and breaks it. So comments go exactly where a reader would
otherwise be misled or stuck, and nowhere else.

The level ("{{LEVEL}}") decides only plain code. Cases 1 and 2 below always get their comment.

**1. Tricky code: always a comment, as long as the reader needs** (several lines are fine):
- a formula or calculation: several factors, powers, roots, trigonometry, logarithms, statistics,
  bit shifts and masks, a rounding rule. Say what is computed, the formula or its name, and the units;
- hidden behaviour of code you call: read the code you call; if it does more than its name says
  (changes its argument, writes, sends, queries a database, caches, silently rejects some inputs),
  say so where you call it;
- an order that matters (this must run before that);
- legacy or compatibility code: anything that follows an old system, format or contract. Say what it
  stays compatible with;
- code that looks wrong but is right, or is right only because of a convention the reader must
  remember (an off-by-one on purpose, months counted from 0 in a JavaScript Date, an exclusive end
  index, seconds where milliseconds are usual, a deliberate ignore).

**2. Unclear value or name: always a comment, length by level.**
- a literal a reader has to calculate or look up (a hex value or bit mask such as 0xFF00, 2.33,
  86400, 1.4142), even when its name is good: say what it is and where it comes from. Writing it from named parts instead
  (`OWNER | GROUP`, `3 * 24 * 60 * 60 * 1000`) also works and then needs no comment;
- a call to an existing function whose name does not say what it does.
{{UNCLEAR}}

A clear name replaces a comment only for what the name says. It does not replace explaining a
formula, a legacy rule or a hidden effect.

The comment for cases 1 and 2 goes at the spot: above the line or block it explains. A doc comment
tells callers what a function does; it does not replace the comment at the tricky spot inside.

**3. Plain code: everything else**, however long, when a reader sees at a glance what it does:
{{PLAIN}}

Never: a comment that says what the next line does; commented-out code; history ("was X", "fixed");
a reference to the task, ticket, plan or step; new comments on code you did not change (a comment
your change made wrong is fixed). In an existing file, write comments in the language its comments
already use; in a new file, in the repository's language.

**Last step before you report:** go through the code you wrote or changed, find every case 1 and 2,
and check that each has its comment; then check that plain code has only what level "{{LEVEL}}" allows.

<examples>
<example kind="1, formula">
// Annuity payment: P * r / (1 - (1 + r)^-n), where r is the monthly rate (annual % / 12 / 100)
// and n the number of months. With r = 0 the formula divides by zero, so it is P / n.
</example>
<example kind="1, hidden behaviour">
# load_tariffs() also empties the module-level tariff cache, so it runs once, before any lookup.
</example>
<example kind="2, literal">
TIMEOUT_MS = 90_000  # the payment gateway drops idle connections after 90 s
COLOR_BITS = 0xFFFFFF  # the lower 24 bits: red, green and blue, 8 bits each
</example>
</examples>
<!-- level:short -->
<!-- unclear -->
At level "short": one short line.
<!-- plain -->
At level "short": no comments and no doc comments on plain code, except one line of "why" for a decision
a reviewer would question (an unusual limit, library or approach).
<!-- level:functions -->
<!-- unclear -->
At level "functions": as many lines as make it clear, usually one or two.
<!-- plain -->
At level "functions": a doc comment of 1-3 lines on each exported or public function, class and method
(what it does, inputs whose meaning the names do not show, errors it throws); no comments inside
plain code; private helpers get none.
<!-- level:detailed -->
<!-- unclear -->
At level "detailed": as many lines as make it clear.
<!-- plain -->
At level "detailed": a doc comment on every function, class and method: one line of purpose, then
only the parameters, return value and errors whose meaning the names and types do not already show
(usually 2-5 lines in all; no list that repeats parameter names); in a long function, a one-line
heading before each logical block. Still never a comment that says what a single line does.
