#!/usr/bin/env bash
# The shop project, variant "adr-journal" (../_fixtures/shop.js): docs profile 2, ADRs kept as a journal (0001 superseded by 0003), no ADR style chosen.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" adr-journal
