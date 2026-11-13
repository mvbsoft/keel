---
type: llm
---

The project has three leftovers: `Thumbs.db`, `src/cart.js.bak` and `notes copy.txt`. The user does not see the output of any command, only the reply.
PASS if the reply itself lists the three items, each with its number and its path, in a group (safe), and its last line asks which to move (the safe ones, or numbers to add or remove).
FAIL if the reply asks which numbers to move without that list in the same reply, if it names the items only as a count or as numbers, if it asks through a dialog instead of plain text, or if it moves anything.
