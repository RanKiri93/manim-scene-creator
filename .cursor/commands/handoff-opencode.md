# /handoff-opencode — checkpoint and pass a handoff to OpenCode

The text after this command names a handoff (slug or path) and an optional note. If it is a bare
slug, find `docs/handoffs/*-<slug>.md`.

1. Read the handoff. Under the section belonging to the current `status`, add a dated line
   `Handoff to OpenCode: <one sentence on where things stand and what to do next>` plus the note.
2. Set frontmatter `next_tool: opencode`.
3. If `status` is `implementing` or later, run the quick gates for the owner role's domain
   (`npm run build` and `npm run test` from `manim-timeline/`, or
   `pytest test_parser.py test_script_alignment.py` from the repo root). Record the result in the
   same dated line. Do not fix failures here; record them.
4. Stage the handoff file and only those files from its "Touched files" that appear in
   `git status` (leave all other WIP untouched) and commit:
   `Checkpoint: <slug> — <status> (→ opencode)`
5. Report the commit hash and the handoff path.
