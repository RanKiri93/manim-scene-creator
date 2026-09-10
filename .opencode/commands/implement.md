---
description: Implement a planned handoff with its owner role (usage - /implement <slug-or-path>)
---
Implement the handoff for Manim Timeline.

Handoff: $ARGUMENTS
(If a bare slug was given, the file is `docs/handoffs/*-<slug>.md`; find it with `rg -l`.)

1. Read the handoff. If `status` is not `planned` or `implementing`, stop and say so.
   If "Open questions" is non-empty, stop and ask the user those questions.
2. Set `status: implementing` in the frontmatter.
3. Delegate the implementation to the subagent named in `owner_role` (one of @editor-dev,
   @codegen-dev, @server-dev, @copilot-dev) with the full handoff path and the instruction to stay
   within "Touched files". Wait for it.
4. When it reports done, confirm it invoked @verifier; if it did not, invoke @verifier yourself
   with the handoff path.
5. Summarise: verdict, files changed, and the next role (reviewers or docs-keeper).
