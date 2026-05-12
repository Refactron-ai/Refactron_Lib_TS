import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RefactronVerifier } from '../../src/verify/engine.js';
import type { RefactorPlan } from '../../src/contracts.js';

const FIXTURE = path.resolve('fixtures/python-legacy-mini');

describe('RefactronVerifier on python-legacy-mini', () => {
  it('passes a no-op plan', async () => {
    const v = new RefactronVerifier({ projectRoot: FIXTURE });
    const plan: RefactorPlan = { changes: [], preconditions: [] };
    const r = await v.verify(plan);
    expect(r.passed).toBe(true);
    expect(r.gates.syntax.passed).toBe(true);
    expect(r.gates.imports.passed).toBe(true);
    expect(r.gates.tests.passed).toBe(true);
  }, 120_000);

  it('rejects a plan that breaks syntax', async () => {
    const v = new RefactronVerifier({ projectRoot: FIXTURE });
    const target = path.join(FIXTURE, 'utils.py');
    const plan: RefactorPlan = {
      changes: [
        {
          path: target,
          oldHash: 'x',
          newContent: 'def slugify(:\n',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const r = await v.verify(plan);
    expect(r.passed).toBe(false);
    expect(r.gates.syntax.passed).toBe(false);
  }, 120_000);

  it('rejects a plan that breaks imports', async () => {
    const v = new RefactronVerifier({ projectRoot: FIXTURE });
    const target = path.join(FIXTURE, 'utils.py');
    const plan: RefactorPlan = {
      changes: [
        {
          path: target,
          oldHash: 'x',
          newContent: 'import this_module_does_not_exist_xyz\n',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const r = await v.verify(plan);
    expect(r.passed).toBe(false);
    expect(r.gates.syntax.passed).toBe(true);
    expect(r.gates.imports.passed).toBe(false);
  }, 120_000);

  it('rejects a plan that breaks tests', async () => {
    const v = new RefactronVerifier({ projectRoot: FIXTURE });
    const target = path.join(FIXTURE, 'utils.py');
    const original = await fs.readFile(target, 'utf8');
    const broken = original.replace(
      /def clamp\([^)]*\):[\s\S]*?return[^\n]+\n/,
      'def clamp(v, lo, hi):\n    return -999\n',
    );
    const plan: RefactorPlan = {
      changes: [
        {
          path: target,
          oldHash: 'x',
          newContent: broken,
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const r = await v.verify(plan);
    expect(r.passed).toBe(false);
    expect(r.gates.syntax.passed).toBe(true);
    expect(r.gates.imports.passed).toBe(true);
    expect(r.gates.tests.passed).toBe(false);
  }, 180_000);
});
