import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { recheckSyntax } from '../../../src/document/post-check.js';

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

describe('recheckSyntax', () => {
  it('passes for syntactically valid TypeScript', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-'));
    tmp.push(root);
    const file = path.join(root, 'ok.ts');
    await fs.writeFile(file, 'export const x: number = 1;\n');
    const r = await recheckSyntax([file]);
    expect(r.ok).toBe(true);
    expect(r.broken).toEqual([]);
  });

  it('flags a syntactically broken file and isolates it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pc-'));
    tmp.push(root);
    const good = path.join(root, 'good.ts');
    const bad = path.join(root, 'bad.ts');
    await fs.writeFile(good, 'export const x = 1;\n');
    // A doubled docstring-style wrapper is what the original bug produced —
    // here, an unterminated construct that the TS parser rejects.
    await fs.writeFile(bad, 'export function f( {\n');
    const r = await recheckSyntax([good, bad]);
    expect(r.ok).toBe(false);
    expect(r.broken).toContain(bad);
    expect(r.broken).not.toContain(good);
  });
}, 30_000);
