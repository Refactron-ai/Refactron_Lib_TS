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

  it('passes when a pre-existing unresolved import is untouched by the edit', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-preexist-'));
    // The unresolved import already exists in the base file; the edit only
    // touches an unrelated line. Delta-aware gate must not blame the change.
    await fs.writeFile(path.join(src, 'a.py'), 'import totally_missing_pkg_pre\nx = 1\n');
    const change: FileChange = {
      path: path.join(src, 'a.py'),
      oldHash: 'x',
      newContent: 'import totally_missing_pkg_pre\nx = 2\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(true);
  });

  it('fails on a newly introduced unresolved import and names the module + relative path', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-new-'));
    await fs.mkdir(path.join(src, 'pkg'), { recursive: true });
    await fs.writeFile(path.join(src, 'pkg', 'a.py'), 'import os\n');
    const change: FileChange = {
      path: path.join(src, 'pkg', 'a.py'),
      oldHash: 'x',
      newContent: 'import os\nimport brand_new_missing_pkg\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/brand_new_missing_pkg/);
    expect(r.blockingReason).toMatch(/pkg[/\\]a\.py/);
    // Must be the project-relative path, never the absolute shadow path.
    expect(r.blockingReason).not.toContain(h.path);
  });

  it('fails on an unguarded unresolved import in a brand-new file', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-newfile-'));
    await fs.writeFile(path.join(src, 'pyproject.toml'), '[project]\nname="x"\n');
    const change: FileChange = {
      path: path.join(src, 'newmod.py'),
      oldHash: '',
      newContent: 'import brand_new_missing_pkg\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/brand_new_missing_pkg/);
    expect(r.blockingReason).toMatch(/newmod\.py/);
  });

  it('passes a TYPE_CHECKING-guarded unresolved import in a changed file', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-tc-'));
    await fs.writeFile(path.join(src, 'a.py'), 'x = 1\n');
    const change: FileChange = {
      path: path.join(src, 'a.py'),
      oldHash: 'x',
      newContent:
        'import typing as t\n' +
        'if t.TYPE_CHECKING:\n' +
        '    import totally_missing_typecheck_only_pkg\n' +
        'x = 2\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(true);
  });

  it('passes when a pre-existing unresolved TS import is untouched by the edit', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-ts-preexist-'));
    await fs.writeFile(
      path.join(src, 'tsconfig.json'),
      '{"compilerOptions":{"target":"ES2020","module":"NodeNext","moduleResolution":"NodeNext"}}',
    );
    await fs.writeFile(
      path.join(src, 'a.ts'),
      "import { x } from './missing.js';\nexport const y = 1;\n",
    );
    const change: FileChange = {
      path: path.join(src, 'a.ts'),
      oldHash: 'x',
      newContent: "import { x } from './missing.js';\nexport const y = 2;\n",
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(true);
  }, 30_000);

  it('fails on a newly introduced unresolved TS import and names the relative path', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-ts-new-'));
    await fs.writeFile(
      path.join(src, 'tsconfig.json'),
      '{"compilerOptions":{"target":"ES2020","module":"NodeNext","moduleResolution":"NodeNext"}}',
    );
    await fs.writeFile(path.join(src, 'a.ts'), 'export const y = 1;\n');
    const change: FileChange = {
      path: path.join(src, 'a.ts'),
      oldHash: 'x',
      newContent: "import { x } from './brand-new-missing.js';\nexport const y = 1;\n",
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
    await h.cleanup();
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/brand-new-missing/);
    expect(r.blockingReason).toMatch(/a\.ts/);
    expect(r.blockingReason).not.toContain(h.path);
  }, 30_000);

  it('never passes when the python sidecar itself fails', async () => {
    // The delta logic forgives pre-existing failures, so the one regression
    // that must stay impossible is: collector failure -> empty findings ->
    // gate passes. Break python3 for real (a crashing shim first on PATH) and
    // assert the gate fails closed: it must throw or fail, never pass.
    const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-shim-'));
    await fs.writeFile(path.join(shimDir, 'python3'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await fs.writeFile(path.join(shimDir, 'python3.bat'), '@exit /b 1\r\n');

    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gi-crash-'));
    await fs.writeFile(path.join(src, 'a.py'), 'import os\n');
    const change: FileChange = {
      path: path.join(src, 'a.py'),
      oldHash: 'x',
      newContent: 'import genuinely_missing_pkg_qq\n',
      transformId: 'format_to_fstring',
    };
    const h = await createShadowTree(src, [change]);
    const savedPath = process.env.PATH;
    process.env.PATH = `${shimDir}${path.delimiter}${savedPath}`;
    let failedClosed = false;
    try {
      const r = await importsGate({ shadowRoot: h.path, changes: [change] }, src);
      failedClosed = r.passed === false;
    } catch {
      failedClosed = true;
    } finally {
      process.env.PATH = savedPath;
      await h.cleanup();
    }
    expect(failedClosed).toBe(true);
  }, 30_000);
});
