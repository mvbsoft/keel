#!/usr/bin/env bash
# The shop project, variant "adr-journal-breach" (../_fixtures/shop.js): ADR style journal; not committed: an accepted record edited, a partial supersede, a link to a superseded record; keel's review rules copied into .keel/local/tmp/keel.
set -euo pipefail
node "$(dirname "$0")/../_fixtures/shop.js" adr-journal-breach
