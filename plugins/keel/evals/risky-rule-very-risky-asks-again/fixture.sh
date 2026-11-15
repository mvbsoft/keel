#!/usr/bin/env bash
# The shop project, variant "db-big" (../_fixtures/shop.js), in the run's empty workspace: CLAUDE.md says one release; orders has about 3.5 million rows, busy all day.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" db-big
