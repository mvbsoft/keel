# keel configure: moving from another system (section 9; read from configure-flow.md)

The calling command gives you `<keel>` and `<project>`. `migrate.js find` found another system (its
output is in the conversation; "section 12" below is the last section of
`<keel>/skills/_shared/configure-flow.md`).

Explain in plain words: two systems would give conflicting instructions (two notes, two memories), so
keel offers to move the old notes, memory and logs into `.keel/`; project data and secrets stay. Ask:
move now (recommended) / later (`/keel:configure migration`) / never (the old system stays); the user
who ran `/keel:configure migration` has already chosen "now", so do not ask. On "move now"
read `<keel>/skills/_shared/migrate.md` and follow it; its config proposals are compared with the
answers already given (an answer changes only on a yes), and its git step waits for section 12.
