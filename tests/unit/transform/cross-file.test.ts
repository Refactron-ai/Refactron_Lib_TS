import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildCrossFileContext } from '../../../src/transform/cross-file.js';
import type { ExtendedAnalysisReport } from '../../../src/analyze/engine.js';

async function project(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

function fakeReport(root: string, imports: Record<string, string[]>): ExtendedAnalysisReport {
  const g = new Map<string, Set<string>>();
  for (const [src, dests] of Object.entries(imports)) g.set(src, new Set(dests));
  return {
    root,
    findings: [],
    analyzedAt: new Date(),
    importGraph: g,
    callEdges: [],
  };
}

describe('buildCrossFileContext', () => {
  it('reads all project files and reverses the import graph', async () => {
    const root = await project({
      'a.py': 'import b\n',
      'b.py': 'def f(): pass\n',
      'tests/test_x.py': 'import a\n',
    });
    const report = fakeReport(root, {
      'a.py': ['b.py'],
      'tests/test_x.py': ['a.py'],
    });
    const ctx = await buildCrossFileContext(report, root);
    expect(ctx.projectRoot).toBe(root);
    expect(ctx.files['a.py']).toContain('import b');
    expect(ctx.files['b.py']).toContain('def f');
    expect(ctx.importedBy['b.py']).toEqual(['a.py']);
    expect(ctx.importedBy['a.py']).toEqual(['tests/test_x.py']);
    expect(ctx.testFiles).toContain('tests/test_x.py');
  });

  it('detects test files by path and filename conventions', async () => {
    const root = await project({
      'main.py': '',
      'test_helpers.py': '',
      'tests/test_x.py': '',
      'app_test.py': '',
    });
    const report = fakeReport(root, {
      'main.py': [],
      'test_helpers.py': [],
      'tests/test_x.py': [],
      'app_test.py': [],
    });
    const ctx = await buildCrossFileContext(report, root);
    expect(ctx.testFiles.sort()).toEqual(['app_test.py', 'test_helpers.py', 'tests/test_x.py']);
  });
});
