import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/var-to-const-let.js';

async function run(
  src: string,
  name = 'f.ts',
): Promise<{
  newContent: string | null;
  preconditions: { id: string; satisfied: boolean; reason?: string }[];
}> {
  const r = await transform({
    absPath: `/virtual/${name}`,
    relPath: name,
    source: src,
    findings: [],
  });
  return r;
}

describe('var_to_const_let (typescript)', () => {
  it('rewrites a never-reassigned var to const', async () => {
    const src = 'var greeting = "hi";\nconsole.log(greeting);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('const greeting = "hi"');
    expect(r.newContent).not.toMatch(/\bvar\s+greeting\b/);
  });

  it('rewrites a reassigned var to let', async () => {
    const src = 'var counter = 0;\nfor (let i = 0; i < 3; i++) counter = counter + 1;\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('let counter = 0');
    expect(r.newContent).not.toMatch(/\bvar\s+counter\b/);
  });

  it('handles multiple independent vars in one file', async () => {
    const src = 'var a = 1;\nvar b = 2;\nb = b + 1;\nconsole.log(a, b);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('const a = 1');
    expect(r.newContent).toContain('let b = 2');
  });

  it('skips file when a var is used before its declaration (hoisting)', async () => {
    const src = 'console.log(x);\nvar x = 1;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id.startsWith('hoisting:'))).toBe(true);
  });

  it('returns null when there are no var statements', async () => {
    const src = 'const a = 1;\nlet b = 2;\nb = 3;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });
});
