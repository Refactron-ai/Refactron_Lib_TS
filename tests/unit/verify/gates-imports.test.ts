import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { importsGate } from '../../../src/verify/gates/imports.js';
import { createShadowTree } from '../../../src/verify/shadow-tree.js';
import type { FileChange } from '../../../src/contracts.js';

describe('importsGate', () => {
  it('passes a clean mixed tree', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-'));
    await fs.writeFile(path.join(src, 'pyproject.toml'), '[project]\nname="x"\n');
    await fs.writeFile(path.join(src, 'a.py'), 'import os\n');
    const h = await createShadowTree(src, []);
    const r = await importsGate({ shadowRoot: h.path, changes: [] }, src);
    await h.cleanup();
    expect(r.passed).toBe(true);
  });

  it('fails when a python change has an unresolved import', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-fail-'));
    await fs.writeFile(path.join(src, 'a.py'), 'import os\n');
    const change: FileChange = {
      path: path.join(src, 'a.py'),
      oldHash: 'x',
      newContent: 'import totally_not_a_real_pkg_xyz\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/totally_not_a_real_pkg_xyz/);
  });
});
