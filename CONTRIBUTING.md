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
keel's instructions (the retell and the "new?" question, lanes, the end-task menu, a task handoff without its own branch (a new branch, a work-in-progress commit, the push), a session in a git worktree of the project (keel records its start there), the level question
before any review agent, a recorded verification before a task folder moves, the session note, the
planning lane: end-planning's modes and gates, ticket states on start-task, a task that turns into
planning (also from a shared branch, main or a feature branch, where the half goes to a new branch before any commit; on main the rule against committing there also holds, so only the feature-branch cases fail without the shared-branch rule), a big plan run in a fresh conversation, the gathering, the levels and the package comparison in planning), the coding standards and risky changes (tagged `risky-change`: the ways to ship a change to a table with data or to a partner API, a project rule, the second question on a very risky pick, a pick written down, the same question in planning, and a review that respects the chosen way or asks for it when none was chosen; the shop's database variants in `evals/_fixtures/shop-db.js`), and the ADR styles (tagged `adr-style`: configure asks the style and says how the records are kept now, keeping them as they are when they follow neither style, a living record rewritten in place, and the docs review of a change that breaks each style; `evals/_fixtures/shop-adr.js`), and cleanup showing its list of leftovers in the reply before it asks which to move. 65 of the 66 cases build a small shop project with git (`evals/_fixtures/shop.js`;
`help-lists-every-command` needs none). Each case runs one keel command in Claude Code, or a plain
request for the cases tagged `standards`; a case tagged `lanes` may also give a plain request or a
bare command (`/start-task`), which the lane guards must stop too. Each case grades the reply and the
tool calls. Every eval run is `claude -p`, where keel refuses `/keel:start-planning` without a person,
so the planning cases resume a short written conversation instead (`history.jsonl` in the case folder,
with the fixed session id the fixture marks as planning a feature or working on a task). The seven cases
tagged `start-planning` resume `/keel:start-planning` as Claude Code expanded it, with keel at
`/work/plugins/keel` as the Docker command below mounts it, with the tool calls behind keel's first
reply, and give the person's next words; a test keeps the expanded steps and the file it read
(`skills/_shared/planning.md`) equal to the current ones: after a
change to any of them (or to the brief one of them reads, `evals/_fixtures/notification-system-brief.md`), run
`node plugins/keel/evals/_fixtures/start-planning-history.js` to write them again.

```bash
npm run eval
```

- **When:** before every release, and after changing a skill or a shared instruction file.
- **Cost:** every case runs on Sonnet (`model: sonnet` in each `prompt.md`). A full pass, 3 runs per case,
  cost about $11.50 at list price in October 2026, before the 11 `risky-change` cases; they add about
  $4.50, and the 5 `adr-style` cases about $2.50 (November 2026). The four cases a lane hook stops before the model cost nothing and run once. It runs
  against your plan or API account and stops at $30 (`--max-cost-usd`). One case:
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
  `--security-opt` flags let the sandbox create its namespaces inside the container. The image pins
  the Claude Code version (move it on purpose and run the evals after) and sets `TMPDIR` to
  `/scratch`: since Claude Code 2.1.316 the eval sandbox denies writes under `/tmp`, `/var/tmp`,
  `/dev/shm` and `/run/shm` but puts each run's temp folder under `TMPDIR`, so the run's shell
  commands fail and a skill that starts with a `!` line ends with 0 turns
  (anthropics/claude-code#104631). Keep `TMPDIR` outside those four folders. Rebuild the image after a change in `tools/docker/`.
- **Not in CI by default**, because it costs money. To add it, run the same command in a job with
  `ANTHROPIC_API_KEY` as a secret, `--json results.json` and a `--threshold`, on a release tag only.
- `start-planning-compares-packages` reads package registries on the web (WebFetch and WebSearch,
  granted by `npm run eval`); without network its reply has no data to compare.
- Results go to `plugins/keel/evals/results/` (ignored by git). A case that resumes `history.jsonl`
  also gets each run's transcript beside it (`<session id>.jsonl`, and a `<session id>/` folder
  when the run calls an agent; both ignored by git too).

## Rules for changes

- **A fix comes with a test that fails without it.** An existing test changes only when the
  behaviour it pins changes on purpose; say why in the pull request.
- **A test of an instruction text checks its key words, not its sentence**: `says(text, [keys])` from
  `tests/fixtures/texts.js` wants every key in one paragraph, list item or table row, so a rewording
  that keeps the rule keeps the test green. Keys include the words the rule hinges on (never, only, a
  number). What a script prints or parses (a command line, an output line) stays exact.
- **Docs change in the same pull request** as the behaviour they describe (README, skills, agents,
  CHANGELOG under `[Unreleased]`). Two documents exist in Ukrainian too. `README.md` has the copy
  `README.uk.md`, kept in step with the English one, which is the source: a change to `README.md`
  changes `README.uk.md` in the same pull request. The feature list is the pair
  `docs/features.uk.md` and `docs/features.md`: here the Ukrainian text is the source, the English
  one its translation, and a behaviour change that one of them describes updates both in the same
  pull request (`tests/features-doc.test.js` checks that the two have the same shape).
- **Code, comments, tests and all other docs are in English only**, `README.uk.md` and
  `docs/features.uk.md` apart.
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
   add the file to `PAGE_FILES` in `plugins/keel/scripts/usage-setup.js`, to the `files` map of the
   publish step in `plugins/keel/skills/_shared/usage-page.md` (`## Create`; the update reuses it), and
   a `<script>` tag in `plugins/keel/templates/usage/index.html`; `tests/usage-setup.test.js` reads
   `PAGE_FILES` from there and checks that all of these agree. The page itself chooses only between `en` and `uk` today
   (where it sets `lang` in `app.js` and the date locale in `format.js`), so a new page language
   also needs a change there.

At run time a key missing from a catalog falls back to English.

The usage code: the sync is `plugins/keel/scripts/usage.js` with `lib/usage-store.js`, the check against
the logs `lib/usage-audit.js`; the page itself is `plugins/keel/templates/usage/`. Their tests are
`tests/usage-cli.test.js`, `usage-page-sync.test.js`, `usage-clear.test.js`, `usage-pivot.test.js` and,
for the page's scripts and views, `usage-page-scripts.test.js`, `usage-page-app.test.js`,
`usage-page-analysis.test.js`, `usage-page-sessions.test.js`, `usage-menu.test.js` and `usage-calendar.test.js`. How the sync works: [usage dashboard](docs/usage-dashboard.md#syncing-between-machines).

Every page template (the usage page, the feature page) takes all its colours and fonts from
`plugins/keel/templates/design/keel.css`; a page's own `style.css` only lays things out. A style change
is made in `keel.css`, and `tests/design-system.test.js` checks it (no colour literal in a page, every
token defined, contrast of both themes). See [the design system](docs/design-system.md).

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
