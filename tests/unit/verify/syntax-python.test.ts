import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkPythonSyntax } from '../../../src/verify/checks/syntax-python.js';

async function tmpFile(content: string, ext = '.py'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-'));
  const p = path.join(dir, 'f' + ext);
  await fs.writeFile(p, content);
  return p;
}

describe('checkPythonSyntax', () => {
  it('passes valid python', async () => {
    const f = await tmpFile('def x(): return 1\n');
    const r = await checkPythonSyntax([f]);
    expect(r.passed).toBe(true);
  });
  it('fails on broken python', async () => {
    const f = await tmpFile('def x(:\n  pass\n');
    const r = await checkPythonSyntax([f]);
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/SyntaxError|invalid syntax/);
  });
  it('returns short-circuit on first failing file', async () => {
    const ok = await tmpFile('x = 1\n');
    const bad = await tmpFile('x = (\n');
    const r = await checkPythonSyntax([ok, bad]);
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toContain(path.basename(bad));
  });
});
