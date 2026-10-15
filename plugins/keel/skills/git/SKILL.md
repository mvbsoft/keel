---
name: git
description: Use when branching, committing, writing a commit message, comment or doc, or opening a PR. Small focused commits, clear messages, no AI attribution, no ticket or plan codes in code.
---

# Git and authorship

## Branches
- Follow the project's convention first. Without one, keel names a branch `<KEY>-<short-name>`
  (ticket key, then a few words), created from the main branch or the one the user names.
- Never commit straight to the main branch unless the project's convention allows it.
- Need isolation from work in progress → a git worktree in a git-ignored folder, removed after merge.

## Commits
- One logical change per commit; nothing unrelated mixed in.
- Message: what changed and why, in the author's voice. Follow the project's style (e.g. Conventional
  Commits `type(scope): summary`); subject in the imperative, about 72 characters at most.
- Before committing: run the project's gates (a keel hand off commits unfinished work with red gates
  on its task branch on purpose, and says so); check `git status` and the staged diff; never commit
  secrets, `.env` files, tokens or generated junk.
- Language of messages: `repo_language` in `.keel/config.json` (default English).

## Authorship
- Nothing written into the repository shows that an AI or tool produced it: no `Co-Authored-By` an
  AI, no "generated with", no tool signatures. Claude Code's `attribution` setting turns its own
  trailer off; keel's configure offers it.
- No ticket keys, plan, phase or step codes in code comments or docs; they become dangling
  references once the plan is gone. They belong in the PR description or the issue tracker.
- Code comments follow the project's comment level (`comments.level`, rules injected at session start).

## Push, merge, PR
- Who pushes and merges follows the git mode in `.keel/config.json` (manual: the user; autonomous:
  keel pushes, and merges only when the user's instruction asks, or on a finish when
  `ask_before_merge` is false; with `ask_before_merge: true` Claude Code confirms each merge).
- keel's own flows never force-push. By hand, when the user asks: `--force-with-lease`, never `--force`. A protected main branch or a rejected push → stop and
  propose a PR (`gh pr create`).
- A conflict → stop and show it; never resolve it by guessing.
