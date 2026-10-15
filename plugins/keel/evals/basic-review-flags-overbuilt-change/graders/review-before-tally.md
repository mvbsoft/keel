---
type: tool_order
before: { tool: Agent }
after: { tool: Bash, input_match: 'votes\.js[^,]*\stally\b' }
---
