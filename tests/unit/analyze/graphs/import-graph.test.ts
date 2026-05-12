import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildImportGraph } from '../../../../src/analyze/graphs/import-graph.js';
import { walkProject } from '../../../../src/analyze/discovery.js';

async function project(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

async function asArray<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('buildImportGraph', () => {
  it('builds adjacency from python project', async () => {
    const root = await project({
      'a.py': 'import utils\n',
      'utils.py': 'def f(): pass\n',
    });
    const files = await asArray(walkProject(root));
    const g = await buildImportGraph(root, files);
    expect(g.get('a.py')?.has('utils.py')).toBe(true);
  });

  it('builds adjacency from ts project (relative)', async () => {
    const root = await project({
      'a.ts': 'import { b } from "./b.js";\n',
      'b.ts': 'export const b = 1;\n',
    });
    const files = await asArray(walkProject(root));
    const g = await buildImportGraph(root, files);
    expect(g.get('a.ts')?.has('b.ts')).toBe(true);
  });
});
