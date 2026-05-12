import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeBatchAtomic } from '../../../src/verify/atomic-batch-writer.js';

describe('writeBatchAtomic', () => {
  it('writes all changes when every rename succeeds', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'abw-'));
    const a = path.join(dir, 'a.txt');
    const b = path.join(dir, 'b.txt');
    await fs.writeFile(a, 'A-old');
    await fs.writeFile(b, 'B-old');
    await writeBatchAtomic([
      { path: a, newContent: 'A-new', oldHash: '', transformId: 'format_to_fstring' },
      { path: b, newContent: 'B-new', oldHash: '', transformId: 'format_to_fstring' },
    ]);
    expect(await fs.readFile(a, 'utf8')).toBe('A-new');
    expect(await fs.readFile(b, 'utf8')).toBe('B-new');
  });

  it('rolls back when one rename fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'abw2-'));
    const a = path.join(dir, 'a.txt');
    await fs.writeFile(a, 'A-old');
    await expect(
      writeBatchAtomic([
        { path: a, newContent: 'A-new', oldHash: '', transformId: 'format_to_fstring' },
        {
          path: path.join(dir, 'no', 'such', 'dir', 'b.txt'),
          newContent: 'B',
          oldHash: '',
          transformId: 'format_to_fstring',
        },
      ]),
    ).rejects.toThrow();
    expect(await fs.readFile(a, 'utf8')).toBe('A-old');
  });
});
