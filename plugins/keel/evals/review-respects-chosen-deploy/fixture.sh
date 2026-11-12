#!/usr/bin/env bash
# The shop project, variant "db-renamed" (../_fixtures/shop.js), in the run's empty workspace: CLAUDE.md says one release; not committed: users.name renamed in one migration; keel's protocols copied into .keel/local/tmp/keel.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" db-renamed
