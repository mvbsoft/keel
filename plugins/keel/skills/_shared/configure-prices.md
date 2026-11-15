# keel configure: price update (section 11, step 6; read from configure-flow.md)

The calling command gives you `<keel>` and `<project>`. The user asked for `prices`, or said yes to the
offer in section 11 of `<keel>/skills/_shared/configure-flow.md`.

**Price update** (offer; about $0.1–0.3): start a `general-purpose` agent with `model: "sonnet"`:
"Find the current Claude API pricing page in the official docs (it was
platform.claude.com/docs/en/about-claude/pricing) and read it. Write
`<project>/.keel/local/tmp/prices-new.json` in the shape of `<keel>/data/prices.json`: `about`,
`source` (URL and date), `models` [{ `match` (model id prefix), `input`, `cache_write_5m`,
`cache_write_1h`, `cache_read`, `output` (USD per million tokens), `note` (other remarks) and, only
for a model the page charges more above a prompt size, `long_context`: { `over` (prompt tokens,
input plus cache), `mult` (price multiplier) } }] for every current and legacy model on the page.
Reply with the file path and any price you were unsure of." Then run
`node "<keel>/scripts/usage-setup.js" "<project>" prices-diff "<project>/.keel/local/tmp/prices-new.json"`,
show the changes and the `check:` lines, and after a yes run
`node "<keel>/scripts/usage-setup.js" "<project>" prices-apply "<project>/.keel/local/tmp/prices-new.json"`.
