#!/usr/bin/env bash
# The shop project, variant "planning-brief" (../_fixtures/shop.js): the draft notification-system made from start-task's brief, which history.jsonl's conversation plans.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning-brief
