import { describe, it, expect, beforeEach } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/string-concat-to-template-literal.js';
import { _clearTsConfigCache } from '../../../../../src/transform/transforms/typescript/_tsconfig.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

beforeEach(() => {
  _clearTsConfigCache();
});

async function run(src: string, name = 'f.ts'): ReturnType<typeof transform> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-concat-'));
  const abs = path.join(dir, name);
  return transform({
    absPath: abs,
    relPath: name,
    source: src,
    findings: [],
  });
}

describe('string_concat_to_template_literal (typescript)', () => {
  it('rewrites a basic three-piece concat', async () => {
    const src = 'const greeting: string = "x";\nconst g = "Hello " + greeting + "!";\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('`Hello ${greeting}!`');
  });

  it('escapes a backtick in the string content', async () => {
    const src = 'const greeting: string = "x";\nconst g = "It is `tick`: " + greeting;\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    // The output literal must escape the backtick so the template literal parses.
    expect(r.newContent).toContain('It is \\`tick\\`');
  });

  it('escapes a literal ${ sequence', async () => {
    const src = 'const greeting: string = "x";\nconst g = "money ${USD}: " + greeting;\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('money \\${USD}');
  });

  it('rewrites a number operand', async () => {
    const src = 'const n: number = 42;\nconst g = "n=" + n;\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('`n=${n}`');
  });

  it('refuses any-typed operand with unknown_operand_type', async () => {
    const src = 'declare const x: any;\nconst g = "x=" + x;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'unknown_operand_type')).toBe(true);
  });

  it('refuses non-primitive operand with non_coercible_operand', async () => {
    const src = 'const o = {a:1};\nconst g = "o=" + o;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_coercible_operand')).toBe(true);
  });

  it('refuses on tsconfig target ES5 with non_es2015', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-concat-es5-'));
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES5' } }),
    );
    const abs = path.join(dir, 'f.ts');
    const r = await transform({
      absPath: abs,
      relPath: 'f.ts',
      source: 'const greeting: string = "x";\nconst g = "hi " + greeting;\n',
      findings: [],
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_es2015')).toBe(true);
  });

  it('returns null when there are no string-concat plus chains', async () => {
    const src = 'const a: number = 1;\nconst b: number = 2;\nconst c = a + b;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });

  it('rewrites `"a" + (b + c)` with numeric b,c (proves the previously-documented `addition_subexpression` refusal was unreachable; numbers stringify identically)', async () => {
    const src = 'const b: number = 1;\nconst c: number = 2;\nconst g = "a" + (b + c);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('`a${b}${c}`');
  });

  it('refuses `"a" + (objExpr + otherExpr)` via non_coercible_operand when an inner operand is non-primitive', async () => {
    const src = 'const obj = {a:1};\nconst other = {b:2};\nconst g = "a" + (obj + other);\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_coercible_operand')).toBe(true);
  });

  it('handles double-parenthesised inner `+`-chain without double-rewriting: `"a" + ((b + "c"))` rewrites once', async () => {
    const src = 'const b: string = "x";\nconst g = "a" + ((b + "c"));\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    // Only the outer top-level chain should match. Expect the inner `+ "c"`
    // to be flattened into the template, not separately rewritten first.
    expect(r.newContent).toContain('`a${b}c`');
    // No leftover indication of double-rewrite (no nested backticks, no
    // unexpected stray text). Count of backticks should be exactly 2.
    const backticks = (r.newContent!.match(/`/g) ?? []).length;
    expect(backticks).toBe(2);
  });

  it('handles `"a" + (("b" + c))` (inner sub-chain has its own string literal) emitting one final template literal', async () => {
    const src = 'const c: string = "x";\nconst g = "a" + (("b" + c));\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('`ab${c}`');
    const backticks = (r.newContent!.match(/`/g) ?? []).length;
    expect(backticks).toBe(2);
  });
});
