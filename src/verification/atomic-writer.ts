// src/verification/atomic-writer.ts
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

async function resolveTargetMode(
  destPath: string,
  explicitMode: number | undefined,
): Promise<number | undefined> {
  if (explicitMode !== undefined) return explicitMode;
  try {
    const st = await fs.stat(destPath);
    return st.mode & 0o777;
  } catch {
    return undefined;
  }
}

export async function atomicWrite(destPath: string, content: string, mode?: number): Promise<void> {
  const dir = path.dirname(destPath);
  const tmpName = `.refactron-tmp-${randomBytes(8).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content, 'utf-8');

  const targetMode = await resolveTargetMode(destPath, mode);
  if (targetMode !== undefined) await fs.chmod(tmpPath, targetMode);

  try {
    await fs.rename(tmpPath, destPath);
  } catch {
    // Windows: rename across drives fails — fall back to copy+delete
    await fs.copyFile(tmpPath, destPath);
    if (targetMode !== undefined) await fs.chmod(destPath, targetMode);
    await fs.unlink(tmpPath);
  }
}

export async function atomicWriteBuffer(
  destPath: string,
  content: Buffer,
  mode?: number,
): Promise<void> {
  const dir = path.dirname(destPath);
  const tmpName = `.refactron-tmp-${randomBytes(8).toString('hex')}`;
  const tmpPath = path.join(dir, tmpName);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content);

  const targetMode = await resolveTargetMode(destPath, mode);
  if (targetMode !== undefined) await fs.chmod(tmpPath, targetMode);

  try {
    await fs.rename(tmpPath, destPath);
  } catch {
    await fs.copyFile(tmpPath, destPath);
    if (targetMode !== undefined) await fs.chmod(destPath, targetMode);
    await fs.unlink(tmpPath);
  }
}
