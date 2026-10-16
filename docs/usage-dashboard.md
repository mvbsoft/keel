# Cost report and the "keel usage" page

[Українська](usage-dashboard.uk.md)

keel shows what a session cost at the end of every `/keel:end-task` and `/keel:end-session`. It can also
collect the numbers of all your machines into one private page, "keel usage", in your own claude.ai
account. On a subscription it estimates how many percent of your plan limits a session used. Everything is
read from Claude Code's own local logs, so collecting the numbers costs nothing; only writing them to the
page costs a little (see [syncing](#syncing-between-machines)). This page explains the report,
the page, where the data comes from, what leaves your machine and what never does. On this page a
*session* is one Claude Code conversation, as the dashboard calls it, not keel's long-work lane.

## The cost report

The cost report is the last block of the final report at the end of a task or a session (the whole
report: [two ways of working](workflows.md#the-final-report)). It is a table of every participant that
actually ran: the main conversation and each agent run, with its model, requests, tokens by kind (input,
cache write, cache read, output) and dollars at list price with the share of the total, then a total
row. Below that: total time and active time, the number of your turns, and the three most expensive
turns, each with its dollars, requests and agents.

Example (shortened; the numbers are made up):

usage report: session 3f9a1c2e (shop, cli), wallet subscription

| who | requests | in | cache write | cache read | out | $ |
|---|---|---|---|---|---|---|
| main (claude-sonnet-5-5) | 212 | 40 | 310k | 5.20M | 61k | $1.91 (61 %) |
| agent keel:reviewer (claude-sonnet-5-5) | 9 | 14 | 60k | 300k | 7k | $0.25 (8 %) |
| agent keel:bug-hunter (claude-sonnet-5-5) | 14 | 22 | 90k | 610k | 12k | $0.41 (13 %) |
| agent keel:qa (claude-sonnet-5-5) | 25 | 30 | 120k | 900k | 15k | $0.54 (17 %) |
| **total** | 260 | 106 | 580k | 7.01M | 95k | **$3.10** |

```
time: 1 h 05 min, active 38 min
user turns: 6
top turns by cost:
1. $0.84 (40 requests, 3 agents) "/keel:end-task finish"
subscription: dollars are list prices, they count against the plan limits
week: about 0.2 % of the weekly limit (1 % = about $17.40, 4 points)
5-hour: about 1.1 % of the 5-hour limit (1 % = about $2.90, 2 points)
```

Other lines can appear: output estimated from visible text (hidden reasoning is not counted); on a
subscription, how the account's limits moved during the session (`account week limit during the session:
12 → 14 %`, and the same for the 5-hour limit) and which machines the calibration waits for
(`calibration waits for the sync of: ...`); a model without a price (run `/keel:configure prices`); and a
cross-check against Claude Code's own total when the two differ by more than 10 %.

## Wallets

keel's hook marks how each session pays when it starts: `api` when an API key or token
(`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`), Bedrock, Vertex, Foundry or Mantle, or an `apiKeyHelper`
is in use; `cloud_wallet` for Claude Code on the web; otherwise `subscription`. A session keel did not
mark gets the machine's `wallet_default`, or `unknown` on a machine marked "both".

| Wallet | When | What the report shows |
|---|---|---|
| subscription | Pro, Max or Team | list-price dollars, and about how many percent of the weekly and 5-hour limits |
| api | an API key or token, an API-key helper, or Bedrock, Vertex, Foundry or Mantle | real money at API prices, no percentages |
| credit | Claude Code on the web (default for it), or a separate prepaid credit | real money, no percentages |
| unknown | a session started without keel's hook, on a machine marked "both" | no percentages; left out of the calibration |

Set the machine's defaults in `/keel:configure usage`: `wallet_default` (for sessions keel did not
mark), `cloud_wallet` (how Claude Code on the web pays) and `also_api` (the machine uses both a
subscription and an API key). See [settings](settings.md#this-machine).

## Plan-limit percentages and calibration

Claude Code gives the plan-limit percentages only to the status line. keel's status line (or yours,
wrapped so it prints exactly as before) records them each time they change. The desktop app has no status
line, so there keel asks the app for the percentages at the end of a task. The status line is installed
by `/keel:configure`.

keel learns the price of one percent from your own usage:

1. A **point** is the window between two recordings in one reset period, with the subscription
   dollars spent in it divided by the percent gained. The dollars are this machine's requests in the
   window plus the hourly totals of the other machines that count (step 5), each hour taken in the part
   that falls inside the window. Sessions that pay with an API key, credit or an unknown wallet do not
   count. A weekly point needs a gain of at least 1 percentage point, a 5-hour point at least 5.
2. The **rate** is the median of the points kept among the last 20 usable ones (step 3).
3. Points are **set aside** when they cannot be trusted: no spend in the window; a rate more than 30 %
   below the median (spend that keel could not see, for example chat on a phone: shown as "another device
   used the plan" on the page and "other device (spend not seen here)" in keel's text output); older than the last 20; or a machine has not synced yet ("waiting for sync").
4. A machine not seen for more than 14 days is no longer waited for, so it cannot block the calibration
   forever.
5. Limits belong to one account, so keel counts only the machines of the same user: those with the
   same git email as this machine, and machines with no git email. When this machine has no git email
   itself, every machine counts.

Until there are measurements, the report says "no calibration yet" and shows no invented number. The
session's share is its dollars divided by the rate.

## The "keel usage" page

`/keel:configure usage` can create the page (it asks first). It is private: only you see it, unless you
share it. `/keel:usage` gives its link and opens it. Its tabs follow. The screenshots show sample data, not real numbers.

### Dashboard

![Dashboard tab with sample data](images/usage-dash.png)

*Sample data.* A period selector (7, 30, 90 days or custom). Tiles: this week (percent of the weekly
limit, dollars, reset time), the forecast at reset (information only), the 5-hour limit now, and the plan
limit rate (1 % in dollars, median of n points). Charts: daily spend by model, the weekly limit over time
with the forecast, main conversation versus agents, token kinds and top projects, and spend by user when
the period has more than one user. If no session in the period pays from a subscription (all pay with an
API key or credit, or their wallet is unknown), the plan tiles and the weekly chart are replaced by the
dollars spent, a tile for each of up to 3 users and the spend by user. Dollars and charts count keel
sessions only; the limit percentages are those of your whole account, as Claude Code counts them.

### Analysis

![Analysis tab with sample data](images/usage-analysis.png)

*Sample data.* Filter by date range, PC, user, project, wallet, participant and model. Group by day, week,
project, PC, user, participant, model or hour of day; color by model, PC, project or participant; measure
dollars, tokens (all or by kind), time, requests, your turns or sessions. Click a bar or a row to see its
sessions. Below the chart are totals, and "More": cache share of input, dollars per hour, dollars per
turn, average session, agents launched and tool calls.

On the Dashboard and Analysis tabs a participant that used several models (for example after a
`/model` switch) counts once per model, with that model's dollars, tokens and requests, so spend by
model stays right.

### Sessions

![Sessions tab with sample data](images/usage-sessions.png)

*Sample data.* Every keel session: date, PC, project, task, models, dollars, percent of the week and the
verification level. Search by project, task, prompt text or branch; filter by PC, project and wallet;
group by project, PC or day; export to CSV.

### A session page

Click a session to open it. It shows the cost, duration and active time, the share of the week and of the
5-hour limit, turns and requests, and tokens with the cache share. Below: a timeline of the participants,
a table per participant (model, requests, tokens, active time, dollars, share), the cost of each of your
turns (with the start of the prompt when previews are on), the tools used, the keel verification (level,
findings must/should/nice, gates, lines, files, plan steps) and the cache.

### Calibration

![Calibration tab with sample data](images/usage-calib.png)

*Sample data.* The weekly and 5-hour medians, every point with its window, gain, dollars, rate and status
(kept, dropped or waiting for sync, with the reason), and the machines with their last sync and whether
the calibration waits for them.

An empty page says that data arrives after the first `/keel:end-task` or `/keel:end-session` on any
machine. Adding `?demo=1` to the page address shows sample data for a layout check, but only when the page
is opened without its data connection (outside claude.ai).

## Where the data comes from

keel reads Claude Code's local logs (the transcripts under `~/.claude/projects`). Nothing is measured by
the model. On each machine keel keeps its own files in `~/.claude/keel/`: session wallets, limit
snapshots, a summary cache, sync state and settings.

## What goes to the page, and what never does

Per machine and day, the page receives the following. The hourly totals count every Claude Code session
on the machine, in all its projects, because the plan limits count them all and the calibration needs
them; they hold no session id, project or request text. Everything per session goes only for keel
sessions: a session in which you ran `/keel:start-task`, `/keel:end-task`, `/keel:start-session` or
`/keel:end-session`. A conversation without keel shows up only in the hourly totals.

- the machine name, your git email (to tell machines and people apart) and the machine's
  `wallet_default`;
- per hour: dollars, requests and tokens by model and wallet;
- the plan-limit percentages with their reset times (and the spend limit when Claude Code gives one),
  and Claude Code's own cost of the session that recorded them;
- per session: its id, the project folder's name (never the full path), the git branch, the wallet,
  the entry point (for example cli), start and end time, active minutes, dollars and Claude Code's own
  cost; per participant (the main conversation or an agent, with the agent's type) its models,
  requests, tokens, dollars, active minutes, and tool names and counts; per turn of yours its time,
  dollars, requests and agents; keel's task data (level, findings, gates, lines and files changed, the
  model of each plan step);
- the first 100 characters of each of your requests, and the task and step titles. In the requests keel
  masks what looks like a secret: JSON web tokens, API keys and tokens in well-known formats (`sk-...`,
  GitHub, GitLab, npm, Stripe, Google, AWS access key ids, Slack), `Bearer` tokens, the user and password
  in a URL, the value after `password`, `token`, `secret` or `api_key`, and long hex or base64 strings.
  The masking works by patterns and is best effort: a secret in another form can get through. Task and
  step titles are sent as written.

Nothing else leaves the machine: not the full project path, and not your code, replies or file
contents. The page is visible only to you unless you share it; a team page (below) is visible to everyone it is
shared with.

**Turn the previews off** if your requests are sensitive: set `prompt_preview` to false in
`/keel:configure usage` (for every project on the machine), or for one project in
`.keel/local/options.json` (see [settings](settings.md#examples)). Then no request text and no task
title are sent, and step titles are replaced by "step 1", "step 2". Everything else above is still sent.
A project can only turn previews off: when the machine's value is off, a project's `true` has no effect.

## Syncing between machines

Each end step (`/keel:end-task`, `/keel:end-session`) prepares only the day documents that changed since
the last sync and writes them to the page through files, never through the conversation. It costs about
$0.01-0.04 (an estimate). The first sync reaches back 30 days (`history_days`). A session that cannot write to the page
(for example, an API-key session without the page tool) leaves the backlog for the next one that can.
Then keel reads the other machines' data back to calibrate the limits.

A team can share one page: put its address in the project config as `usage.artifact_url`. Each machine
sends to it only after its user approves that address, so a cloned repository cannot choose where your
usage goes. Once approved, the team page receives this machine's usage from **all** its projects, not only
from this one: project folder names, branches and request previews (unless previews are off), as listed
above. A machine's own `artifact_url` always wins: a machine that has one keeps sending there.

## Prices

Dollars are list prices from a table that ships with keel. Run `/keel:configure prices` to refresh it:
an agent reads the official pricing page (about $0.1-0.3, an estimate), keel shows the differences and writes the
table to this machine only after your yes (the previous one is kept as a backup).

## Related

[Cost optimization](cost-optimization.md), [settings](settings.md), [verification](verification.md).
