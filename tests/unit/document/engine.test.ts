import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RefactronDocumenter } from '../../../src/document/engine.js';
import { MockLLMProvider } from '../../../src/document/provider/mock.js';
import { ProviderError } from '../../../src/document/types.js';
import type { VerificationResult } from '../../../src/contracts.js';

function makeVerified(changes: Array<{ path: string; newContent: string }>): VerificationResult {
  return {
    passed: true,
    gates: {
      syntax: { passed: true, durationMs: 0 },
      imports: { passed: true, durationMs: 0 },
      tests: { passed: true, durationMs: 0 },
    },
    writableChanges: changes.map((c) => ({
      path: c.path,
      oldHash: 'dummy',
      newContent: c.newContent,
      transformId: 'format_to_fstring',
    })),
  };
}

function makeResponder(): (prompt: string) => string {
  return (prompt: string) => {
    if (prompt.includes('[REFACTRON:DOCSTRING-BATCH]')) {
      const obj: Record<string, string> = {};
      for (const m of prompt.matchAll(/^### tag (\d+) —/gm)) {
        obj[m[1] ?? '0'] = 'Generated docstring body.';
      }
      return JSON.stringify(obj);
    }
    if (prompt.includes('CHANGELOG')) {
      return '- Modernized formatting.';
    }
    return 'Generated docstring body.';
  };
}

describe('RefactronDocumenter', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'refactron-doc-engine-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('generates one docstring per changed symbol and one changelog entry', async () => {
    const filePath = path.join(tmp, 'sample.py');
    const oldText = `def foo(x):\n    return x\n`;
    const newText = `def foo(x):\n    return f"{x}"\n`;
    const originals = new Map<string, string>([[filePath, oldText]]);

    const doc = new RefactronDocumenter({
      provider: new MockLLMProvider(makeResponder()),
      model: 'mock-model',
      tokenBudget: 1000,
      cacheDir: null,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });

    const patch = await doc.document(makeVerified([{ path: filePath, newContent: newText }]));
    expect(patch.docstrings).toHaveLength(1);
    expect(patch.docstrings[0]?.file).toBe(filePath);
    expect(patch.docstrings[0]?.symbol).toBe('foo');
    expect(patch.docstrings[0]?.content).toBe('Generated docstring body.');
    expect(patch.changelogEntry).toBe('- Modernized formatting.');
  });

  it('caps batch size by the response budget so the JSON never truncates', async () => {
    const filePath = path.join(tmp, 'many.py');
    const fns = Array.from(
      { length: 12 },
      (_, i) => `def f${i}(x):\n    return x + ${i}\n`,
    ).join('\n');
    const originals = new Map<string, string>([[filePath, fns]]);

    const batchSizes: number[] = [];
    const provider = new MockLLMProvider((prompt: string) => {
      if (prompt.includes('[REFACTRON:DOCSTRING-BATCH]')) {
        const tags = [...prompt.matchAll(/^### tag (\d+) —/gm)];
        batchSizes.push(tags.length);
        const obj: Record<string, string> = {};
        for (const t of tags) obj[t[1] ?? '0'] = 'Generated docstring body.';
        return JSON.stringify(obj);
      }
      if (prompt.includes('CHANGELOG')) return '- entry';
      return 'x';
    });

    const doc = new RefactronDocumenter({
      provider,
      model: 'mock-model',
      tokenBudget: 1280, // maxBatchItems = floor(1280 / 320) = 4
      cacheDir: null,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });

    const patch = await doc.document(makeVerified([{ path: filePath, newContent: fns }]));
    expect(batchSizes.length).toBeGreaterThan(1); // 12 symbols did not fit one batch
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(4);
    expect(patch.docstrings).toHaveLength(12); // every symbol still documented
  });

  it('skips symbols that already carry a docstring', async () => {
    const filePath = path.join(tmp, 'sample.py');
    const oldText = `def foo(x):\n    """existing."""\n    return x\n`;
    const newText = `def foo(x):\n    """existing."""\n    return f"{x}"\n`;
    const originals = new Map<string, string>([[filePath, oldText]]);

    let docstringCalls = 0;
    const provider = new MockLLMProvider((prompt: string) => {
      if (prompt.includes('CHANGELOG')) return '- entry';
      docstringCalls++;
      return 'should not appear';
    });

    const doc = new RefactronDocumenter({
      provider,
      model: 'mock-model',
      tokenBudget: 1000,
      cacheDir: null,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });

    const patch = await doc.document(makeVerified([{ path: filePath, newContent: newText }]));
    expect(docstringCalls).toBe(0);
    expect(patch.docstrings).toHaveLength(0);
    expect(patch.changelogEntry).toBe('- entry');
  });

  it('falls back to a canned changelog when the provider is unreachable', async () => {
    const filePath = path.join(tmp, 'sample.py');
    const oldText = `def foo(x):\n    return x\n`;
    const newText = `def foo(x):\n    return f"{x}"\n`;
    const originals = new Map<string, string>([[filePath, oldText]]);

    const provider = new MockLLMProvider(() => {
      throw new ProviderError('unreachable', 'connection refused');
    });

    const doc = new RefactronDocumenter({
      provider,
      model: 'mock-model',
      tokenBudget: 1000,
      cacheDir: null,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });

    const patch = await doc.document(makeVerified([{ path: filePath, newContent: newText }]));
    expect(patch.docstrings).toHaveLength(0);
    expect(patch.changelogEntry).toMatch(/skipped/i);
  });

  it('caches per-symbol responses across runs in the same cacheDir', async () => {
    const filePath = path.join(tmp, 'sample.py');
    const oldText = `def foo(x):\n    return x\n`;
    const newText = `def foo(x):\n    return f"{x}"\n`;
    const originals = new Map<string, string>([[filePath, oldText]]);
    const cacheDir = path.join(tmp, 'cache');

    let calls = 0;
    const provider = new MockLLMProvider((prompt: string) => {
      calls++;
      if (prompt.includes('CHANGELOG')) return '- entry';
      return 'cached docstring';
    });

    const docA = new RefactronDocumenter({
      provider,
      model: 'mock-model',
      tokenBudget: 1000,
      cacheDir,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });
    await docA.document(makeVerified([{ path: filePath, newContent: newText }]));
    const callsAfterFirst = calls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const docB = new RefactronDocumenter({
      provider,
      model: 'mock-model',
      tokenBudget: 1000,
      cacheDir,
      redactPatterns: [],
      originals,
      projectRoot: tmp,
    });
    await docB.document(makeVerified([{ path: filePath, newContent: newText }]));
    expect(calls).toBe(callsAfterFirst);
  });
});
