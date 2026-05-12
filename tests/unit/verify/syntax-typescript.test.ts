import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkTypescriptSyntax } from '../../../src/verify/checks/syntax-typescript.js';

async function tmpFile(content: string, ext = '.ts'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-ts-'));
  const p = path.join(dir, 'f' + ext);
  await fs.writeFile(p, content);
  return p;
}

describe('checkTypescriptSyntax', () => {
  it('passes valid TS', async () => {
    const f = await tmpFile('export const x: number = 1;\n');
    expect((await checkTypescriptSyntax([f])).passed).toBe(true);
  });
  it('fails on broken TS', async () => {
    const f = await tmpFile('export const x: = 1;\n');
    const r = await checkTypescriptSyntax([f]);
    expect(r.passed).toBe(false);
    expect(r.blockingReason).toBeTruthy();
  });
  it('handles UTF-8 BOM', async () => {
    const f = await tmpFile('﻿export const x = 1;\n');
    expect((await checkTypescriptSyntax([f])).passed).toBe(true);
  });
  it('supports .tsx files', async () => {
    const f = await tmpFile('export const X = () => <div/>;\n', '.tsx');
    expect((await checkTypescriptSyntax([f])).passed).toBe(true);
  });
});
