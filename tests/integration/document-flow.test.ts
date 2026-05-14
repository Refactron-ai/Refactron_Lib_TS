// tests/integration/document-flow.test.ts
//
// Integration test for the full Week 6 documentation flow, end-to-end against
// a tmpdir fixture using MockLLMProvider (no Ollama / network needed).
//
// Verifies that RefactronDocumenter produces a DocPatch which, when applied
// via insertDocstring + appendChangelog, leaves the source file self-
// documenting and creates a CHANGELOG.md with the canned bullet.

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronDocumenter } from '../../src/document/engine.js';
import { MockLLMProvider } from '../../src/document/provider/mock.js';
import { insertDocstring, appendChangelog } from '../../src/document/apply.js';
import type { VerificationResult } from '../../src/contracts.js';

const tmp: string[] = [];
afterEach(async () => {
  // Windows: write-file-atomic uses temp+rename and may briefly hold file
  // handles after writeFile resolves. fs.rm with maxRetries reties the rmdir
  // a few times if it hits ENOTEMPTY/EBUSY before failing the test cleanup.
  for (const d of tmp.splice(0)) {
    await fs.rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('document flow', () => {
  // 30s per-test timeout: the doc engine spins up + chunker + provider call
  // + write-file-atomic round-trip; on a cold Windows CI runner this exceeds
  // vitest's default 5s. Comfortable headroom + still fast on macOS/Linux.
  it('produces a DocPatch that, when applied, makes the file self-documenting', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-'));
    tmp.push(root);
    const filePath = path.join(root, 'a.py');
    const newContent = 'def fetch(url):\n    return get(f"{url}")\n';
    await fs.writeFile(filePath, newContent);
    const cacheDir = path.join(root, '.refactron', 'cache', 'llm');
    await fs.mkdir(cacheDir, { recursive: true });

    const documenter = new RefactronDocumenter({
      provider: new MockLLMProvider((p) =>
        p.includes('CHANGELOG')
          ? '- migrated old-style formatting'
          : 'Fetch the URL and return the body.',
      ),
      model: 'mock',
      tokenBudget: 4000,
      cacheDir,
      redactPatterns: [],
      originals: new Map([[filePath, 'def fetch(url):\n    return get(url)\n']]),
    });

    const verified: VerificationResult = {
      passed: true,
      gates: {
        syntax: { passed: true, durationMs: 1 },
        imports: { passed: true, durationMs: 1 },
        tests: { passed: true, durationMs: 1 },
      },
      writableChanges: [
        {
          path: filePath,
          oldHash: 'x',
          newContent,
          transformId: 'format_to_fstring',
        },
      ],
    };

    const patch = await documenter.document(verified);
    expect(patch.docstrings).toHaveLength(1);

    // Apply
    let src = newContent;
    for (const d of patch.docstrings) {
      src = insertDocstring('python', src, d.symbol, d.content);
    }
    await fs.writeFile(filePath, src);
    const cl = appendChangelog('', [patch.changelogEntry], '2026-05-13');
    await fs.writeFile(path.join(root, 'CHANGELOG.md'), cl);

    expect(await fs.readFile(filePath, 'utf8')).toContain('"""Fetch the URL');
    expect(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain(
      'old-style formatting',
    );
  }, 30_000);
});
