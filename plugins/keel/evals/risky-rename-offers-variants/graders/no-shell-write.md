---
type: tool_used
tool: Bash
input_match: '"command"\s*:\s*"(?:[^"\\]|\\.)*?(?:>\s*\S*(?:db/migrations|src)/|sed\s+-i|perl\s+-\w*i|\b(?:tee|cp|mv)\b(?:[^"\\]|\\.)*?(?:db/migrations|src)/|(?:writeFileSync|appendFileSync|write_text)\(?(?:[^"\\]|\\.)*?(?:db/migrations|src)/|open\((?:[^"\\]|\\.)*?(?:db/migrations|src)/(?:[^"\\]|\\.)*?,\s*\\?["\x27][wa])'
min: 0
max: 0
---
