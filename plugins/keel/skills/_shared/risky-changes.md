# Risky changes: ask, offer variants, write what was chosen

A risky change to a database or an API can be done in several ways, from the most reliable to the
simplest. Which one fits is the project's call, not keel's: a bank and an admin panel used by one
person need different things. So keel never applies one deploy style by default. It stops, offers the
variants for this very change, recommends one, and builds what the person picks.

## When to ask
Ask before writing the change (in planning: before the tickets) when it is one of these:
- **Schema, on a table that has data:** rename, drop or retype a column or table; a new `NOT NULL`
  column without a default on an existing table; split or merge tables or move data between them; a mass `UPDATE` or
  `DELETE`.
- **Data that would be destroyed:** any of the above that loses data → also the backup question.
- **API others can call:** a field, parameter, path or event removed or renamed, a type changed, a
  new required parameter, a changed default or behaviour, when the API can be called from outside
  this app: public; a token or key that can be had other than by logging into this same app (API
  keys, OAuth clients, personal tokens, autologin, service-to-service); a mobile or desktop app (old
  versions stay in use for months); an outgoing webhook. Unsure who can call it → ask.

Do not ask for a new table or index, a new nullable column or one with a default, or for an API only
this app's own frontend calls with a login-only token when that frontend changes in the same change.

**A rule in the project's rules** (CLAUDE.md, AGENTS.md) that settles the choice → no question: follow
it and name it in one line ("by the rule in CLAUDE.md: one release, no maintenance mode"), unless the
fool-proof check below applies. No rule → ask every time; a pick is for this change only, never offer
to save it. Only when the person says to make it a rule, write it into the project's rules.

**Every pick is written down** in one line where keel's reviewers look ("users.name → full_name: two
releases, the user's pick"): in planning, a Decision of the plan; in a task, a line in the task's
acceptance criteria (keel's reviewers get them); with no task file, in the criteria the verification
takes from the conversation. A pick against the warning is also written in more places (see the end).

## How to ask
Plain words first, on this change's own table, columns, endpoint and numbers from the repository
(rows in seeds or comments, traffic hints, the clients found), then each variant: what is built, how
the deploy goes step by step, what it costs, what can go wrong. Recommend one and say why; the person
picks, also a variant not offered. Then write migrations, code, commands and deploy steps for the
pick.

**Schema change** (example: rename `users.name` to `full_name`):
1. **Three releases** (expand → migrate → contract): add the new column and copy the data, code
   writes both; then code reads only the new one; then drop the old one. Fits when the app cannot stop
   even for a minute and several copies of it run at once.
2. **Two releases:** add the new column, copy the data, switch the code to it, keep the old column;
   drop it in a later change. A few seconds where an old copy of the app still writes the old column.
3. **One release with maintenance mode:** back up, switch the site to maintenance, one migration with
   the new code, switch back. Offer it only when the project has a maintenance mode (Laravel
   `php artisan down`, a maintenance page or middleware, a deploy-script step); without one, name it
   only as extra work to add first.
4. **One release, just apply the migration:** requests may fail while it runs; say how long that is
   likely to be for this table (an instant on a few thousand rows, minutes on millions).

**Undo and backup** (what to do if the release goes wrong):
- The project writes down migrations → recommend one here too; it may be skipped with a reason.
- It does not → recommend fixing forward with one more migration; offer a down migration anyway.
- The change destroys data → recommend a backup, whatever the project does about down migrations,
  because a down migration recreates an empty column and does not bring the data back:
  1. the project's own backup (a script, a package, the host's backups): the command to run before
     the deploy and how to restore, in the ticket or PR;
  2. an archive table written by the migration before the drop (`users_phone_archive` with the id and
     the value; restore is one `UPDATE`); say the space it takes, that personal data stays in it, and
     when to drop it; a down migration can restore from it;
  3. a one-off export (`pg_dump -t users`, a CSV export) run before the deploy, with the restore
     command, in the ticket or PR;
  4. nothing, when the data is truly not needed: say exactly what is lost ("`users.phone` in 340 rows,
     no way back").

**API change** (example: `GET /users` returns `fullName` instead of `name`):
1. Do not make the change.
2. A new version (`/v2`); the old one keeps working.
3. Return both fields for a while; remove the old one in a later change.
4. Deprecate with a date: in the code, the docs and the API itself (`Deprecation` and `Sunset`
   headers), then remove it on that date.
5. Change it at once and tell the clients: fits when every client is yours and updates together.

## Fool-proof check
When the pick, or the project's rule, hits one of these cases, ask a second time, even against a
rule:
1. data lost with no way back (no backup, no archive);
2. a rename that the tool generated as drop + add, so the data goes;
3. an irreversible data transformation (merging fields, rounding, hashing);
4. cascade deletes (`ON DELETE CASCADE`, `TRUNCATE ... CASCADE`) reaching rows in other tables;
5. a migration that fails on the existing data (`NOT NULL` without a default, `UNIQUE` over
   duplicates, a type cast some rows cannot take), stopping the deploy halfway;
6. an already applied migration edited instead of adding a new one;
7. a long lock on a large or busy table (an index without `CONCURRENTLY`, a type change that
   rewrites the table, `SET NOT NULL`);
8. one huge `UPDATE` or `DELETE` instead of batches;
9. a migration that runs longer than the deploy step is allowed to;
10. a multi-step schema change on MySQL, whose DDL is not transactional, so a failure leaves it half
    applied;
11. code that still uses what the change drops or renames;
12. new code that starts before its migration has run;
13. an API breaking for clients outside this app;
14. a silent change of meaning (units, currency, time zone, rounding): clients compute wrong without
    an error;
15. a changed shape of a webhook sent to others;
16. tighter access (a new role or scope) that turns working integrations into 403s;
17. money, stock or personal data involved raises the stakes of any case above (alone it is not a
    case: a rename on a table with personal data is not asked twice for that).

The second question says that the rule exists (if there is one) and why it must still ask, then in
detail and in plain words: what can break and in which cases, with this project's numbers; what to
check before the deploy; anything else critical. Options: the recommended variant, another variant,
"Do as I said, I accept all the risks". A second "as I said" → do it, and never ask a third time.
When the repository does not show the size or the clients, say "unknown" and only warn in one line.

**A pick made against the warning** is written down in one line ("one release despite the warning:
`orders` is locked for about 5-10 minutes"), so nobody reports it again as a finding: in the ticket
(planning), the commit body, the PR description, one comment at the risky spot in the code (the
migration or the handler), and the project's decision list only when it already keeps one.
