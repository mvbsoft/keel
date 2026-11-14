#!/usr/bin/env bash
# The shop project, variant "adr-living-breach" (../_fixtures/shop.js): ADR style living; not committed: history marks in a record, a record that amends another, a deleted record still linked; keel's review rules copied into .keel/local/tmp/keel.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" adr-living-breach
