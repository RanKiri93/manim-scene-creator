---
description: Run the verifier on a handoff (usage - /verify <slug-or-path>)
agent: verifier
subtask: true
---
Verify the handoff: $ARGUMENTS
(If a bare slug was given, the file is `docs/handoffs/*-<slug>.md`; find it with `rg -l`.)

Working tree right now:
!`git status --short`

Run exactly the gates in the handoff's Test plan, compare the diff against "Touched files",
check the "Invariants at risk", append the Verification section, update `status`, and report the
verdict.
