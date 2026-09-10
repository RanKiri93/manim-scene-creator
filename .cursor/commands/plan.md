# /plan — create a handoff plan

Delegate to the `architect` subagent with the task text that follows this command, plus:
`git status --short` output, today's date (for the filename), and the instruction to read
`AGENTS.md` and `docs/handoffs/TEMPLATE.md` first.

When it returns, show the user the handoff path, the `owner_role`, and any "Open questions"
verbatim. If there are open questions, stop and wait for answers; do not start implementing.
