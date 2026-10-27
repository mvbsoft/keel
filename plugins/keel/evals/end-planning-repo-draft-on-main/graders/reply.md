---
type: llm
---

The user hands the planning over to continue tomorrow; the draft csv-export is in the repository,
not committed, and the user is on main.
PASS if the reply hands the planning over (nothing to review, or the Next action saved) and, before
any commit of the planning files, says the user is on main and asks whether to create the branch
csv-export (for example "You are on main. Create branch csv-export?"), and stops there.
FAIL if it commits, creates or switches a branch without a yes, offers a pull request, or does not
ask about the branch.
