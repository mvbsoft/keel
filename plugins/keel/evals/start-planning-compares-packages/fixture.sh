#!/usr/bin/env bash
# The shop project, variant "planning-new" (../_fixtures/shop.js): a new draft notification-system that history.jsonl's conversation plans.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning-new
