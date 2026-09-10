# /verify — independent verification of a handoff

The text after this command names a handoff (slug or path). If it is a bare slug, find
`docs/handoffs/*-<slug>.md`.

Delegate to the `verifier` subagent with the handoff path and current `git status --short`.
Append the returned "Verification" section to the handoff, update its `status` per the verdict,
and report the verdict and any failures verbatim to the user. Do not fix anything in this command.
