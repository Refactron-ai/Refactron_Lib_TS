import { describe, it, expect, beforeEach } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/object-assign-to-spread.js';
import { _clearTsConfigCache } from '../../../../../src/transform/transforms/typescript/_tsconfig.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

beforeEach(() => {
  _clearTsConfigCache();
});

async function run(src: string, name = 'f.ts'): ReturnType<typeof transform> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-obj-assign-'));
  const abs = path.join(dir, name);
  return transform({
    absPath: abs,
    relPath: name,
    source: src,
    findings: [],
  });
}

describe('object_assign_to_spread (typescript)', () => {
  it('rewrites Object.assign({}, a, b)', async () => {
    const src = 'const a = {x:1}; const b = {y:2};\nconst r = Object.assign({}, a, b);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('{ ...a, ...b }');
    expect(r.newContent).not.toContain('Object.assign');
  });

  it('inlines literal source properties', async () => {
    const src = 'const a = {x:1};\nconst r = Object.assign({}, a, { y: 2 });\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('{ ...a, y: 2 }');
  });

  it('preserves first-arg literal properties', async () => {
    const src = 'const a = {x:1};\nconst r = Object.assign({ base: 1 }, a);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('{ base: 1, ...a }');
  });

  it('refuses non-literal target with non_literal_target', async () => {
    const src = 'const obj = {}; const a = {x:1};\nObject.assign(obj, a);\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_literal_target')).toBe(true);
  });

  it('refuses spread arguments with spread_argument_present', async () => {
    const src = 'const sources: object[] = [];\nObject.assign({}, ...sources);\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'spread_argument_present')).toBe(true);
  });

  it('refuses on tsconfig target ES2017 with non_es2018', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactron-obj-assign-es2017-'));
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2017' } }),
    );
    const abs = path.join(dir, 'f.ts');
    const r = await transform({
      absPath: abs,
      relPath: 'f.ts',
      source: 'const a = {};\nconst r = Object.assign({}, a);\n',
      findings: [],
    });
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'non_es2018')).toBe(true);
  });

  it('wraps in parens when used as arrow function body', async () => {
    const src = 'const a = {x:1};\nconst f = () => Object.assign({}, a);\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('() => ({ ...a })');
  });

  it('returns null when there are no Object.assign calls', async () => {
    const r = await run('const x = 1;\n');
    expect(r.newContent).toBeNull();
  });

  it('ignores My.assign (not Object.assign)', async () => {
    const src = 'const My = { assign: (..._: unknown[]) => 0 };\nMy.assign({}, {});\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
  });
});
