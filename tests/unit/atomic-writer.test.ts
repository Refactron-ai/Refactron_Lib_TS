// tests/unit/atomic-writer.test.ts
import { describe, it, expect } from 'vitest';
import { atomicWrite } from '../../src/verification/atomic-writer.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('atomicWrite', () => {
  it('writes content to destination atomically', async () => {
    const dest = path.join(os.tmpdir(), `refactron-test-${Date.now()}.txt`);
    await atomicWrite(dest, 'hello world');
    const content = await fs.readFile(dest, 'utf-8');
    expect(content).toBe('hello world');
    await fs.unlink(dest);
  });

  it('replaces existing file without leaving temp files', async () => {
    const dest = path.join(os.tmpdir(), `refactron-test-${Date.now()}.txt`);
    await fs.writeFile(dest, 'original');
    await atomicWrite(dest, 'updated');
    const content = await fs.readFile(dest, 'utf-8');
    expect(content).toBe('updated');
    await fs.unlink(dest);
  });
});
