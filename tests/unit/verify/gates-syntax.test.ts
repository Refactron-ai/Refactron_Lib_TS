import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { syntaxGate } from '../../../src/verify/gates/syntax.js';
import { createShadowTree } from '../../../src/verify/shadow-tree.js';

describe('syntaxGate', () => {
  it('passes valid mixed-language tree', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gs-'));
    await fs.writeFile(path.join(src, 'a.py'), 'x = 1\n');
    await fs.writeFile(path.join(src, 'b.ts'), 'export const x = 1;\n');
    const handle = await createShadowTree(src, []);
    const result = await syntaxGate({ shadowRoot: handle.path, changes: [] }, src);
    await handle.cleanup();
    expect(result.passed).toBe(true);
  });

  it('fails when any changed file has broken syntax', async () => {
    const src = await fs.mkdtemp(path.join(os.tmpdir(), 'gs2-'));
    await fs.writeFile(path.join(src, 'a.py'), 'x = 1\n');
    const change = {
      path: path.join(src, 'a.py'),
      oldHash: 'x',
      newContent: 'x = (\n',
      transformId: 'format_to_fstring' as const,
    };
    const handle = await createShadowTree(src, [change]);
    const result = await syntaxGate({ shadowRoot: handle.path, changes: [change] }, src);
    await handle.cleanup();
    expect(result.passed).toBe(false);
  });
});
