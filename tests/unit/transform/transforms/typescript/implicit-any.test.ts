import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/implicit-any.js';

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

describe('implicit_any (typescript)', () => {
  it('annotates parameters when all call sites pass the same primitive', async () => {
    const src = 'export function add(a, b) { return a + b; }\nconst r = add(1, 2);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toMatch(/a:\s*number/);
    expect(r.newContent).toMatch(/b:\s*number/);
  });

  it('skips parameters whose call sites pass diverging primitives', async () => {
    const src = "export function id(x) { return x; }\nid(1);\nid('a');\n";
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(
      r.preconditions.some((p) => p.id.startsWith('diverging-types:id:x')),
    ).toBe(true);
  });

  it('leaves already-annotated parameters alone and only annotates the bare ones', async () => {
    const src =
      'export function f(a: number, b) { return a + b; }\nf(1, 2);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    // `a: number` should remain (unchanged), `b` should now be annotated `number`.
    expect(r.newContent).toMatch(/a:\s*number/);
    expect(r.newContent).toMatch(/b:\s*number/);
  });

  it('returns null when the function has no call sites', async () => {
    const src = 'export function unused(x) { return x; }\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });
});
