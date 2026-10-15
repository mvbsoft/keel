#!/usr/bin/env bash
# The shop project, variant "messy" (../_fixtures/shop.js): src/auth.js and src/report.js work but invite tidying.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" messy
