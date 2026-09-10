---
slug: <kebab-case-slug>
created: <yyyy-mm-dd>
status: planned            # planned | implementing | verifying | reviewing | docs | done | blocked
owner_role: editor-dev     # editor-dev | codegen-dev | server-dev | copilot-dev
next_tool: any             # opencode | cursor | any
source: idea.md §N / user request / bug report
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
One paragraph. What the user will be able to do afterwards.

### Non-goals
What is explicitly out of scope, so implementers do not drift.

### Touched files
Bullet list with one line of intent each. Group by layer (`types/`, `lib/`, `codegen/`,
`store/`, UI, server, docs). Mark new files with `(new)`.

### Invariants at risk
Which existing guarantees this could break, and where they are enforced. Examples:
`sequentialAnimSecondsForLeaf` equals emitted seconds; `PROJECT_VERSION` migration chain;
canonical vs Gemini schema parity; `commit.ts` per-action `getState()`; `/health` liveness.

### Test plan
Exact commands and which tests must be added or extended (file + describe block).

### Open questions
Anything the implementer must ask the user before starting. Empty if none.

## Implementation notes (<owner_role>)

- What changed, per file.
- Deviations from the plan and why.
- Commands run and their result (paste short excerpts, not full logs).
- Anything left undone and why.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| … | … | pass / fail + one-line evidence |

- Out-of-scope changes found in the diff (files not in "Touched files"):
- Claims in "Implementation notes" that could not be confirmed:

Verdict: **pass** / **fail** (fail sends `status` back to `implementing`).

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
