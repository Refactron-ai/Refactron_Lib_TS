import { describe, it, expect } from 'vitest';
import { transform } from '../../../../../src/transform/transforms/typescript/commonjs.js';

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

describe('commonjs_to_esm (typescript)', () => {
  it('rewrites a default require + module.exports object', async () => {
    const src = [
      "const path = require('path');",
      'const joinPath = (a, b) => path.join(a, b);',
      'module.exports = { joinPath };',
      '',
    ].join('\n');
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    // Node builtins get the `node:` prefix per modern ESM convention.
    expect(r.newContent).toContain("import path from 'node:path';");
    expect(r.newContent).toContain('export { joinPath };');
    expect(r.newContent).not.toMatch(/module\.exports/);
    expect(r.newContent).not.toMatch(/=\s*require\(/);
  });

  it('rewrites destructured require to named import (with node: prefix for builtins)', async () => {
    const src = "const { join } = require('path');\n";
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain("import { join } from 'node:path';");
  });

  it('leaves user-module specifiers unprefixed', async () => {
    const src = "const x = require('./utils');\nmodule.exports = x;\n";
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain("import x from './utils';");
  });

  it('leaves package specifiers unprefixed', async () => {
    const src = "const lodash = require('lodash');\nmodule.exports = lodash;\n";
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain("import lodash from 'lodash';");
  });

  it('rewrites module.exports = identifier to export default', async () => {
    const src = 'const x = 1;\nmodule.exports = x;\n';
    const r = await run(src);
    expect(r.newContent).not.toBeNull();
    expect(r.newContent).toContain('export default x;');
  });

  it('refuses to rewrite when __dirname is used', async () => {
    const src = 'const p = __dirname;\nmodule.exports = p;\n';
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'node-globals')).toBe(true);
  });

  it('refuses to rewrite when require is dynamic', async () => {
    const src = "const name = 'x';\nconst y = require(name);\n";
    const r = await run(src);
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'dynamic-require')).toBe(true);
  });

  it('refuses to rewrite .cjs files', async () => {
    const src = "const x = require('y');\n";
    const r = await run(src, 'f.cjs');
    expect(r.newContent).toBeNull();
    expect(r.preconditions.some((p) => p.id === 'cjs-extension')).toBe(true);
  });
});
