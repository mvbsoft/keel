---
name: feature-page
description: A private page of a planned feature in your claude.ai account - overview, tickets with their states, research; run again to update it. None named - the current branch's. --lang sets the language.
disable-model-invocation: true
argument-hint: "[<feature>] [--lang <code>]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/feature-page.js" *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/feature-page.js" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" report *), PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/usage.js" report *)
---

# keel: feature-page

- `<keel>` (the plugin folder): `${CLAUDE_PLUGIN_ROOT}`
- `<project>` (the project folder): `${CLAUDE_PROJECT_DIR}`
- `<sid>` (this session's id): `${CLAUDE_SESSION_ID}`
- Talk to the user in: the language in keel's session-start line (this project's own, else the machine's: ${user_config.conversation_language}; a language the user explicitly asks for in this session wins, for this session only)
- Arguments: `$ARGUMENTS` (empty: the feature of the current branch; else a feature name; `--lang <code>`: the page's language)

Current state of this project:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check-config.js" "${CLAUDE_PROJECT_DIR}" --profile`

The page is a snapshot of the feature's md files, which stay the source; keel writes it from a fixed
template and keeps nothing on this machine: it finds the page again in the account by its title.
Its language: `--lang`, else the language the page already has, else the conversation's. Texts in
another language than the tickets' are translated on the page only; the page keeps the translations,
so an update translates only what changed.

1. Read `<keel>/skills/_shared/preflight.md` and act on the state above.
2. The page is published with one of two tool sets; use the first you have:
   - **A**: the Artifact tool (`action: list`, `read`, publish);
   - **B**: the artifact server's tools `list_artifacts`, `read_artifact`, `get_artifact` and
     `publish_files` (their names may carry a prefix such as `mcp__claude-artifacts__`).
   Neither (a session that uses an API key has none) → one line: "No feature page here: pages are
   published only when Claude Code is signed in to a claude.ai account." Stop; nothing else runs.
3. Run `node "<keel>/scripts/feature-page.js" "<project>" [<feature>] [--lang <code>]`; here only its
   `title:`, `title if taken:` and `marker:` lines count.
   - `feature: none (<why>)` → say why in plain words. `features: none` → there is no planned feature
     here (`/keel:start-planning` plans one); stop. Else ask which feature (AskUserQuestion, from the
     `features:` list) and run again with it.
   - `feature-page: refused (<why>)` or `unavailable` → say why in plain words and stop.
4. Find the page. List your own pages: **A** `action: list`, mine, `limit` 200; **B**
   `list_artifacts`, `limit` 500, the entries marked mine. The candidates are the pages titled exactly
   `title`, then those titled exactly `title if taken`. Read a candidate into a file, never the whole
   page into the conversation:
   - **A**: `action: read`, its `url`, `path` "index.html"; the result says where the file is.
   - **B**: `read_artifact`, its slug, `offset` 1, `limit` 20: the page's first lines hold its marker,
     its language and its translations. Write those lines as they are (without the wrapper tag around
     them) to `<project>/.keel/local/tmp/feature-page/earlier.html`; that is the file.
   Then run `node "<keel>/scripts/feature-page.js" "<project>" peek "<that file>"` (`marker:` and
   `language:` of that page).
   - A `marker:` value in step 3 → read the candidates in that order and stop at the first whose
     `marker:` is the same: the page to update, its file the earlier page. None has it and a page titled
     `title` exists → another project has that title: the new page takes `--taken`.
   - `marker: none (<why>)` → one candidate: it is the page to update. Several → ask which (their
     links) or a new page.
   - No candidate and the listing may hold more pages than it shows (**A** `200 of <N>`; **B** 500
     entries) → ask: "I did not find the page among your latest ones. Give its link, or I make a new
     one." A link → read it the
     same way; its title is `title` or `title if taken` (and with a marker, the marker matches) →
     update it, else say why and make a new one.
   - No candidate otherwise → a new page.
5. Build it: `node "<keel>/scripts/feature-page.js" "<project>" [<feature>] [--lang <code>] [--previous "<the earlier page's file>"] [--taken]`.
   - `translate: <file> (...)` → Read that file and translate each text from `from` to `to`: the
     words only; markdown, line breaks, code blocks, inline code, paths, URLs, keys such as API-121
     and D1 stay as they are. Write `translated.json` beside it, `{ "<id>": "<translated text>" }`
     for every text, then run `node "<keel>/scripts/feature-page.js" "<project>" apply`. Refused →
     fix what it names and run apply again. Its `page:` line is the page.
   - Else its `page:` line is the page. `language:` says the page's language; labels in English
     there → say once that this language has no labels of its own yet.
6. Read the whole page file (a page is published only once read in full), then publish it:
   - **A**: the Artifact tool, `file_path` that file: an update with the page's `url`; a new page with
     `icon` "document" and `description` "Feature <feature>: its overview, tickets with their states,
     and research." An update refused for not reading the page first → publish the same file again.
   - **B**: `publish_files`, `files` `[{ "as": "index.html", "path": "<that file, absolute>" }]`. An
     update: first `get_artifact` of its slug, then `slug`, `base_version` its `version`, and
     `shared_live` its `read` when that is not `owner`. A new page: `title` the `page title:` line
     and `icon` "document". Refused for a newer version → `get_artifact` again and publish again.
   Then run `node "<keel>/scripts/feature-page.js" "<project>" clean`.
7. Tell the result in one or two lines: "Done: the page of feature <feature>, <n> tickets, as of
   commit <the `as of:` hashes>, in <language>." with the link, and whether it is new or updated.
   The page is private; its Share menu shares it.
8. Last, run `node "<keel>/scripts/usage.js" report --project "<project>" --session <sid> --last-turn --lang <the conversation language code>`
   and give its one line as it is, as the report's last line.
