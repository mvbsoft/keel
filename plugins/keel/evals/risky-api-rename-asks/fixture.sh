#!/usr/bin/env bash
# The shop project, variant "db" (../_fixtures/shop.js), in the run's empty workspace: GET /api/orders is called by partners with API keys issued on the admin page.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" db
