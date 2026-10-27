# Contributing to keel

Thank you for helping. Bug reports, fixes and measured improvements are all welcome.

## Running the tests

```bash
npm test
```

Node 22 or newer, no dependencies. Tests that need git skip themselves when it is not installed.
`npm run test:docker` runs the suite in a container on the local `node:22-alpine` image, without
network. The image is never pulled by the script: run `docker pull node:22-alpine` once first, or set
`KEEL_TEST_IMAGE` to use another local image. That image has no git, so the git tests skip there.

Before a pull request, also run `claude plugin validate --strict plugins/keel` if you have the
Claude Code CLI (`claude plugin validate --strict .` checks the marketplace file).

## Behaviour evals

`plugins/keel/evals/` holds a regression suite for what tests cannot check: how the model follows
keel's instructions (the retell and the "new?" question, lanes, the end-task menu, the level question
before any review agent, a recorded verification before a task folder moves, the session note) and
the coding standards. 32 of the 33 cases build a small shop project with git (`evals/_fixtures/shop.js`;
`help-lists-every-command` needs none). Each case runs one keel command in Claude Code, or a plain
request for the two cases tagged `standards`; a case tagged `lanes` may also give a plain request or a
bare command (`/start-task`), which the lane guards must stop too. Each case grades the reply and the
tool calls. Every eval run is `claude -p`, where keel refuses `/keel:start-planning` without a person,
so the planning cases resume a short written conversation instead (`history.jsonl` in the case folder,
with the fixed session id the fixture marks as planning a feature or working on a task).

```bash
npm run eval
```

- **When:** before every release, and after changing a skill or a shared instruction file.
- **Cost:** every case runs on Sonnet (`model: sonnet` in each `prompt.md`). A full pass of the first 18
  cases, 3 runs per case, cost $6.70 at list price in October 2026, against your plan or API account. The script stops at $15 (`--max-cost-usd`). One case:
  `npm run eval -- --case <name> --runs 1`.
- **Where:** Linux, macOS or WSL2, with Claude Code's sandbox (`bubblewrap` and `socat` on Linux):
  the cases need the Bash tool, and on native Windows Claude Code refuses to grant it to an eval run.
  On any machine with Docker, use the development image in `tools/docker/` (Node, git, Claude Code
  and its sandbox):

  ```bash
  docker build -t keel-dev tools/docker
  docker run -it --rm -v keel-dev-home:/home/dev keel-dev claude auth login
  docker run -it --rm --security-opt seccomp=unconfined --security-opt apparmor=unconfined -v keel-dev-home:/home/dev -v "$PWD:/work" keel-dev npm run eval
  ```

  The first `run` signs Claude Code in once; the named volume keeps the login. The two
  `--security-opt` flags let the sandbox create its namespaces inside the container.
- **Not in CI by default**, because it costs money. To add it, run the same command in a job with
  `ANTHROPIC_API_KEY` as a secret, `--json results.json` and a `--threshold`, on a release tag only.
- Results go to `plugins/keel/evals/results/` (ignored by git).

## Rules for changes

- **A fix comes with a test that fails without it.** An existing test changes only when the
  behaviour it pins changes on purpose; say why in the pull request.
- **Docs change in the same pull request** as the behaviour they describe (README, skills, agents,
  CHANGELOG under `[Unreleased]`). `README.md` and every page in `docs/` have Ukrainian versions
  (`*.uk.md` next to them): you update the English pages only; the maintainer updates the Ukrainian
  ones before merging.
- **Code, comments, tests and docs are in English**, apart from the Ukrainian versions above.
  User-facing fixed texts go through the translation files (below).
- **No new npm dependencies** in the plugin; it runs on Node's standard library.
- Instruction texts (skills, agents, protocols) are loaded into every run and cost tokens: keep them
  short, and check that every script, flag and output line they name exists.
- Code comments state only the non-obvious why; no ticket, plan or step codes.

## Adding a language

keel's fixed texts (usage report, context warning, dashboard) live in two places:

1. copy `plugins/keel/locales/en.json` to `<code>.json` and translate the values. `tests/i18n.test.js`
   requires every English key, with the same placeholders, in each catalog;
2. for the dashboard: copy `plugins/keel/templates/usage/i18n.uk.js` to `i18n.<code>.js`, translate it,
   add the file to `PAGE_FILES` in `plugins/keel/scripts/usage-setup.js` and in
   `tests/usage-setup.test.js`, to the `files` map of the publish step in
   `plugins/keel/skills/_shared/configure-flow.md`, and a `<script>` tag in
   `plugins/keel/templates/usage/index.html`. The page itself chooses only between `en` and `uk` today
   (where it sets `lang` and the date locale in `index.html`), so a new page language also needs a
   change there.

At run time a key missing from a catalog falls back to English.

## Commits

Commit titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):
`type(scope): subject`.

- **Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci`, `chore`.
- **Scope** is optional: the part of keel you touch, such as `verify`, `configure`, `hooks`, `usage`
  or `git`.
- **Breaking change:** add `!` after the type or scope (`feat(configure)!: ...`) or a
  `BREAKING CHANGE:` footer.
- **Subject:** imperative mood, at most 72 characters. The body says why, not what the diff shows.
- **No AI attribution trailers** (no `Co-Authored-By` for a tool, no "generated with" lines).

Pull request titles follow the same format.

## Releasing

Versions follow [Semantic Versioning](https://semver.org/).

- **Major (breaking):** removing or renaming a command, skill, setting key or config field; changing
  a default so that behaviour changes; raising the minimum Node or Claude Code version.
- **Minor:** a new command, skill, agent, setting or config field that is off or harmless by default.
- **Patch:** fixes, performance, and docs or wording changes that do not change behaviour.

To release:

1. In `CHANGELOG.md`, move the `[Unreleased]` entries under `## [x.y.z] - YYYY-MM-DD` and update the
   links at the bottom.
2. Set `version` in `plugins/keel/.claude-plugin/plugin.json` and `metadata.version` in
   `.claude-plugin/marketplace.json` to `x.y.z`. Users get an update only when the version changes.
3. Run `npm test` (it checks that the two versions and the CHANGELOG heading agree), then
   `claude plugin validate --strict plugins/keel` and `claude plugin validate --strict .`.
4. Commit as `chore(release): vX.Y.Z`.
5. Tag it: `git tag -a vX.Y.Z -m "keel vX.Y.Z"`.
6. Push the commit and the tag. The release workflow runs the tests, checks the tag against
   `plugin.json`, and publishes the GitHub Release with the notes from CHANGELOG.md.
