---
description: Plan a task into docs/handoffs/<date>-<slug>.md (architect)
agent: architect
---
Plan the following task for Manim Timeline and write the handoff file.

Task: $ARGUMENTS

Current working tree (do not plan to revert any of these):
!`git status --short`

Today's date for the filename:
!`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`

Steps: read AGENTS.md and docs/handoffs/TEMPLATE.md; read the README section and existing tests
that cover this area; load the relevant skills; write the Plan section and frontmatter only;
print the handoff path and owner_role. If anything must be decided by the user, list it under
"Open questions" and stop.
