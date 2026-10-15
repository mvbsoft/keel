# Prints the CHANGELOG.md section whose heading starts with h (e.g. "## [1.0.0]") as release notes:
#   awk -v h="## [1.0.0]" -f tools/release-notes.awk CHANGELOG.md
# Link reference lines are dropped. A list item wrapped over several lines becomes one line, because
# GitHub release pages turn every newline into a line break.

function flush() {
  if (item != "") print item
  item = ""
}

index($0, h) == 1 { on = 1; next }
!on { next }
index($0, "## [") == 1 { exit }
/^\[[^]]+\]: / { next }
/^ *- / { flush(); item = $0; next }
item != "" && /^  / { sub(/^ +/, ""); item = item " " $0; next }
{ flush(); print }
END { flush() }
