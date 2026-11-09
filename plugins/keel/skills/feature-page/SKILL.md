---
name: feature-page
description: A private page of a planned feature in your claude.ai account - overview, tickets with their states, research; run again to update it. None named - the current branch's. --lang sets the language.
disable-model-invocation: true
argument-hint: "[<feature>] [--lang <code>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/feature-page.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/feature-page.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" report *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" report *)
---

# keel: feature-page

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`; a keel script's `project: <folder>` line (this session works in a worktree of it) replaces it from then on
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (empty: the feature of the current branch; else a feature name; `--lang <code>`: the page's language)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

The page is a snapshot of the feature's md files, which stay the source; keel writes it from a fixed
template and keeps nothing on this machine: it finds the page again in the account by the feature's
code at the end of its title, the same from every machine and repository.
Its language: `--lang`, else the language the page already has, else the conversation's. Texts in
another language than the tickets' are translated on the page only; the page keeps the translations,
so an update translates only what changed.

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. The page is found with the Artifact tool here (`action: list`) and published with it by the page
   agent (step 5). No such tool (a
   session that uses an API key has none) → one line: "No feature page here: pages are
   published only when Claude Code is signed in to a claude.ai account." Stop; nothing else runs.
3. Run `node "<keel>/scripts/feature-page.js" "<project>" [<feature>] [--lang <code>]`; here only its
   `title:`, `code:` and `code written:` lines count.
   - `code written: <files> (...)` → the feature was exported before it had a code: keel gave it one and
     wrote it into those ticket files. After the result (step 6) say so in one line, naming the files:
     commit and push them, so every machine finds this page.
   - `feature: none (<why>)` → say why in plain words. `features: none` → there is no planned feature
     here (`/keel:start-planning` plans one); stop. Else ask which feature (AskUserQuestion, from the
     `features:` list) and run again with it.
   - `feature-page: refused (<why>)` or `unavailable` → say why in plain words and stop. Refused for
     paths of this machine: show the `- ` lines below it (file, path, line); they are fixed in those
     files, never on the page.
4. Find the page. List your own pages: `action: list`, mine, `limit` 200. This feature's page is the one whose title
   ends with ` (<code>)`, the `code:` line; the rest of its title may have changed.
   - One → the page to update (its `url`). Do not read it here: the page agent reads it.
   - Several → ask which to update (their links), or a new page.
   - None and the listing may hold more pages than it shows (`200 of <N>`) →
     ask: "I did not find the page among your latest ones. Give its link, or I make a new one." A link
     → the page to update: the page agent checks that its title ends with ` (<code>)` before it
     changes anything; another page → it says so and a new page is made.
   - None otherwise → a new page.
5. Build, translate and publish: read `<keel>/skills/_shared/feature-page-build.md` and follow its
   "Start the page agent", with the `code:` line and the page from step 4 (its `url`, or new). The page and its
   translation stay in a Sonnet agent; this conversation gets its one-line reply.
6. Tell the result from the reply's `published:` line in one or two lines: "Done: the page of feature
   <feature>, <n> tickets, as of commit <the as of hashes>, in <language>." with the link, and whether
   it is new or updated. `fetch failed: <reason>` → one more line: the fetch failed (its reason in
   plain words), so the ticket states are as of the last fetch; run the command again once the remote
   is reachable. `no labels for <code>` → say once that this language has no labels of its own yet.
   The page is private; its Share menu shares it.
7. Last, run `node "<keel>/scripts/usage.js" report --project "<project>" --session <sid> --last-turn --lang <the conversation language code>`
   and give its one line as it is, as the report's last line.
