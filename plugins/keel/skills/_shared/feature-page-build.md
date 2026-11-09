# keel: build and publish a feature page (/keel:feature-page)

The steps after the user's questions: build the page, translate it, publish it. They read the whole
page (a page is published only once read in full), so they run in one Sonnet agent: the page and
the translation stay in the agent and leave the session's conversation as one line.

**Start the page agent** (the calling session, `/keel:feature-page` step 5). No `Agent` tool → do
steps 1-4 yourself. Otherwise one `Agent` call, `subagent_type: "general-purpose"`, `model: "sonnet"`,
with this prompt, every `<...>` replaced by its value (the agent knows none of them):
"Read `<keel>/skills/_shared/feature-page-build.md` and do its steps 1-4 exactly, as the page agent,
with `<keel>` = <keel>, `<project>` = <project>, `<args>` = <the feature and `--lang <code>` the
command ran step 3 with, or none>, `<code>` = <the `code:` line>, `<url>` = <the page to update, or
new>. Reply in one line, as its step 4 says."
Wait for its reply.
- `published: ...` → the command's result step.
- `skip: no page tool in the agent`, or the agent cannot start (the `Agent` call is refused before
  any work) → do steps 1-4 yourself.
- `failed: not this feature's page (<its title>)` → say the link is not this feature's page (its
  title) and start the agent again with `<url>` = new.
- `failed: build: <why>` → say why in plain words: the command runs again once that is fixed.
- `failed: publish: ...`, any other `failed:`, an error after the agent started, no reply or another
  reply → say in one line that the page may not be published or up to date, with what failed in plain
  words, and that running the command again finishes it (it finds a page made by now by its code). Do
  not do the steps yourself: a page the agent made before it failed would be made twice.

1. **Page tool.** `Artifact` among your tools (deferred counts: load it with ToolSearch) → go on.
   None → reply `skip: no page tool in the agent` and stop.
2. **Build.** `<url>` is a page → read it into a file, never into the conversation: `action: read`, its
   `url`, `path` "index.html"; the result says where the file is (the earlier page: its language and
   translations). Its `<title>` must end with ` (<code>)</title>`: Grep the file for `<title>`, do
   not read the whole file here. Another title → reply
   `failed: not this feature's page (<its title>)` and stop: never publish over another page.
   Run `node "<keel>/scripts/feature-page.js" "<project>" <args> [--previous "<that file>"] --fetch`.
   `--fetch` fetches the remote first, so the tickets' states are fresh.
   - `feature-page: refused (<why>)` or `unavailable` → reply `failed: build: <why>` and stop.
   - `translate: <file> (...)` → Read that file and translate each text from `from` to `to`: the
     words only; markdown, line breaks, code blocks, inline code, paths, URLs, keys such as API-121
     and D1, and the Boundaries labels `always:`, `ask first:`, `never:` stay as they are. Write
     `translated.json` beside it, `{ "<id>": "<translated text>" }` for every text, then run
     `node "<keel>/scripts/feature-page.js" "<project>" apply`. Refused → fix what it names and run
     apply again. Its `page:` line is the page.
   - Else its `page:` line is the page. No `page:` line (`feature: none (...)` and the like) → reply
     `failed: build: <its first line>` and stop.
   Keep for the reply: the `title:`, `feature:` (its ticket count), `as of:` and `language:` lines,
   and a `fetch: <remote> failed (...)` line (the page is still built, its states as of the last fetch).
3. **Publish.** Read the whole page file and the `style.css` beside it, then publish both with the
   Artifact tool: `file_path` that file and `files` `{ "style.css": "<the style.css beside it>" }`.
   - An update: the page's `url`; its title is not the `title:` line any more (a new heading or
     repository) → it takes that title too (the tool's title, when it takes one). Refused for not
     reading the page first → publish the same files again.
   - A new page: `icon` "document" and `description` "Feature <feature>: its overview, tickets with
     their states, and research."
   Then run `node "<keel>/scripts/feature-page.js" "<project>" clean`, also after a failed publish;
   a failed publish then replies `failed: publish: <the tool's reason>` and stops.
4. **Reply** in one line, nothing else:
   `published: <link> <new|updated>; <n> tickets; as of <the as of hashes>; language <code>`, plus
   `; fetch failed: <its reason>` after a failed fetch, and `; no labels for <code>` when the
   `language:` line says its labels are in English.
