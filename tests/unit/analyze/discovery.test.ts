import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { walkProject } from '../../../src/analyze/discovery.js';

async function project(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'walk-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

async function collect(
  it: AsyncIterable<{ relPath: string; lang: 'python' | 'typescript' }>,
): Promise<Array<{ relPath: string; lang: string }>> {
  const out: Array<{ relPath: string; lang: string }> = [];
  for await (const r of it) out.push({ relPath: r.relPath, lang: r.lang });
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

describe('walkProject', () => {
  it('classifies .py / .ts / .tsx / .js / .jsx', async () => {
    const root = await project({
      'a.py': '',
      'b.ts': '',
      'c.tsx': '',
      'd.js': '',
      'e.jsx': '',
      'f.md': '',
    });
    const out = await collect(walkProject(root));
    expect(out.map((r) => r.relPath)).toEqual(['a.py', 'b.ts', 'c.tsx', 'd.js', 'e.jsx']);
    expect(out.find((r) => r.relPath === 'a.py')!.lang).toBe('python');
    expect(out.find((r) => r.relPath === 'b.ts')!.lang).toBe('typescript');
  });
  it('respects .gitignore', async () => {
    const root = await project({
      '.gitignore': 'ignored.py\nsub/\n',
      'kept.py': '',
      'ignored.py': '',
      'sub/x.py': '',
    });
    const out = await collect(walkProject(root));
    expect(out.map((r) => r.relPath)).toEqual(['kept.py']);
  });
  it('skips vendored dirs by default', async () => {
    const root = await project({
      'a.py': '',
      'node_modules/x.py': '',
      '.venv/x.py': '',
      'dist/x.py': '',
      'build/x.py': '',
      '.git/x.py': '',
      '__pycache__/x.pyc': '',
    });
    const out = await collect(walkProject(root));
    expect(out.map((r) => r.relPath)).toEqual(['a.py']);
  });
  it('skips files larger than 1 MB', async () => {
    const root = await project({ 'big.py': '#' + 'x'.repeat(2_000_000) });
    const out = await collect(walkProject(root));
    expect(out).toEqual([]);
  });
});
