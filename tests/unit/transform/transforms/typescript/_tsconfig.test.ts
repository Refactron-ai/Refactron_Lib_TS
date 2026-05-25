import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveTsConfigTarget,
  _clearTsConfigCache,
} from '../../../../../src/transform/transforms/typescript/_tsconfig.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

beforeEach(() => {
  _clearTsConfigCache();
});

function mktmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('_tsconfig: resolveTsConfigTarget', () => {
  it('multi-extends: finds a target in a later array entry when the first base has none', () => {
    const dir = mktmp('refactron-tsconfig-multi-');
    fs.writeFileSync(path.join(dir, 'base-a.json'), JSON.stringify({ compilerOptions: {} }));
    fs.writeFileSync(
      path.join(dir, 'base-b.json'),
      JSON.stringify({ compilerOptions: { target: 'ES5' } }),
    );
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: ['./base-a.json', './base-b.json'] }),
    );
    const abs = path.join(dir, 'f.ts');
    expect(resolveTsConfigTarget({ absPath: abs })).toBe('es5');
  });

  it('multi-extends: when both bases have a target, the FIRST one wins (matches "first non-null" doc comment)', () => {
    const dir = mktmp('refactron-tsconfig-multi-first-');
    fs.writeFileSync(
      path.join(dir, 'base-a.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2020' } }),
    );
    fs.writeFileSync(
      path.join(dir, 'base-b.json'),
      JSON.stringify({ compilerOptions: { target: 'ES5' } }),
    );
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: ['./base-a.json', './base-b.json'] }),
    );
    const abs = path.join(dir, 'f.ts');
    expect(resolveTsConfigTarget({ absPath: abs })).toBe('es2020');
  });

  it('multi-extends with a cycle does not hang or stack-overflow', () => {
    const dir = mktmp('refactron-tsconfig-cycle-');
    // a extends [b, c]; b extends a (cycle); c has target ES2018.
    fs.writeFileSync(
      path.join(dir, 'b.json'),
      JSON.stringify({ extends: './a.json', compilerOptions: {} }),
    );
    fs.writeFileSync(
      path.join(dir, 'c.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2018' } }),
    );
    fs.writeFileSync(
      path.join(dir, 'a.json'),
      JSON.stringify({ extends: ['./b.json', './c.json'] }),
    );
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ extends: './a.json' }));
    const abs = path.join(dir, 'f.ts');
    // Should terminate. The exact value depends on traversal order, but it
    // must not hang. We accept either es2018 (if it walks c after the cycle
    // dead-ends on b) or null (if it bails). What matters most is no hang.
    const t = resolveTsConfigTarget({ absPath: abs });
    expect(t === 'es2018' || t === null).toBe(true);
  });
});
