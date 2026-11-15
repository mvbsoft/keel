#!/usr/bin/env bash
# The shop project, variant "adr-mixed" (../_fixtures/shop.js): docs profile 2, ADRs kept neither way (0003 amends part of 0002, a correction note in 0001), no ADR style chosen.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" adr-mixed
