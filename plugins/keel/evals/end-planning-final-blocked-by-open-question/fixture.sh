#!/usr/bin/env bash
# The shop project, variant "planning-openq" (../_fixtures/shop.js): a draft csv-export with one open question, planned by history.jsonl's conversation.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning-openq
