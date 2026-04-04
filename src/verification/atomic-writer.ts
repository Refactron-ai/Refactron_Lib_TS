// src/verification/atomic-writer.ts
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

export async function atomicWrite(destPath: string, content: string): Promise<void> {
  const dir = path.dirname(destPath);
  const tmpName = `.refactron-tmp-${randomBytes(8).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content, 'utf-8');

  try {
    await fs.rename(tmpPath, destPath);
  } catch {
    // Windows: rename across drives fails — fall back to copy+delete
    await fs.copyFile(tmpPath, destPath);
    await fs.unlink(tmpPath);
  }
}

export async function atomicWriteBuffer(destPath: string, content: Buffer): Promise<void> {
  const dir = path.dirname(destPath);
  const tmpName = `.refactron-tmp-${randomBytes(8).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content);

  try {
    await fs.rename(tmpPath, destPath);
  } catch {
    await fs.copyFile(tmpPath, destPath);
    await fs.unlink(tmpPath);
  }
}
