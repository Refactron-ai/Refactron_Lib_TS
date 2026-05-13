import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runPythonTransform } from '../../../src/transform/runner.js';

async function tmp(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpt-'));
  const p = path.join(dir, 'f.py');
  await fs.writeFile(p, content);
  return p;
}

// Forward-slash the path so the inlined Python string doesn't interpret
// Windows backslashes as escape sequences (e.g. `\a`, `\t`). Python on
// Windows accepts forward slashes in paths.
const PY_DIR = path.resolve('src/transform/transforms/python/_py').replace(/\\/g, '/');

// A stub sidecar inlined for the test — just echoes source unchanged with empty preconditions.
const STUB = `
import sys
sys.path.insert(0, '${PY_DIR}')
from _base import read_source, emit
emit(ok=True, new_content=read_source(sys.argv[1]), preconditions=[])
`;

describe('runPythonTransform', () => {
  it('returns parsed JSON on sidecar success', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpt-side-'));
    const sidecar = path.join(dir, 'stub.py');
    await fs.writeFile(sidecar, STUB);
    const src = await tmp('x = 1\n');
    const r = await runPythonTransform(sidecar, src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newContent).toBe('x = 1\n');
  });
  it('returns error result on sidecar exit 1', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rpt-err-'));
    const sidecar = path.join(dir, 'bad.py');
    await fs.writeFile(
      sidecar,
      `import sys; sys.stdout.write('{"ok":false,"error":"boom"}'); sys.exit(1)`,
    );
    const src = await tmp('x = 1\n');
    const r = await runPythonTransform(sidecar, src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/boom/);
  });
});
