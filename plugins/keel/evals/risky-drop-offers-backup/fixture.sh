#!/usr/bin/env bash
# The shop project, variant "db" (../_fixtures/shop.js), in the run's empty workspace: users has about 2,000 rows with a phone column, migrations run forward only.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" db
