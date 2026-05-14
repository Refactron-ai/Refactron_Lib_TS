import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronVerifier } from '../../../src/verify/engine.js';
import type { GateResult, RefactorPlan } from '../../../src/contracts.js';

async function fixtureWithPassingTest(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vgc-'));
  await fs.writeFile(
    path.join(root, 'pyproject.toml'),
    '[tool.pytest.ini_options]\ntestpaths = ["."]\npythonpath = ["."]\n',
  );
  await fs.writeFile(path.join(root, 'lib.py'), 'def x(): return 1\n');
  await fs.writeFile(
    path.join(root, 'test_lib.py'),
    'from lib import x\ndef test_ok(): assert x() == 1\n',
  );
  return root;
}

describe('RefactronVerifier callbacks', () => {
  it('calls onGateComplete once per gate (syntax, imports, tests) in order on success', async () => {
    const root = await fixtureWithPassingTest();
    const calls: Array<{ gate: string; passed: boolean }> = [];
    let shadowRootCalls = 0;
    let capturedShadow: string | null = null;
    const verifier = new RefactronVerifier({
      projectRoot: root,
      onGateComplete: (gate, result: GateResult) => {
        calls.push({ gate, passed: result.passed });
      },
      onShadowRoot: (p: string) => {
        shadowRootCalls++;
        capturedShadow = p;
      },
    });
    const plan: RefactorPlan = { changes: [], preconditions: [] };
    const r = await verifier.verify(plan);
    expect(r.passed).toBe(true);
    expect(calls.map((c) => c.gate)).toEqual(['syntax', 'imports', 'tests']);
    expect(calls.every((c) => c.passed)).toBe(true);
    expect(shadowRootCalls).toBe(1);
    expect(capturedShadow).toBeTruthy();
    expect(path.isAbsolute(capturedShadow as unknown as string)).toBe(true);
  }, 60_000);

  it('emits onGateComplete for skipped gates when an earlier gate fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vgc-bad-'));
    await fs.writeFile(path.join(root, 'package.json'), '{}\n');
    const badFile = path.join(root, 'bad.ts');
    // intentionally broken
    await fs.writeFile(badFile, 'function (\n');
    const calls: Array<{ gate: string; result: GateResult }> = [];
    const verifier = new RefactronVerifier({
      projectRoot: root,
      onGateComplete: (gate, result) => {
        calls.push({ gate, result });
      },
    });
    const plan: RefactorPlan = {
      changes: [
        {
          path: badFile,
          oldHash: 'x',
          newContent: 'function (\n',
          transformId: 'var_to_const_let',
        },
      ],
      preconditions: [],
    };
    const r = await verifier.verify(plan);
    expect(r.passed).toBe(false);
    expect(calls.map((c) => c.gate)).toEqual(['syntax', 'imports', 'tests']);
    expect(calls[0]?.result.passed).toBe(false);
    expect(calls[1]?.result.passed).toBe(false);
    expect(calls[1]?.result.blockingReason).toMatch(/skipped/i);
    expect(calls[2]?.result.passed).toBe(false);
    expect(calls[2]?.result.blockingReason).toMatch(/skipped/i);
  }, 60_000);
});
