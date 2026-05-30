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

  it('preserves mode when overwriting an existing file (executable bit retained)', async () => {
    const dest = path.join(os.tmpdir(), `refactron-mode-${Date.now()}.sh`);
    await fs.writeFile(dest, '#!/bin/sh\necho hi\n');
    await fs.chmod(dest, 0o755);
    await atomicWrite(dest, '#!/bin/sh\necho hi 2\n');
    expect((await fs.stat(dest)).mode & 0o777).toBe(0o755);
    await fs.unlink(dest);
  });

  it('applies an explicit mode argument over the existing mode', async () => {
    const dest = path.join(os.tmpdir(), `refactron-mode-explicit-${Date.now()}.sh`);
    await fs.writeFile(dest, 'x');
    await fs.chmod(dest, 0o644);
    await atomicWrite(dest, 'y', 0o755);
    expect((await fs.stat(dest)).mode & 0o777).toBe(0o755);
    await fs.unlink(dest);
  });
});
