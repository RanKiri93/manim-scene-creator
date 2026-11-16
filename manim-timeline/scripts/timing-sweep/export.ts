// Writes each timing-sweep scene's exported Python and expected clip windows into argv[2].
// Run via run_sweep.py (it calls: npx vite-node --config vitest.config.ts scripts/timing-sweep/export.ts <dir>).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildTimingSweepCase, timingSweepScenes } from '../../src/codegen/timingSweep';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: export.ts <output dir>');
mkdirSync(outDir, { recursive: true });

for (const scene of timingSweepScenes()) {
  const c = buildTimingSweepCase(scene);
  writeFileSync(join(outDir, `${c.scene}.py`), c.code);
  writeFileSync(join(outDir, `${c.scene}.expect.json`), JSON.stringify({ expectations: c.expectations, vars: c.vars }, null, 1));
  console.log(`exported ${c.scene}: ${c.expectations.length} clips`);
}
