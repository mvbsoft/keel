#!/usr/bin/env bash
# The shop project, variant "adr-living" (../_fixtures/shop.js): living ADRs in docs/adr, one per topic; 0002 is the Redis job queue.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" adr-living
