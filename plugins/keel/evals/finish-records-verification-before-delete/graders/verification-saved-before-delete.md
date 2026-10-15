---
type: tool_order
before: { tool: Bash, input_match: 'fingerprint\.js[^,]*\ssave\s' }
after: { tool: Bash, input_match: 'notes\.js[^,]*\stask\s+delete\s' }
---
