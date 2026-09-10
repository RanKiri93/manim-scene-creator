# /implement — run a planned handoff

The text after this command names a handoff (slug or path). If it is a bare slug, find
`docs/handoffs/*-<slug>.md`.

1. Read the handoff. If `status` is not `planned` or `implementing`, stop and say so. If
   "Open questions" is non-empty, stop and ask the user those questions.
2. Set `status: implementing`.
3. Delegate to the subagent named in `owner_role` (`editor-dev`, `codegen-dev`, `server-dev`, or
   `copilot-dev`) with the handoff path and the instruction to stay within "Touched files".
4. When it returns, delegate to `verifier` with the handoff path. If the plan asked for reviewers,
   launch `manim-reviewer` (background) and/or `ui-reviewer` in the same batch.
5. Append the verifier's (and reviewers') returned sections to the handoff and set `status`
   according to the verdict. If `fail`, resend the failures to the owner role once; if it fails
   again, stop and report to the user.
6. On `pass`, report: files changed, gate results, next step (`/docs` via `docs-keeper`, or the
   remaining review).
