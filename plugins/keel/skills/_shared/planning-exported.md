# keel planning: an exported feature (read from planning.md "Exported feature")

The calling command gives you `<keel>`, `<project>` and the language. "Rules", "Work", "Several
repositories" and "Reviews" below are sections of `<keel>/skills/_shared/planning.md`.

Its tickets live in the feature folder; work there continues while others may already build them.
1. `node "<keel>/scripts/plans.js" "<project>" tickets <f>`: show its lines as printed
   (`branch: <b> -> <merge_into>`, each ticket's state and hint).
2. The feature folder is not in this working tree (its tickets are on another branch: `plans.js mark
   set` refuses and names it) → ask "Switch to `<branch>`?"; yes →
   `node "<keel>/scripts/git-flow.js" "<project>" switch --name <branch>` (the name without the remote
   prefix: `origin/x` → `x`; `stopped` → its reason, wait),
   then the mark again; no → stop. The mark set prints `planning: <f> (exported: <folder>)`.
3. Only `to do` (or `next`) tickets are edited: show each change and write it only on a yes. Then
   `plans.js check <f>` and a ticket review of the changed tickets (planning.md "Reviews" steps 3, 5 and 6 with
   the feature folder: each reply goes through `plans.js report` too; no `plans.js review` or
   `reviewed`, no `reviews/` record: the user decides each finding in the chat).
4. A ticket `in progress`, `waiting for ...` or `done` is never changed: offer a new ticket, or leave it
   as it is; name whom it concerns (the branch and author of its hint).
   No command removes a ticket or cancels the feature (`plans.js drop` takes only a feature whose every
   ticket is `done`). A `to do` ticket the user no longer wants: after a yes, its file and its line in
   the overview's Tickets go, then `plans.js check <f>` (a key still in some `depends_on` shows there).
   First `plans.js tickets <f> --fetch` again: a ticket someone started on another machine no longer
   reads `to do`, and stays. Cancelling the feature is that for each `to do` ticket; the others stay
   as this step says.
5. A new ticket: `plans.js ticket <f> --title "<title>" [--slug <english-words>] [--depends "K1,K2"]` →
   `created: <path>` and `ticket: <KEY>` (the next key shared across the repository); fill it as
   planning.md "Work" says, then step 3's check and review. A feature on several repositories: `--repo <PREFIX>`
   for another repository of its overview puts the ticket in that repository's feature folder with
   its next key; `overview:` lines name each overview that got its line, `note: <PREFIX>: its
   overview is not updated (<why>)` → say it.
   A stub (`<PREFIX>-S<n>`) whose repository is on this machine now (its line in step 1 or a note of
   check says so): offer to turn it into a ticket;
   yes → `plans.js ticket <f> --from-stub <PREFIX>-S<n>` → `converted: <stub> -> <KEY>`: the ticket
   is in that repository's feature folder with its next key and `replaces: <stub>` (tickets that name
   the stub now wait for it; none is edited), the overview there and here lists it, the stub went to
   keel's trash. `plans: ticket refused (...; nothing converted)` → say why; the stub is back and
   nothing was written there. `plans: ticket refused (--from-stub: <PREFIX> is not ready)` with `not ready:` lines
   → say them and ask as planning.md "Several repositories" item 8 (Export) does (no `--as-is`). Then write its Boundaries, Correct the
   priors and Where to look from that repository, check and review it there; `note: the overview in
   ... still lists <stub>` → run the `plans.js align` it names.
6. Done → `/keel:end-planning` checks the folder and offers the commit and push of every repository
   it changed.
