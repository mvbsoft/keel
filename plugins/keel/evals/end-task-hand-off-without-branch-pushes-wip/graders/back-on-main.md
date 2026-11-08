---
type: tool_order
before: { tool: Bash, input_match: 'git-flow\.js[^,]*\spush\b' }
after: { tool: Bash, input_match: 'git-flow\.js[^,]*\sswitch\s+--name\s+main\b' }
---
