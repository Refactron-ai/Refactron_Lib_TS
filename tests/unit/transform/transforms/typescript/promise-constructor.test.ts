import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/promise-constructor.js';

async function run(
  src: string,
  name = 'f.ts',
): Promise<{
  newContent: string | null;
  preconditions: { id: string; satisfied: boolean; reason?: string }[];
}> {
  return transform({
    absPath: `/virtual/${name}`,
    relPath: name,
    source: src,
    findings: [],
  });
}

describe('promise_constructor_to_async (typescript)', () => {
  it('folds new Promise((resolve) => resolve(value)) into async return', async () => {
    const src = [
      'function makePromise(value: number) {',
      '  return new Promise((resolve) => resolve(value));',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toMatch(/async\s+function\s+makePromise/);
    expect(r.newContent).toContain('return value');
    expect(r.newContent).not.toContain('new Promise');
  });

  it('skips executors that use setTimeout (no-async-escape)', async () => {
    const src = [
      'function delay(v: number, ms: number) {',
      '  return new Promise((resolve) => setTimeout(() => resolve(v), ms));',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'no-async-escape')).toBe(true);
  });

  it('skips executors with multiple resolve() calls (single-resolve)', async () => {
    const src = [
      'function f(x: number) {',
      '  return new Promise((resolve) => {',
      '    if (x > 0) resolve(1);',
      '    else resolve(-1);',
      '  });',
      '}',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'single-resolve')).toBe(true);
  });
});
