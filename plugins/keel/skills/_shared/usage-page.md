# keel usage: find, create or update this account's usage page

Used by `/keel:configure` (step 11) and `/keel:usage on`. The page "keel usage" is private, in the
user's claude.ai account; every machine of that account syncs to the same page (a second machine
joins the page the first one made). Nothing here runs in a session without claude.ai (an API key):
there the page cannot be reached, so say so and stop (see "Without claude.ai" below).

Run each command exactly as written (preflight.md). `<show>` is the output of
`node "<keel>/scripts/usage-setup.js" "<project>" show`.

## Which tools
The page is made and updated with the built-in `Artifact` and `ArtifactData` tools (deferred counts).
A session without them → say that this session has no page tools, that Anthropic decides per session
which tools a session gets, and that the next session with them can do this (`/keel:usage on`); stop.

## Find
`artifact_url` in `<show>` → that is the page; go to Update. Otherwise look for a page titled
"keel usage" among this account's own artifacts: `Artifact` `action: list`, mine, `limit` 200.
Found → save its URL (Save) and say it joined the page made on another machine. Several → ask which one (their links and dates), AskUserQuestion when you have it. None → offer to create it: "Create the page now? It is private; only you see it."

## Create (only after a yes)
Run `node "<keel>/scripts/usage-setup.js" "<project>" page` (it copies the page files to
`<project>/.keel/local/tmp/usage-page` and prints `page_template`). Then publish with the `Artifact` tool: `file_path` `<project>/.keel/local/tmp/usage-page/index.html`,
`files` `{ "style.css": ".../usage-page/style.css", "pivot.js": ".../usage-page/pivot.js", "i18n.js": ".../usage-page/i18n.js", "i18n.uk.js": ".../usage-page/i18n.uk.js", "format.js": ".../usage-page/format.js", "colors.js": ".../usage-page/colors.js", "load.js": ".../usage-page/load.js", "demo.js": ".../usage-page/demo.js" }`,
`title` "keel usage", `icon` "chart", `capabilities` `{ "db": {}, "user": {}, "downloads": true }`.
Then write the page settings with ArtifactData `set` to collection `meta`, doc `settings`,
`{ "language": "<conversation language code>", "schema": 1, "template": "<page_template printed by page>" }`.
Then Save, with `page_template` too.

## Update
`<show>` says `page template: ... | offer: update` → the page runs another keel's page, usually an older
one; its data stays whatever is done. Only after a yes. First say in one line that keel cannot see which keel version the page runs, so if
another machine of the account has a newer keel, this update puts an older page back: update keel on
every machine first. Then read the page with the `Artifact` tool (`action: read`, that `url`; the
tool publishes over a page only after a read, and it costs about $0.1-0.3). Its title is not "keel
usage", or the read says neither "owned by you" nor "writer" → stop and say why. Otherwise run
`node "<keel>/scripts/usage-setup.js" "<project>" page` and publish with the `Artifact` tool: that
`url`, the same `file_path` and `files` as in Create, no `title`, `icon` or `capabilities` (the page
keeps its own). Then ArtifactData `get` collection `meta`, doc `settings`, and `update` it with
`{ "template": "<page_template printed by page>" }`, `if_version` = the `version` the `get` returned
(no such document → `set` it, without `if_version`, with
`"language": "<conversation language code>", "schema": 1` too). Then Save `page_template`.

## Save
Write `{ "artifact_url": "<page url>" }` (plus `"page_template": "<printed value>"` after Create or
Update) to `<project>/.keel/local/tmp/usage-setup.json` and run
`node "<keel>/scripts/usage-setup.js" "<project>" apply "<project>/.keel/local/tmp/usage-setup.json"`.
The first sync happens at the next `/keel:end-task`, `/keel:end-session` or `/keel:end-planning`
and sends everything collected on this machine (the last 30 days of logs on a first sync).

## Without claude.ai
A session with an API key (or `claude -p` without claude.ai) has no access to the page: it lives in
the claude.ai account. Say that, that the costs are still collected on this machine and the report at
each `/keel:end-*` still shows them in exact dollars (without the share of the plan limits), and
that signing in to Claude Code with claude.ai makes the page reachable.
