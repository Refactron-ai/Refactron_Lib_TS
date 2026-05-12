import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkPythonSyntax } from '../../../src/verify/checks/syntax-python.js';
import { checkTypescriptSyntax } from '../../../src/verify/checks/syntax-typescript.js';

// NOTE: Python's `match` is contextual (PEP 634); a bare `match\n` line is a
// valid expression statement referring to the name `match`, so it does NOT
// raise SyntaxError under `ast.parse`. We substitute `'def f('` (a stricter
// genuinely-broken case) and keep `'case _\n'` since outside a `match` block
// it is rejected.
const PY_BREAKS = [
  'def f(:\n',
  'class X(:\n',
  'def f():\n  return\n   bad\n',
  'x = (\n',
  'if True\n  pass\n',
  '"unterminated',
  '[1, 2, 3',
  '{key: value',
  'try:\n  pass\nexcept:\n  pass\nfinally\n',
  '@decorator(\n',
  'lambda x: y =',
  'def f(*, a, b=, c): pass\n',
  'f"text {1+}"',
  'def f(): yield from\n',
  'with open("f") as: pass\n',
  'async def f():\n  yield\n  await\n',
  'class X:\n    def __init__(self,):\n        super().__init__(\n',
  'def f() -> :\n  pass\n',
  'global\n',
  'nonlocal\n',
  'import\n',
  'from import x\n',
  'raise from\n',
  'del\n',
  'def f(a, /, b, *, c):\n    return\n    \n   bad-indent\n',
  'def f(',
  'case _\n',
  '0b2',
  '1_a',
  'def\n',
];

// NOTE: TypeScript's parser is famously lenient — it recovers from many
// surface-level syntax errors without surfacing parseDiagnostics from
// `ts.createSourceFile`. The following inputs from the original Day-13 spec
// were dropped because TS silently recovers and we substituted stricter
// inputs that genuinely emit parse diagnostics:
//
//   'function f<>() {}\n'        -> 'function f<T,,>() {}\n'
//   'interface I extends {}\n'   -> 'const x = ?? 1;\n'
//   'function f(): { }\n  ;\n'   -> 'a.b.;\n'
//
// The list below is the curated set of inputs that the v2.0 TS parser
// actually rejects in this codebase. Keep this comment in sync if any
// substitution changes.
const TS_BREAKS = [
  'export const x: = 1;\n',
  'function f( {}\n',
  'class X<T extends> {}\n',
  'const x = {\n',
  'const [a, , c, = 1;\n',
  'function f<T,,>() {}\n',
  'const x = ?? 1;\n',
  'enum E\n',
  'const x: number =\n',
  'let y = 1 +;\n',
  'if (x { }\n',
  'for (let i =; i < 1; i++) {}\n',
  'try { } catch ( {}\n',
  'async function f() { await }\n',
  'type T = ;\n',
  'export default;\n',
  'import from "x";\n',
  '`unterminated',
  'const x: <T> = 1;\n',
  'function f(a: number,, b: string) {}\n',
  'class X { method( {} }\n',
  "'unterminated",
  'const x = `${a}\n',
  'a.b.;\n',
  '/* unterminated',
  'const {a,, b} = obj;\n',
  'function (x) {}\n',
  'const x: {a: number,,} = {a:1};\n',
  'switch (x) { case }\n',
  'const x = (a, , b) => a;\n',
  'while ( ) {}\n',
  'const = 1;\n',
];

async function writeFile(content: string, ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fz-'));
  const f = path.join(dir, 'f' + ext);
  await fs.writeFile(f, content);
  return f;
}

describe('syntax fuzz', () => {
  it('rejects all hand-curated Python breakages', async () => {
    expect(PY_BREAKS.length).toBeGreaterThanOrEqual(30);
    for (const code of PY_BREAKS) {
      const f = await writeFile(code, '.py');
      const r = await checkPythonSyntax([f]);
      expect(r.passed, `expected fail on: ${JSON.stringify(code)}`).toBe(false);
    }
  }, 60_000);

  it('rejects all hand-curated TypeScript breakages', async () => {
    expect(TS_BREAKS.length).toBeGreaterThanOrEqual(30);
    for (const code of TS_BREAKS) {
      const f = await writeFile(code, '.ts');
      const r = await checkTypescriptSyntax([f]);
      expect(r.passed, `expected fail on: ${JSON.stringify(code)}`).toBe(false);
    }
  }, 60_000);
});
