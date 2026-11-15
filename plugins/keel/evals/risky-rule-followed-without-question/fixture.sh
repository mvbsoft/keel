#!/usr/bin/env bash
# The shop project, variant "db-rule" (../_fixtures/shop.js), in the run's empty workspace: CLAUDE.md says schema changes ship in one release; users has about 2,000 rows.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" db-rule
