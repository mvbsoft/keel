---
type: tool_order
before: { tool: Bash, input_match: 'npm test|node --test' }
after: { tool: Edit, input_match: 'src[\\/]auth\.js' }
---
