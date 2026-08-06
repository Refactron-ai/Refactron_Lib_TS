import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { RefactronVerifier } from '../../src/verify/engine.js';
import type { RefactorPlan, TransformId } from '../../src/contracts.js';

const FIXTURE = path.resolve('tests/fixtures/python-legacy-mini');

// This repo ships no transforms, so a plan here never comes from one. Mirrors
// the cast src/verify/verify-diff.ts:25 already uses for the same reason: the
// TransformId union is a locked contract and still lists the 20 transform ids
// that left with the refactoring product.
const SYNTHETIC_TRANSFORM = 'external-diff' as unknown as TransformId;

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
          transformId: SYNTHETIC_TRANSFORM,
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
          transformId: SYNTHETIC_TRANSFORM,
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
          transformId: SYNTHETIC_TRANSFORM,
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
