---
name: verify-frontend
description: Run and interpret the frontend gates for manim-timeline (tsc build, vitest, eslint). Use after any change under manim-timeline/src, and always before reporting a frontend task done.
---

# Verify frontend

All commands run from `manim-timeline/` (PowerShell: `Set-Location manim-timeline` or
`cd manim-timeline`). Never from the repo root.

## Gates, in order

1. Type check + bundle:
   ```
   npm run build
   ```
   This is `tsc -b && vite build`. A `tsc` error is a hard fail. Vite warnings about chunk
   size are not.
2. Unit tests:
   ```
   npm run test
   ```
   Vitest, node environment, ~40 test files. To run a subset while iterating:
   `npx vitest run src/codegen` or `npx vitest run src/lib/time.test.ts`.
3. Lint (touched files must be clean; pre-existing warnings elsewhere are not your problem):
   ```
   npm run lint
   ```

## Reading failures

- `TS2345 / TS2322` in `src/agent/validate.ts` after touching `types/scene.ts`: a new required
  field on a `SceneItem` variant needs a default in the matching `normalize*` function.
- `TS2339` in `src/store/factories.ts`: same cause; add the field to the factory.
- Vitest failure in `manimExporter.overlap.test.ts` after a codegen change: the emitted
  Python no longer matches the timeline cursor. Load skill `codegen-invariants` before
  editing expectations. Do not "fix" the test by changing expected `self.wait` values
  without deriving them from the timeline.
- Vitest failure in `migrateProjectToV*.test.ts`: you changed persisted shape without a
  migration. Load skill `project-schema-migration`.
- `react-hooks/exhaustive-deps` lint errors: fix them; do not disable the rule inline.

## What to report

Paste the last lines of each command (pass/fail counts), not the full output. If anything
failed, quote the first error verbatim with file:line.

## Not a gate, but check when relevant

- If you changed a panel or the timeline, run `npm run dev` and confirm the change once in
  the browser at http://localhost:5173/ (measure server optional).
- If you changed `src/services/measureClient.ts`, confirm the server endpoint signature in
  `measure_server.py` still matches (skill `verify-server`).
