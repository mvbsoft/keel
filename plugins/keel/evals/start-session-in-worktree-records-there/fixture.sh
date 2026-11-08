#!/usr/bin/env bash
# The shop project, variant "worktree" (../_fixtures/shop.js), in the run's empty workspace: the session
# starts in the main checkout, so Claude Code names it as the project, and moves into the worktree.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" worktree
