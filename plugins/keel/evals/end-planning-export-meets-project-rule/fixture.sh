#!/usr/bin/env bash
# The shop project, variant "planning-ready" (../_fixtures/shop.js), in the run's empty workspace.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" planning-ready
