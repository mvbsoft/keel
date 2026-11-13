# keel configure: stack plugins (section 7; read from configure-flow.md)

The calling command gives you `<keel>` and `<project>`. The ground rules of
`<keel>/skills/_shared/configure-flow.md` hold (explain before you ask, one decision per question);
"section 12" below is that file's last section.

1. Run `node "<keel>/scripts/stack-skills.js" "<project>"`. It matches the project against keel's
   checked list and searches the marketplaces the user has added (never the Anthropic Directory: most
   of its 3,000+ entries are not about code, and it exists only with a claude.ai account).
2. Show, per plugin: what it is, why it helps here, the author, and what it runs or needs (an MCP
   server, a program, an account). Keep the groups apart: **checked by keel**; **marketplace not
   added** (a reputable marketplace keel knows; the user adds it with the printed command);
   **found in your marketplaces, not checked by keel** (drop any that clearly does not fit this
   project, saying why in a few words); **nothing reliable found** for a framework.
3. The user picks (multi-select; nothing is preselected). Also on "accept all" or "your
   recommendation": list the plugins by name, none marked recommended or preselected, and wait for
   the user's picks; this step is the exception to "recommended option first".
4. **A language server plugin (LSP):** explain it plainly: after every edit Claude sees type and
   compile errors at once, and finds definitions and callers exactly instead of by text search; the
   cost is a program to install (the command comes from the script). The program is installed
   together with the plugins, after the files are written; section 12 waits for it.
5. **Installing:** Claude Code refuses plugin installs that Claude runs, so give the user the commands
   to run in their own terminal, in order: `claude plugin marketplace add ...` first when needed, then
   `claude plugin install <plugin>@<marketplace> --scope project` per plugin. Project scope records the
   plugin in `.claude/settings.json`, but another machine does not fetch or offer it from there (Claude
   Code only reports it as enabled in project settings and not installed), so each developer runs the
   same commands; section 12 writes them into the project's docs. A plugin from a custom marketplace
   also needs `extraKnownMarketplaces` committed in `.claude/settings.json`. New plugins load in the
   next session.
6. **Nothing reliable for a framework** (for example Yii2): install nothing, say so, and offer to
   write a project skill from the project's own conventions later, as a separate task
   (`/keel:start-task`).
7. Store the picked plugin ids in `stack_skills`.
