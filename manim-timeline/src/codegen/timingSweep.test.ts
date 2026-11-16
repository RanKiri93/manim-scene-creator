import { describe, expect, it } from 'vitest';
import { buildTimingSweepCase, timingSweepScenes } from './timingSweep';

// The Manim side of the sweep runs in scripts/timing-sweep/run_sweep.py; this keeps the
// fixtures exportable and fully mapped so that run stays meaningful.
describe('timing sweep fixtures', () => {
  for (const scene of timingSweepScenes()) {
    it(`${scene.name} exports and maps every animated clip to Python variables`, () => {
      const c = buildTimingSweepCase(scene);
      expect(c.code).not.toContain('EXPORT ERROR');
      expect(c.code).toContain(`class ${scene.name}(`);
      expect(c.expectations.length).toBeGreaterThan(3);
      for (const e of c.expectations) {
        if (e.role !== 'camera') expect(e.vars.length, e.id).toBeGreaterThan(0);
        for (const v of e.vars) expect(c.code, `${e.id} -> ${v}`).toContain(v);
        if (e.role !== 'sound') expect(e.end, e.id).toBeGreaterThan(e.start);
      }
    });
  }
});
