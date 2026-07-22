import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checkPythonImports,
  collectPythonUnresolved,
} from '../../../src/verify/checks/imports-python.js';

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

  it('skips a TYPE_CHECKING-guarded unresolved import (attribute form)', async () => {
    const root = await project({
      'a.py':
        'import typing as t\n' +
        'if t.TYPE_CHECKING:\n' +
        '    import totally_missing_typecheck_only_pkg\n',
    });
    expect((await checkPythonImports(root, [path.join(root, 'a.py')])).passed).toBe(true);
  });

  it('skips a TYPE_CHECKING-guarded unresolved import (bare name form)', async () => {
    const root = await project({
      'a.py':
        'from typing import TYPE_CHECKING\n' +
        'if TYPE_CHECKING:\n' +
        '    from totally_missing_typecheck_only_pkg import Thing\n',
    });
    expect((await checkPythonImports(root, [path.join(root, 'a.py')])).passed).toBe(true);
  });

  it('still checks the else branch of a TYPE_CHECKING guard', async () => {
    const root = await project({
      'a.py':
        'from typing import TYPE_CHECKING\n' +
        'if TYPE_CHECKING:\n' +
        '    import missing_type_only_pkg\n' +
        'else:\n' +
        '    import missing_runtime_pkg\n',
    });
    const p = path.join(root, 'a.py');
    const byFile = await collectPythonUnresolved(root, [p]);
    const mods = byFile.get(p);
    expect(mods).toBeDefined();
    expect([...(mods ?? [])]).toContain('missing_runtime_pkg');
    expect([...(mods ?? [])]).not.toContain('missing_type_only_pkg');
  });

  it('reports every unresolved import, not just the first', async () => {
    const root = await project({
      'a.py': 'import missing_one\nimport missing_two\nimport os\n',
    });
    const p = path.join(root, 'a.py');
    const byFile = await collectPythonUnresolved(root, [p]);
    const mods = [...(byFile.get(p) ?? [])].sort();
    expect(mods).toEqual(['missing_one', 'missing_two']);
  });
});
