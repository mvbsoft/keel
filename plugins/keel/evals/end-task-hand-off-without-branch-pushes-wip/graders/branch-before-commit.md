---
type: tool_order
before: { tool: Bash, input_match: 'git-flow\.js[^,]*\sstart\s+--name\s+order-history-' }
after: { tool: Bash, input_match: 'git-flow\.js[^,]*\s(commit|save)\b' }
---
