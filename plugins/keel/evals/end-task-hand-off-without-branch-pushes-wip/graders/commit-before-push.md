---
type: tool_order
before: { tool: Bash, input_match: 'git-flow\.js[^,]*\scommit\b' }
after: { tool: Bash, input_match: 'git-flow\.js[^,]*\spush\b' }
---
