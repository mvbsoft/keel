#!/usr/bin/env bash
# The shop project, variant "ticket-on-feature" (../_fixtures/shop.js), in the run's empty workspace.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" ticket-on-feature
