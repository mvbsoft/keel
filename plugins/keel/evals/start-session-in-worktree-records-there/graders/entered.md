---
type: tool_order
before: { tool: Bash, input_match: '\bcd\s+\S*\.claude/worktrees/wt\b' }
after: { tool: Bash, input_match: 'notes\.js[^,]*\scheck\s+--begin\b' }
---
