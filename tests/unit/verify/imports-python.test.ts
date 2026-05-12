import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkPythonImports } from '../../../src/verify/checks/imports-python.js';

async function project(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imp-py-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

describe('checkPythonImports', () => {
  it('passes when every import resolves', async () => {
    const root = await project({
      'a.py': 'import utils\nutils.do()\n',
      'utils.py': 'def do(): pass\n',
    });
    expect((await checkPythonImports(root, [path.join(root, 'a.py')])).passed).toBe(true);
  });
  it('fails on unresolved relative import', async () => {
    const root = await project({ 'a.py': 'from missing_pkg import x\n' });
    const r = await checkPythonImports(root, [path.join(root, 'a.py')]);
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/missing_pkg/);
  });
  it('passes stdlib imports', async () => {
    const root = await project({ 'a.py': 'import os, sys, json\n' });
    expect((await checkPythonImports(root, [path.join(root, 'a.py')])).passed).toBe(true);
  });
});
