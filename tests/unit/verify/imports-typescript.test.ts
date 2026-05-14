import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkTypescriptImports } from '../../../src/verify/checks/imports-typescript.js';

async function project(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'imp-ts-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

describe('checkTypescriptImports', () => {
  // 30s per-test timeout: ts-morph's first-run on a cold Windows CI runner
  // does a non-trivial amount of work (project init, module-resolution
  // cache warmup) that exceeds vitest's default 5s. The check itself is
  // fast once the project is loaded — the 30s only matters on cold-start.
  it('passes when relative import resolves', async () => {
    const root = await project({
      'tsconfig.json':
        '{"compilerOptions":{"target":"ES2020","module":"NodeNext","moduleResolution":"NodeNext"}}',
      'a.ts': "import { b } from './b.js';\nconsole.log(b);\n",
      'b.ts': 'export const b = 1;\n',
    });
    expect((await checkTypescriptImports(root, [path.join(root, 'a.ts')])).passed).toBe(true);
  }, 30_000);
  it('fails on missing relative import', async () => {
    const root = await project({
      'tsconfig.json':
        '{"compilerOptions":{"target":"ES2020","module":"NodeNext","moduleResolution":"NodeNext"}}',
      'a.ts': "import { x } from './missing.js';\n",
    });
    const r = await checkTypescriptImports(root, [path.join(root, 'a.ts')]);
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toMatch(/missing/);
  }, 30_000);
});
