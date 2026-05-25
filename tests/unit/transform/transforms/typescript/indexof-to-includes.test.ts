import { describe, it, expect, beforeEach } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/indexof-to-includes.js';
import { _clearTsConfigCache } from '../../../../../src/transform/transforms/typescript/_tsconfig.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

beforeEach(() => {
  _clearTsConfigCache();
});

async function run(
  src: string,
  name = 'f.ts',
): Promise<{
  newContent: string | null;
  preconditions: { id: string; satisfied: boolean; reason?: string }[];
}> {
  // Use a tmpdir absPath that has no tsconfig.json so the version gate stays
  // permissive (target=null → "assume modern"). Tests for the ES5 gate write
  // their own tsconfig and pass an absPath inside it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-indexof-'));
  const abs = path.join(dir, name);
  const r = await transform({
    absPath: abs,
    relPath: name,
    source: src,
    findings: [],
  });
  return r;
}

describe('indexof_to_includes (typescript)', () => {
  it('rewrites arr.indexOf(x) !== -1 on a typed array', async () => {
    const src = 'const arr: number[] = [1, 2, 3];\nif (arr.indexOf(2) !== -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('arr.includes(2)');
    expect(r.newContent).not.toContain('indexOf');
  });

  it('rewrites arr.indexOf(x) >= 0', async () => {
    const src = 'const arr: string[] = ["a"];\nif (arr.indexOf("a") >= 0) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('arr.includes("a")');
  });

  it('rewrites arr.indexOf(x) > -1', async () => {
    const src = 'const arr: number[] = [1];\nif (arr.indexOf(1) > -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('arr.includes(1)');
  });

  it('rewrites arr.indexOf(x) === -1 as !arr.includes(x) (negative form)', async () => {
    const src = 'const arr: number[] = [1];\nif (arr.indexOf(2) === -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('!arr.includes(2)');
  });

  it('rewrites arr.indexOf(x) < 0 as !arr.includes(x)', async () => {
    const src = 'const arr: number[] = [1];\nif (arr.indexOf(2) < 0) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('!arr.includes(2)');
  });

  it('rewrites the symmetrical LHS shape -1 !== arr.indexOf(x)', async () => {
    const src = 'const arr: number[] = [1];\nif (-1 !== arr.indexOf(2)) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('arr.includes(2)');
  });

  it('rewrites s.indexOf(x) !== -1 on a string LHS (contains form)', async () => {
    const src = 'const s: string = "hello";\nif (s.indexOf("e") !== -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('s.includes("e")');
  });

  it('skips position check arr.indexOf(x) > 5 (not a contains form)', async () => {
    const src = 'const arr: number[] = [1, 2, 3];\nif (arr.indexOf(2) > 5) {}\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('skips position equality arr.indexOf(x) === 3', async () => {
    const src = 'const arr: number[] = [1, 2, 3];\nif (arr.indexOf(2) === 3) {}\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('refuses unknown-type LHS with non_callable_indexof', async () => {
    // A custom class with an indexOf method but no .includes — receiver type
    // is the class, not array/string.
    const src = `
class Bag<T> {
  indexOf(x: T): number { return -1; }
}
const b = new Bag<number>();
if (b.indexOf(1) !== -1) {}
`;
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_callable_indexof')).toBe(true);
  });

  it('refuses on tsconfig target ES5 with non_es2016', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-indexof-es5-'));
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES5' } }),
    );
    const abs = path.join(dir, 'f.ts');
    const r = await transform({
      absPath: abs,
      relPath: 'f.ts',
      source: 'const arr: number[] = [1];\nif (arr.indexOf(2) !== -1) {}\n',
      findings: [],
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_es2016')).toBe(true);
  });

  it('returns null when there are no indexOf comparisons', async () => {
    const r = await run('const x = 1;\n');
    expect(r.newContent).toBeNull();
  });

  it('rewrites arr.indexOf(x) != -1 (loose-inequality form; indexOf returns only ints so == and === agree)', async () => {
    const src = 'const arr: number[] = [1, 2, 3];\nif (arr.indexOf(2) != -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('arr.includes(2)');
    expect(r.newContent).not.toContain('indexOf');
  });

  it('rewrites arr.indexOf(x) == -1 as !arr.includes(x) (loose-equality negative form)', async () => {
    const src = 'const arr: number[] = [1, 2, 3];\nif (arr.indexOf(2) == -1) {}\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('!arr.includes(2)');
  });
});
