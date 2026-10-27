# Security

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on
[mvbsoft/keel](https://github.com/mvbsoft/keel/security/advisories/new). Do not open a public issue.
The maintainer will answer there.

## What keel can do on your machine

keel runs hooks and Node scripts with your user's rights inside Claude Code. In short:

- **Where.** keel works only in projects set up with `/keel:configure` (they have `.keel/config.json`).
  Elsewhere its hooks add nothing to the conversation and Claude cannot use keel's skills or agents;
  the wallet record, the status line and the hook for keel's own files still run.
- **Commands without a prompt.** keel's own scripts run without a permission prompt only as one plain
  command on the current project's exact absolute path. Any other form that runs a keel script is
  refused or left to your normal permissions. Steps that change your Claude Code settings, move files
  in a migration or set up usage always go through your normal permissions.
- **Confirmations keel forces.** Moving a task folder to keel's trash, deleting a task branch,
  emptying the trash, confirming autonomous git, committing and pushing planning files, and merging
  get Claude Code's own confirmation, even when your allow rules would let them run (a merge runs
  without one only in autonomous mode you confirmed on this machine, with `git.ask_before_merge` off).
  In a non-interactive run these steps are denied.
- **Git.** In manual mode keel runs no git step nobody asked for; the branch you choose at a task's
  start and your own git instructions are run. Autonomous git runs without a prompt only after you
  confirm it on this machine; it never force-pushes, and a push from the main branch is left to your
  normal permissions (keel's own push step refuses it; only a merge publishes the main branch).
- **Secrets.** Secret files (`.env`, keys, certificates, credential files) are listed by path only:
  left out of the diff agents get and never committed by keel's git script. Agents are instructed not
  to open them; no hook enforces that.
- **Data that leaves the machine.** Usage data goes only to the usage page you set up (your private
  page, or a team page you approved). Besides that, keel's git steps talk to your remote (autonomous
  mode, or a step you ask for), a task link you give is read with a connector, `gh` or a web fetch, setup lists
  the plugins of the marketplaces you added, and a price update you ask for reads the official pricing
  page.

The details, rule by rule: [under the hood: safety](docs/under-the-hood.md#safety), and
[how keel behaves](docs/behavior.md) for the confirmations. What goes to the usage page:
[what goes to the page, and what never does](docs/usage-dashboard.md#what-goes-to-the-page-and-what-never-does).
