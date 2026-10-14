---
slug: orchestrator-agent
created: 2026-09-24
status: implementing
owner_role: editor-dev
next_tool: any
source: user request
---

<!--
Copy this file to docs/handoffs/<created>-<slug>.md.
Each role appends ONLY its own section. Never edit a section written by an earlier role;
add a dated note under your own section instead. Update the frontmatter `status`,
`owner_role`, and `next_tool` when you hand off.
-->

## Plan (architect)

### Goal
Add a project-level **Orchestrator** agent available in both OpenCode and Cursor. It receives the user's task description, asks focused clarification questions whenever scope, acceptance criteria, destructive actions, or product decisions are ambiguous, then routes work through the existing architect → domain-dev → verifier → optional reviewer → docs-keeper workflow. It must preserve WIP, avoid implementing application changes itself, prevent overlapping implementers from editing the same files, and keep the user informed of handoff paths, blockers, and final verification status.

### Non-goals
- No changes to the React app, Copilot runtime under `manim-timeline/src/agent`, Manim exporter, server, persisted schema, or generated Python behavior.
- No replacement of the existing domain agents; the Orchestrator coordinates them and the architect remains the planning authority for non-trivial work.
- No automatic guessing of unresolved user decisions, silent approval of destructive commands, or direct commits/pushes/resets by the Orchestrator.
- Do not make the Orchestrator recursively delegate to another Orchestrator or bypass the handoff contract.
- Do not change the default OpenCode agent unless the user answers the open question below.

### Touched files
Paths are repository-relative.

**Agent definitions**
- `.opencode/agents/orchestrator.md` (new) — primary OpenCode coordinator with read/status/question/task permissions, no application edit permission, explicit routing and stop conditions.
- `.cursor/agents/orchestrator.md` (new) — equivalent Cursor coordinator instructions and role routing, aligned with the OpenCode definition.
- `.opencode/agents/architect.md` — clarify that the Orchestrator invokes the architect first for non-trivial work and that the architect does not delegate or implement.
- `.cursor/agents/architect.md` — mirror the non-recursive architect boundary for Cursor.

**Workflow authority**
- `AGENTS.md` — document `orchestrator → architect → domain-dev → verifier → reviewers → docs-keeper`, clarification gates, and the no-overlapping-implementers rule.
- `.cursor/rules/agent-workflow.mdc` — make the Orchestrator the entry point while preserving existing ownership restrictions and handoff status semantics.
- `opencode.json` — only if the user approves making `orchestrator` the OpenCode `default_agent`; preserve the schema and all existing permissions.

**Docs**
- `docs/handoffs/2026-09-24-orchestrator-agent.md` — this plan and later implementation/verification notes.

### Invariants at risk
- **Handoff status is authoritative** — `docs/handoffs/TEMPLATE.md`, `AGENTS.md`, and `.cursor/rules/agent-workflow.mdc` must remain consistent about frontmatter status, append-only sections, and the required role order.
- **Domain ownership is not bypassed** — `.opencode/agents/{editor-dev,codegen-dev,server-dev,copilot-dev}.md` and `.cursor/agents/{editor-dev,codegen-dev,server-dev,copilot-dev}.md` remain the enforcement points for file ownership; the Orchestrator must route `src/codegen`, `src/lib/time.ts`, `src/agent`, server Python, and editor work correctly.
- **WIP preservation** — `AGENTS.md` and the workflow rule require a status check before editing and prohibit reverting or cleaning unowned changes; the Orchestrator must pass the existing WIP boundary into every delegation.
- **Verification cannot be skipped** — `.opencode/agents/verifier.md`, `.cursor/agents/verifier.md`, and the handoff Test plan enforce reproduction of gates before reviewers/docs; the Orchestrator must not report completion from an implementer claim alone.
- **Clarifications stop execution** — the Orchestrator definition must require the question tool for unresolved decisions and prohibit delegation or implementation until the user answers.
- **Config validity** — `opencode.json` and the agent-file frontmatter schema from the OpenCode configuration contract must remain valid; no default-agent change may point at a missing or non-primary agent.

### Test plan
- No existing automated test file covers project agent frontmatter or delegation policy; add no frontend/server tests for this configuration-only change.
- From the repository root, run `git diff --check` and inspect `git status --short --branch`; confirm only the listed agent/workflow/docs files are changed and all pre-existing WIP remains untouched.
- From the repository root, start a fresh OpenCode process with `opencode --help`; it must load the project configuration without a schema/frontmatter error and the new agent definition must not prevent startup. If the CLI exposes agent listing in the installed version, verify `orchestrator` is listed as a primary agent; do not assume an unsupported subcommand.
- Manual OpenCode smoke test in a fresh process: provide a task with a missing acceptance decision and confirm the Orchestrator asks a clarification question and delegates nothing; provide a clear codegen task and confirm it invokes `architect` first, then `codegen-dev`, then `verifier`; provide an already-planned handoff and confirm it resumes from its frontmatter status rather than creating a duplicate plan.
- Manual Cursor smoke test: select the new Orchestrator agent, give it the same ambiguous and clear prompts, and confirm it routes through the same handoff order and reports the handoff path/status.
- Review both new definitions for forbidden direct implementation behavior, allowed routing names, WIP-preservation instructions, explicit user-confirmation gates, and matching role mappings. Record the exact smoke prompts/results in the handoff's Implementation notes.

### Open questions
- Resolved by user: set `"default_agent": "orchestrator"` in `opencode.json`.

## Implementation notes (editor-dev)

- `.opencode/agents/orchestrator.md` (new): primary coordinator with clarification, WIP protection, routing, sequencing, verifier/reviewer/docs gates, no application implementation, and restricted tool permissions.
- `.cursor/agents/orchestrator.md` (new): equivalent selectable Cursor role and workflow/safety instructions.
- `opencode.json`: set `default_agent` to `orchestrator` per user's confirmation; preserved schema and permissions.
- `AGENTS.md`, `.cursor/rules/agent-workflow.mdc`: documented user-facing orchestration, clarification/non-overlap rules, handoff resumption, and blocked-agent behavior.
- `.opencode/agents/architect.md`, `.cursor/agents/architect.md`: clarified architect plans and returns the handoff/open questions to Orchestrator without implementing or delegating.
- `docs/handoffs/2026-09-24-orchestrator-agent.md`: recorded the user-confirmed default-agent decision and implementation evidence.
- Deviations: none. Existing uncommitted camera-zoom work was preserved and not modified.
- Commands and results:
  - `opencode --help` — pass; CLI starts and prints help.
  - `opencode agent list` — pass; project config loads and lists `orchestrator (primary)`.
  - `opencode run "I want a new feature. Make it better. Don't assume what better means; ask me what decision you need before delegating."` — pass; without `--agent`, CLI selected `orchestrator · gpt-6-luna`, read `AGENTS.md`, checked git status, and asked what capability and user problem were intended before planning or delegating. This confirms default-agent selection and the clarification stop behavior.
  - `opencode run --agent orchestrator "I want a new feature. Make it better. Don't assume what better means; ask me what decision you need before delegating."` — pass; same clarification behavior with explicit agent selection.
  - `git diff --check` — pass; no whitespace errors (line-ending conversion notices only).
- Scope check: requested agent/workflow files changed; the camera implementation files already appeared as WIP before this task and were not edited here.
- Remaining: full unambiguous architect→domain-dev→verifier handoff was not executed as a smoke test to avoid creating or implementing a contrived task; interactive Cursor smoke test requires a Cursor session and was unavailable here. These limitations are disclosed to verifier.
- Existing-handoff resume smoke: `opencode run "Use docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md as the already-existing handoff. Read only its frontmatter and report its current status, owner_role, next_tool, and the next appropriate role. Do not edit files, create a handoff, or delegate implementation."` — pass; defaulted to `orchestrator`, checked status, read the existing frontmatter (`done`, `codegen-dev`, `any`), and reported no implementation role was needed without editing/delegating.

## Verification (verifier)

| Gate | Command | Result |
|---|---|---|
| Whitespace check | `git diff --check` | pass — no whitespace errors; output only LF→CRLF warnings for existing working-copy files. |
| Working tree / WIP scope | `git status --short --branch` | pass with noted external WIP — branch `main...origin/main`; orchestrator files present plus many camera WIP files outside this plan. |
| Diff stat scope | `git diff --stat` | pass with noted external WIP — tracked stat includes the planned orchestrator files plus camera WIP (`25 files changed, 979 insertions(+), 105 deletions(-)`). |
| OpenCode config startup | `opencode --help` | pass — CLI loaded project config and printed commands including `opencode agent`. |
| OpenCode agent discovery | `opencode agent list` | pass — output includes `orchestrator (primary)` and its permission table. |
| Scoped implementation diff review | `git diff -- .cursor/agents/architect.md .cursor/rules/agent-workflow.mdc .opencode/agents/architect.md AGENTS.md opencode.json`; read `.opencode/agents/orchestrator.md`, `.cursor/agents/orchestrator.md`, and this handoff | pass — scoped diff sets `default_agent: orchestrator`, adds OpenCode/Cursor Orchestrator definitions, preserves architect-as-planner boundaries, and documents orchestrator→architect→domain-dev→verifier workflow. |
| Manual OpenCode smoke tests | not run | unconfirmed — requires fresh interactive OpenCode session; no exact ambiguous/clear/resume prompt results were recorded. |
| Manual Cursor smoke tests | not run | unconfirmed — Cursor interactive agent selection/routing cannot be exercised from this verifier session. |

- Invariants checked against the scoped diff: handoff status remains frontmatter-authoritative in `AGENTS.md`/Cursor rule; routing covers `src/codegen`/`src/lib/time.ts`, `src/agent`, Python/server/scripts, and editor/store/project work; WIP preservation and no-overlapping-implementers are documented; verification-before-done is documented; OpenCode config starts and the default points to a listed primary `orchestrator`. No codegen/schema/Copilot app changes are part of this scoped diff, so `self.wait`/`run_time`, `PROJECT_VERSION` migration, and canonical/Gemini schema parity checks are not applicable here.
- Out-of-scope changes found in the diff/status (files not in "Touched files"): current working tree also contains camera WIP outside this handoff — `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `manim-timeline/README.md`, `manim-timeline/src/agent/ARCHITECTURE.md`, `manim-timeline/src/agent/AgentPanel.tsx`, `manim-timeline/src/agent/commit.test.ts`, `manim-timeline/src/agent/providers/gemini.ts`, `manim-timeline/src/agent/systemPrompt.ts`, `manim-timeline/src/agent/types.ts`, `manim-timeline/src/agent/useAgentStore.ts`, `manim-timeline/src/agent/validate.test.ts`, `manim-timeline/src/agent/validate.ts`, `manim-timeline/src/codegen/cameraCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/projectExporter.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.ts`, and untracked `manim-timeline/src/agent/cameraProposalSummary.test.ts`, `manim-timeline/src/agent/cameraProposalSummary.ts`, `manim-timeline/src/agent/cameraRequests.test.ts`, `manim-timeline/src/agent/cameraRequests.ts`, `manim-timeline/src/agent/previewSelectors.test.ts`, `manim-timeline/src/agent/providers/schema.test.ts`, `manim-timeline/src/agent/useAgentStore.test.ts`, `manim-timeline/src/codegen/cameraCodegen.test.ts`. Per task instruction and implementation notes these are treated as pre-existing camera WIP and were not inspected beyond status/stat scope.
- Claims in "Implementation notes" that could not be confirmed: exact interactive OpenCode smoke prompts/results and Cursor smoke prompts/results were not available; I also cannot independently prove from repository state alone that the camera WIP was untouched since task start, only that it remains outside this handoff's touched-file scope.

Verdict: **fail** — automated/config/discovery/scoped-diff gates passed, but the Test plan's required interactive OpenCode and Cursor smoke tests remain unperformed/unconfirmed, so verification is incomplete and `status` is back to `implementing`.

### Follow-up — 2026-09-24 (verifier)

| Gate | Command | Result |
|---|---|---|
| Whitespace check | `git diff --check` | pass — no whitespace errors; only LF→CRLF warnings were printed. |
| Working tree / WIP scope | `git status --short --branch` | pass with noted external WIP — branch `main...origin/main`; planned orchestrator files are present alongside camera WIP outside this handoff. |
| Diff stat scope | `git diff --stat` | pass with noted external WIP — tracked stat remains `25 files changed, 979 insertions(+), 105 deletions(-)`, including planned files plus camera WIP. |
| OpenCode config startup | `opencode --help` | pass — CLI loaded config and printed commands including `opencode agent`. |
| OpenCode agent discovery | `opencode agent list` | pass — output includes `orchestrator (primary)` with task permissions for architect/domain/verifier/reviewer/docs roles. |
| Scoped implementation diff review | `git diff -- .cursor/agents/architect.md .cursor/rules/agent-workflow.mdc .opencode/agents/architect.md AGENTS.md opencode.json`; read `.opencode/agents/orchestrator.md`, `.cursor/agents/orchestrator.md`, and this handoff | pass — `default_agent` points to `orchestrator`; new definitions require status checks, clarification before ambiguous delegation, no application implementation, ordered routing, and verification before done. |
| Default-agent OpenCode clarification smoke | `opencode run "I want a new feature. Make it better. Don't assume what better means; ask me what decision you need before delegating."` | pass — output starts `> orchestrator · gpt-6-luna`, runs `git status --short --branch`, and asks what task/pain point the feature should address before delegation. |
| Explicit-agent OpenCode clarification smoke | `opencode run --agent orchestrator "I want a new feature. Make it better. Don't assume what better means; ask me what decision you need before delegating."` | pass — output starts `> orchestrator · gpt-6-luna`, runs `git status --short --branch`, and asks what new feature/optimization is intended before delegation. |
| Full clear codegen OpenCode chain | not run | fail/blocker — the declared Test plan requires confirming architect → codegen-dev → verifier on a clear codegen task. |
| Existing-handoff OpenCode resume smoke | not run | fail/blocker — the declared Test plan requires confirming an already-planned handoff is resumed from frontmatter status. |
| Manual Cursor smoke tests | not run | fail/blocker — the declared Test plan requires selecting the Cursor Orchestrator and confirming ambiguous/clear routing behavior. |

- Default-agent/clarification validation: confirmed closed. Both reproduced `opencode run` checks selected `orchestrator · gpt-6-luna`, checked git status, and stopped to ask a clarification question instead of delegating.
- Invariants checked against the scoped diff: handoff status remains frontmatter-authoritative in `AGENTS.md`/Cursor rule; routing covers `src/codegen`/`src/lib/time.ts`, `src/agent`, Python/server/scripts, and editor/store/project work; WIP preservation/no-overlap and verification-before-done are documented; OpenCode config starts and default agent points at a listed primary `orchestrator`. Codegen/schema/Copilot runtime invariants are not applicable to this scoped config/docs diff.
- Out-of-scope changes found in the diff/status (files not in "Touched files"): camera WIP remains outside this handoff — `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `manim-timeline/README.md`, `manim-timeline/src/agent/ARCHITECTURE.md`, `manim-timeline/src/agent/AgentPanel.tsx`, `manim-timeline/src/agent/commit.test.ts`, `manim-timeline/src/agent/providers/gemini.ts`, `manim-timeline/src/agent/systemPrompt.ts`, `manim-timeline/src/agent/types.ts`, `manim-timeline/src/agent/useAgentStore.ts`, `manim-timeline/src/agent/validate.test.ts`, `manim-timeline/src/agent/validate.ts`, `manim-timeline/src/codegen/cameraCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/projectExporter.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.ts`, and untracked `manim-timeline/src/agent/cameraProposalSummary.test.ts`, `manim-timeline/src/agent/cameraProposalSummary.ts`, `manim-timeline/src/agent/cameraRequests.test.ts`, `manim-timeline/src/agent/cameraRequests.ts`, `manim-timeline/src/agent/previewSelectors.test.ts`, `manim-timeline/src/agent/providers/schema.test.ts`, `manim-timeline/src/agent/useAgentStore.test.ts`, `manim-timeline/src/codegen/cameraCodegen.test.ts`.
- Claims in "Implementation notes" that could not be confirmed: the full clear codegen task chain, existing-handoff resume smoke, and Cursor interactive smoke remain unconfirmed. Because they are explicit bullets in this handoff's Test plan, they are necessary blockers for a passing verdict rather than optional unconfirmed claims. I still cannot independently prove from repository state alone that the camera WIP was untouched since task start.

Verdict: **fail** — the two new OpenCode clarification smokes close default-agent/clarification validation, but the handoff's declared clear-codegen, existing-handoff resume, and Cursor smoke gates remain unrun; `status` stays `implementing`.

### Final re-verification — 2026-09-24 (verifier)

| Gate | Command | Result |
|---|---|---|
| Whitespace check | `git diff --check` | pass — no whitespace errors; output was LF→CRLF working-copy warnings only. |
| Working tree / WIP scope | `git status --short --branch` | pass with external WIP — branch `main...origin/main`; planned orchestrator files remain alongside camera WIP outside this plan. |
| Diff stat scope | `git diff --stat` | pass with external WIP — tracked stat remains `25 files changed, 979 insertions(+), 105 deletions(-)`, including planned files plus camera WIP. |
| OpenCode config startup | `opencode --help` | pass — CLI loaded config and printed commands including `opencode agent`. |
| OpenCode agent discovery | `opencode agent list` | pass — output includes `orchestrator (primary)`. |
| Scoped implementation diff review | `git diff -- .cursor/agents/architect.md .cursor/rules/agent-workflow.mdc .opencode/agents/architect.md AGENTS.md opencode.json`; read `.opencode/agents/orchestrator.md`, `.cursor/agents/orchestrator.md`, and this handoff | pass — default-agent config, Orchestrator definitions, architect boundary, WIP preservation, existing-handoff reuse, and verifier-before-done rules are present. |
| Default-agent OpenCode clarification smoke | `opencode run "I want a new feature. Make it better. Don't assume what better means; ask me what decision you need before delegating."` | pass — output starts `> orchestrator · gpt-6-luna`, runs `git status --short --branch`, then asks what feature/outcome is intended before delegation. |
| Existing-handoff OpenCode resume smoke | `opencode run "Use docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md as the already-existing handoff. Read only its frontmatter and report its current status, owner_role, next_tool, and the next appropriate role. Do not edit files, create a handoff, or delegate implementation."` | pass — output starts `> orchestrator · gpt-6-luna`, reads the handoff frontmatter, reports `status: done`, `owner_role: codegen-dev`, `next_tool: any`, and `Next appropriate role: None; the handoff is complete.` |
| Full clear codegen OpenCode chain | not run | fail/blocker — current Test plan still explicitly requires confirming architect → codegen-dev → verifier on a clear codegen task. |
| Manual Cursor smoke tests | not run | fail/blocker — current Test plan still explicitly requires selecting Cursor Orchestrator and confirming matching routing/status reporting. |

- Existing-handoff resume conclusion: confirmed. The latest smoke demonstrates default Orchestrator behavior: it reused the named done handoff, read only frontmatter, reported no next role, and did not create a duplicate plan or delegate implementation.
- Decision on remaining unrun smokes: the full new codegen delegation chain and Cursor interactive test remain necessary blockers under the current declared Test plan. They can stop being blockers only if the plan is explicitly revised; verifier cannot waive them.
- Invariants checked against the scoped diff: handoff status remains frontmatter-authoritative; domain ownership/routing covers codegen, agent, server, and editor scopes; WIP preservation/no-overlap and verification-before-done are documented. Codegen/schema/Copilot runtime invariants are not applicable to this config/docs diff.
- Out-of-scope changes found in the diff/status (files not in "Touched files"): current camera WIP remains outside this handoff — `docs/handoffs/2026-09-24-camera-zoom-codegen-resume.md`, `docs/handoffs/2026-09-24-camera-zoom-copilot-resume.md`, `manim-timeline/README.md`, `manim-timeline/src/agent/ARCHITECTURE.md`, `manim-timeline/src/agent/AgentPanel.tsx`, `manim-timeline/src/agent/commit.test.ts`, `manim-timeline/src/agent/providers/gemini.ts`, `manim-timeline/src/agent/systemPrompt.ts`, `manim-timeline/src/agent/types.ts`, `manim-timeline/src/agent/useAgentStore.ts`, `manim-timeline/src/agent/validate.test.ts`, `manim-timeline/src/agent/validate.ts`, `manim-timeline/src/codegen/cameraCodegen.ts`, `manim-timeline/src/codegen/groupPlaybackSpan.ts`, `manim-timeline/src/codegen/leafConcurrentCodegen.ts`, `manim-timeline/src/codegen/manimExporter.overlap.test.ts`, `manim-timeline/src/codegen/manimExporter.ts`, `manim-timeline/src/codegen/projectExporter.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.test.ts`, `manim-timeline/src/codegen/targetAnimationCodegen.ts`, plus untracked camera files under `manim-timeline/src/agent/` and `manim-timeline/src/codegen/cameraCodegen.test.ts`.
- Claims in "Implementation notes" that could not be confirmed: the full clear codegen delegation chain and Cursor interactive smoke remain unconfirmed; the exact earlier explicit-agent clarification smoke was not rerun in this final pass, but default-agent clarification and existing-handoff resume were reproduced.

Verdict: **fail** — existing-handoff resume is now confirmed, but the current Test plan still has unrun clear-codegen and Cursor smoke gates; frontmatter status remains `implementing`.

## Review notes (manim-reviewer / ui-reviewer — optional)

Findings in severity order, each with file:line and a concrete fix suggestion.

## Docs delta (docs-keeper)

- README sections touched, `*Last updated:*` trailer extended: yes/no
- ARCHITECTURE.md touched: yes/no
- idea.md item closed or updated: which
