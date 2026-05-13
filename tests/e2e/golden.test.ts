// tests/e2e/golden.test.ts
//
// This is the v2.0 binary success target. It is INTENTIONALLY RED until Week 4
// lands the deterministic refactoring engine + the `refactron run --apply`
// subcommand. Today the failure must be for the RIGHT reason: the `run`
// subcommand does not exist in the CLI yet, so execa returns a non-zero exit
// code. Once Week 4 wires the engine, every gate below (test, syntax, import,
// deterministic-diff snapshot) must pass with zero edits to this file.

import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTwoFilesPatch } from 'diff';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKIP_DIRS = new Set(['__pycache__', '.pytest_cache', '.refactron', 'node_modules', '.git']);

async function resolvePython(): Promise<string> {
  for (const candidate of ['python3', 'python']) {
    const r = await execa(candidate, ['--version'], { reject: false });
    if (r.exitCode === 0) return candidate;
  }
  throw new Error('No python interpreter found on PATH (tried python3, python).');
}

async function walkPyFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        results.push(full);
      }
    }
  }
  await walk(root);
  return results.sort();
}

async function snapshotPyTree(root: string): Promise<Map<string, string>> {
  const files = await walkPyFiles(root);
  const snap = new Map<string, string>();
  for (const abs of files) {
    const rel = path.relative(root, abs);
    snap.set(rel, await fs.readFile(abs, 'utf8'));
  }
  return snap;
}

describe('refactron golden e2e', () => {
  it('run --apply produces verified, behavior-preserving output on python-legacy-mini', async () => {
    const fixture = path.resolve(__dirname, '../../fixtures/python-legacy-mini');
    const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');

    // dist must be built before this test runs. Fail loudly rather than
    // silently passing/skipping if the build step was forgotten.
    try {
      await fs.access(cliPath);
    } catch {
      throw new Error(
        `dist CLI not found at ${cliPath}. Run \`npm run build\` before \`npm run test:e2e\`.`,
      );
    }

    const python = await resolvePython();

    // 1. Copy fixture to a scratch dir
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-golden-'));
    await fs.cp(fixture, scratch, { recursive: true });

    // 2. Snapshot BEFORE
    const before = await snapshotPyTree(scratch);
    expect(before.size).toBeGreaterThan(0);

    // 3. Baseline pytest must pass — protects against fixture rot
    const baseline = await execa(python, ['-m', 'pytest', '-q'], {
      cwd: scratch,
      reject: false,
    });
    if (baseline.exitCode !== 0) {
      throw new Error(
        `Fixture baseline is broken (pytest exit ${baseline.exitCode}). ` +
          `Fix fixtures/python-legacy-mini before depending on this test.\n` +
          `stdout:\n${baseline.stdout}\nstderr:\n${baseline.stderr}`,
      );
    }

    // 4. Invoke the v2.0 CLI with the full transform set. Week 5's cross-file
    //    preconditions (analyzer's importGraph + callEdges piped to transforms)
    //    make `callback_to_async_await` and `deprecated_api_requests_to_httpx`
    //    safely skip themselves on files referenced from test code, rather than
    //    producing broken output. The other transforms apply as before.
    const cli = await execa(
      'node',
      [cliPath, 'run', '--apply', '--transforms=all', scratch],
      {
        reject: false,
        timeout: 90_000,
        input: '',
      },
    );

    // 5. CLI gate — Week 4 closes the pipeline; this assertion now expects success.
    expect(
      cli.exitCode,
      `refactron run --apply failed.\nstdout:\n${cli.stdout}\nstderr:\n${cli.stderr}`,
    ).toBe(0);

    // 6. Test gate — re-run pytest on the mutated scratch tree
    const post = await execa(python, ['-m', 'pytest', '-q'], {
      cwd: scratch,
      reject: false,
    });
    expect(
      post.exitCode,
      `pytest failed on refactored tree.\nstdout:\n${post.stdout}\nstderr:\n${post.stderr}`,
    ).toBe(0);

    // 7. Deterministic-diff snapshot
    const after = await snapshotPyTree(scratch);
    const allKeys = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
    const diffs: string[] = [];
    for (const rel of allKeys) {
      const a = before.get(rel) ?? '';
      const b = after.get(rel) ?? '';
      if (a === b) continue;
      diffs.push(createTwoFilesPatch(rel, rel, a, b, '', '', { context: 3 }));
    }
    const combinedDiff = diffs.join('\n');
    expect(combinedDiff).toMatchSnapshot();

    // 8. Syntax gate — every .py file (excluding tests/) must still parse
    for (const rel of after.keys()) {
      if (rel.startsWith('tests/') || rel.startsWith(`tests${path.sep}`)) continue;
      const abs = path.join(scratch, rel);
      const parse = await execa(
        python,
        ['-c', 'import ast, sys; ast.parse(open(sys.argv[1]).read())', abs],
        { reject: false },
      );
      expect(parse.exitCode, `Syntax gate failed for ${rel}: ${parse.stderr}`).toBe(0);
    }

    // 9. Import gate
    const importCheck = await execa(
      python,
      ['-c', 'import callbacks, formatting, typecheck, legacy_http, models, utils'],
      { cwd: scratch, reject: false },
    );
    expect(
      importCheck.exitCode,
      `Import gate failed.\nstdout:\n${importCheck.stdout}\nstderr:\n${importCheck.stderr}`,
    ).toBe(0);
  }, 120_000);
});
