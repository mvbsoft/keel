#!/usr/bin/env bash
# The shop project, variant "task-active" (../_fixtures/shop.js): task CAN-123, worked on by history.jsonl's conversation.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" task-active
