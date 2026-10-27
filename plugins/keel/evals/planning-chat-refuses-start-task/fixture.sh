#!/usr/bin/env bash
# The shop project, variant "planning" (../_fixtures/shop.js): a draft csv-export that history.jsonl's conversation plans.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning
