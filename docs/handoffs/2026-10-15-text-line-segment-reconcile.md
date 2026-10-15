---
slug: text-line-segment-reconcile
created: 2026-10-15
status: done
owner_role: docs-keeper
next_tool: any
source: user request (text-object rethink, step 3 of 4; steps 1-2 = 2026-10-15-text-line-*)
---

## Plan (architect)

### Goal

Editing a text line's source keeps each segment's settings (colour, bold, italic, anim time,
wait) attached to its text, and every reference to the line's segments elsewhere in the scene
(blink and target-animation rows, surrounding rectangle, `next_to` alignment, transform pairs)
follows its segment. Today settings are kept only when a segment's text and position are both
unchanged, and references silently retarget after an insert, delete or typo fix.

### Decision (user, 2026-10-15)

"Remap on edit" instead of persisted segment ids: same visible behaviour, no schema change, no
migration, codegen and Copilot keep using `line[i]` indices.

### Design

- `src/lib/segmentReconcile.ts` (new, pure): `matchSegments(old, new)` → old index → new
  indices. Rules, in order: unchanged text (LCS on text + math flag; language ignored, so
  wrapping in `\en{}` keeps settings); inside each gap between unchanged anchors: (a) same text
  with different `||` boundaries (split, merge, moved boundary) → align by character position;
  (b) same count and math/text pattern → one to one; (c) otherwise edit-distance similarity
  ≥ 0.4, order kept. `reconcileSegmentStyles` builds the new `SegmentStyle[]` (split pieces all
  take the style, the wait goes after the last piece, explicit anim time is shared by length)
  and the remap.
- `src/lib/remapSegmentRefs.ts` (new): `remapSegmentRefsInPlace(item, remap)`. Index lists
  cover every piece of a split segment; single indices (`next_to`) take the first piece;
  references to removed segments fall back to the whole line (`null`); math child refinements
  are dropped when their math segment changed or split; transform pairs remap keys on the
  target line and values on the source line.
- Store: `setTextLineSource(id, raw, baseDir?, segmentPatches?)` does parse + reconcile +
  scene-wide remap in one undo step. `segmentPatches` (Copilot styling) only set colour, bold,
  italic, wait and anim time, never text.
- Callers: `LineEditor.onRawChange` (typing, direction switch, "Wrap in \en{…}") and
  `agent/commit.ts` for UPDATEs that touch `raw` or `baseDir`. Nothing else writes `raw`.

### Non-goals

- No persisted ids, no `PROJECT_VERSION` bump, no codegen change.
- Timing model unchanged (`animSec` + `waitAfterSec`); the cue-based model is a later step.
- Stale `segmentMeasures` between an edit and the next measure response behave as before.

### Test plan

`npm run build`, `npm run test`, eslint on touched files, `npx vitest run src/agent`.
New: `segmentReconcile.test.ts`, `remapSegmentRefs.test.ts`,
`useSceneStore.textSource.test.ts`, a `commit.test.ts` case for the Copilot split-and-style
update.

### Open questions

None.

## Implementation notes (editor-dev)

Implemented in one Claude Code session.

- Files: the two new `src/lib` modules + tests; `store/useSceneStore.ts` (action + imports);
  `store/useSceneStore.textSource.test.ts` (new); `panels/LineEditor.tsx` (uses the action,
  drops its own index-only matching); `agent/commit.ts` + `commit.test.ts`.
- First version mapped old → one new index; the Copilot styling case (splitting one segment
  with `||`) matched neither piece by edit distance. Added rule (a) and switched the remap to
  old → index list.
- `npm run build` ok; `npm run test` → 84 files, 704 passed (includes `src/agent`); eslint on
  touched files clean.
- Not done: trying it by hand in the running editor.

## Verification (verifier)

No independent verifier pass. Gates run by the implementing session; the user accepted the
step on that basis (2026-10-15).

| Gate | Command | Result |
|---|---|---|
| Frontend build | `npm run build` | pass |
| Frontend tests | `npm run test` | pass, 704 passed (includes `src/agent`) |
| Lint | `npx eslint` on touched files | pass, clean |

- Not run: trying it by hand in the running editor.

Verdict: **pass** (self-verified, see above).

## Docs delta (docs-keeper)

- README: "Text line" feature row and trailer entry.
- ARCHITECTURE.md: `commit.ts` text-line UPDATE path.
