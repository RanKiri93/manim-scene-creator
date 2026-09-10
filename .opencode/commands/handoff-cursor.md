---
description: Checkpoint a handoff and pass it to Cursor (usage - /handoff-cursor <slug-or-path> [note])
---
Hand the following handoff over to Cursor: $ARGUMENTS
(If a bare slug was given, the file is `docs/handoffs/*-<slug>.md`; find it with `rg -l`.)

Working tree:
!`git status --short`

1. Read the handoff. Under the section belonging to the current `status`, add a dated line
   `Handoff to Cursor: <one sentence on where things stand and what to do next>` plus the
   optional note from the arguments.
2. Set frontmatter `next_tool: cursor`.
3. If the status is `implementing` or later, run the quick gates for the owner role's domain
   (`npm run build` and `npm run test` from `manim-timeline/`, or
   `pytest test_parser.py test_script_alignment.py` from the root). Record the result in the same
   dated line. Do not attempt to fix failures; just record them.
4. Stage the handoff file and the files listed in its "Touched files" that appear in `git status`
   (never files outside that list; leave other WIP untouched), and commit:
   `Checkpoint: <slug> — <status> (→ cursor)`
5. Print the commit hash and the handoff path.
