# keel configure: plugins (section 11; read from configure-flow.md)

The calling command gives you `<keel>` and `<project>`. The ground rules of
`<keel>/skills/_shared/configure-flow.md` hold (explain before you ask, one decision per question);
"section 13" below is that file's last section. Section 12 (skills) runs after this one.

1. **Ask first, as one question, in quick and in detailed setup:** "Pick plugins for this project
   now?" yes (runs this step) / no (skips it). In plain words: keel looks at what the project uses
   and at the plugins already installed, and shows what fits; nothing is installed, disabled or
   removed without the user's yes; the scripts cost nothing and need no network. No → say that
   `/keel:configure plugins` runs it later, write nothing, and stop this step.
2. Run `node "<keel>/scripts/skills.js" "<project>" inventory`. It reads the project and what is
   installed, matches it against keel's checked list and the marketplaces the user has added (never
   the Anthropic Directory: most of its 3,000+ entries are not about code, and it exists only with a
   claude.ai account), and writes `.keel/local/tmp/skills-inventory.json` for section 12 to reuse.
   Without network it still works: it shows keel's checked list and the installed plugins.
3. Show, per plugin: what it is, why for you (the line of this project that is the signal; in a
   monorepo the part), the evidence (where the fact came from and the date), the risks (what it runs
   or needs: an MCP server, a program, an account, hooks) and the action. Keep the groups apart:
   - **installed plugins**, each with the action the script computed: **keep** (the project shows
     its signal), **disable here** (a user-scope plugin with no signal in this project; it stays on
     in the user's other projects), **remove** (installed for this project, no signal), **replace
     with `<id>`** (only when keel's checked list names a replacement) or **not evaluated**
     (keel has no data on it: show that it is there and what it runs, propose nothing). keel's own
     plugin, plugins from Anthropic's marketplaces, managed and built-in ones get no action;
   - **checked by keel**;
   - **marketplace not added** (a reputable marketplace keel knows; the user adds it with the
     printed command);
   - **found in your marketplaces, not checked by keel** (drop any that clearly does not fit this
     project, saying why in a few words);
   - **nothing reliable found** for a framework (see 9). A plugin the user declined at this version
     shows as `declined before at this version`: do not offer it again.
   Take the action from the script; never decide one yourself, and a fact the script could not read
   stays "not checked" and is never a reason.
4. The user decides by action, in separate questions of at most 4 options each, nothing preselected
   (install, keep, disable here, remove, replace: one question per kind that has entries; a longer
   list is split over several questions). Also on "accept all" or "your recommendation": list the
   plugins by name, none marked recommended or preselected, and wait for the user's picks; this step
   is the exception to "recommended option first".
5. **A language server plugin (LSP):** explain it plainly: after every edit Claude sees type and
   compile errors at once, and finds definitions and callers exactly instead of by text search; the
   cost is a program to install (the command comes from the script). The program is installed
   together with the plugins, after the files are written; section 13 waits for it.
6. **Installing:** Claude Code refuses plugin installs that Claude runs, so give the user the commands
   to run in their own terminal, in order: `claude plugin marketplace add ...` first when needed, then
   `claude plugin install <plugin>@<marketplace> --scope project` per plugin. Project scope records the
   plugin in `.claude/settings.json`, but another machine does not fetch or offer it from there (Claude
   Code only reports it as enabled in project settings and not installed), so each developer runs the
   same commands; section 13 writes them into the project's docs. A plugin from a custom marketplace
   also needs `extraKnownMarketplaces` committed in `.claude/settings.json`. New plugins load in the
   next session.
7. **Disable here:** only after the user's yes for that plugin, run
   `node "<keel>/scripts/skills.js" "<project>" disable "<plugin id>"` (the id in quotes: it holds an
   `@`). Claude Code shows the user its own approval prompt for this command; say so first. It writes
   `"enabledPlugins": {"<id>": false}` into `.claude/settings.local.json` of this project, keeps every
   other key and prints the file; the plugin stays on in the user's other projects. Say so, and that
   the file is personal and stays out of git.
8. **Remove:** give the user the command to run in their own terminal,
   `claude plugin uninstall <plugin>@<marketplace> --scope project`; the plugin goes whole (one of its
   skills cannot be taken out). keel deletes nothing.
9. **Nothing reliable for a framework** (for example Yii2): install nothing, say so, and offer to
   write a project skill from the project's own conventions later, as a separate task
   (`/keel:start-task`).
10. Never offer `disable` for keel's own, Anthropic-marketplace, managed or not-installed plugins;
    when the script refuses with its one-line reason, relay it as it is.
11. Store the picked plugin ids in `stack_skills`. A plugin the user declined is remembered by
    `node "<keel>/scripts/skills.js" "<project>" remember "<id>" --ref <version> --decision declined`
    (a personal choice, kept in `.keel/local/`, not in git; `<version>` is the one printed after
    ` | version` on the plugin's line); it is not offered again at the same version.
12. Keep the ids picked here for section 12: it runs the inventory again with `--picked "<id,id>"`,
    so a need they cover is not searched again.
