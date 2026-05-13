// tests/e2e/document.test.ts
//
// End-to-end test for the `refactron document` command. Copies the
// python-legacy-mini fixture into a scratch dir, runs `run --apply`, then runs
// `document --apply` with REFACTRON_DOCUMENT_MOCK=1 so CI does not depend on
// a local Ollama instance or any cloud LLM. Asserts that CHANGELOG.md is
// written with the conventional header and that at least one source file
// receives a docstring.

import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');
const FIXTURE = path.resolve(__dirname, '../../fixtures/python-legacy-mini');

describe('document e2e', () => {
  it('after run --apply, document --apply inserts docstrings and writes CHANGELOG', async () => {
    try {
      await fs.access(cliPath);
    } catch {
      throw new Error(
        `dist CLI not found at ${cliPath}. Run \`npm run build\` before \`npm run test:e2e\`.`,
      );
    }

    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-e2e-'));
    await fs.cp(FIXTURE, scratch, { recursive: true });

    // 1. run --apply (existing deterministic pipeline)
    const runResult = await execa(
      'node',
      [cliPath, 'run', '--apply', '--transforms=all', scratch],
      {
        env: {
          ...process.env,
          REFACTRON_TOKEN: process.env.REFACTRON_TOKEN ?? 'sk_test_e2e_dummy',
        },
        timeout: 120_000,
        reject: false,
      },
    );
    expect(
      runResult.exitCode,
      `refactron run --apply failed.\nstdout:\n${runResult.stdout}\nstderr:\n${runResult.stderr}`,
    ).toBe(0);

    // 2. document --apply with the mock provider override
    const docResult = await execa('node', [cliPath, 'document', scratch, '--apply'], {
      env: {
        ...process.env,
        REFACTRON_TOKEN: process.env.REFACTRON_TOKEN ?? 'sk_test_e2e_dummy',
        REFACTRON_DOCUMENT_MOCK: '1',
      },
      timeout: 30_000,
      reject: false,
    });
    expect(
      docResult.exitCode,
      `refactron document --apply failed.\nstdout:\n${docResult.stdout}\nstderr:\n${docResult.stderr}`,
    ).toBe(0);

    // 3. CHANGELOG.md exists with the expected scaffold
    const changelog = await fs.readFile(path.join(scratch, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('# Changelog');

    // 4. At least one source file should now contain a docstring inserted by
    //    the engine. The chunker may skip files whose symbols are too small,
    //    so we accept any single hit.
    const candidates = ['formatting.py', 'typecheck.py', 'models.py'];
    const hits = await Promise.all(
      candidates.map(async (f) => {
        try {
          return (await fs.readFile(path.join(scratch, f), 'utf8')).includes('"""');
        } catch {
          return false;
        }
      }),
    );
    expect(hits.some((h) => h)).toBe(true);
  }, 180_000);
});
