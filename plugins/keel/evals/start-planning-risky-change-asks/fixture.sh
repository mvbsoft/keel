#!/usr/bin/env bash
# The shop project, variant "planning-db" (../_fixtures/shop.js): the database shop (users has about 2,000 rows) and a new draft notification-system that history.jsonl's conversation plans.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning-db
