# keel configure: instruction check (section 12, step 8; read from configure-flow.md)

The scan's `other instructions:` line ended with `audit: advise`. It is the last part of the summary,
after the commit step: a heading such as "Recommended: check your instructions" and these four points
as a list, each starting with its label (translated), never folded into one paragraph:
- **Why:** before keel this project (or this machine) already had its own instructions for Claude;
  name what the line lists ("CLAUDE.md, 120 lines; 4 rules; 6 skills in ~/.claude"). The more of
  them, the likelier two say opposite things (one rule "a doc comment on every function", another
  "small functions, no comments"): Claude then picks one arbitrarily and behaves differently from
  day to day. Outdated lines (a removed folder, an old command) also cost context in every
  conversation;
- **What it does:** Claude Code's own check `/doctor prompt-audit` reads the CLAUDE.md, AGENTS.md,
  rules, skills, commands and agents of this project and of `~/.claude` (not keel's rules: their
  conflicts with yours are the ones this setup raised), and lists contradictions, outdated
  instructions and references to missing files, each with a proposed edit. It changes nothing until
  you agree;
- **The effect:** one consistent set of instructions that Claude follows the same way every time,
  and fewer lines loaded into every conversation;
- **How:** type `/doctor prompt-audit` in a new conversation (`/clear` first); keel cannot start a
  Claude Code command for you. It runs on the current model. A report that is hard to read → ask
  Claude to retell it as a short list: what was, what it will become, why it was a problem.
