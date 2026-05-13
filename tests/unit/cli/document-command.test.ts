// tests/unit/cli/document-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runDocumentCommand } from '../../../src/cli/document-command.js';
import { MockLLMProvider } from '../../../src/document/provider/mock.js';
import { persistLastApply } from '../../../src/cli/last-apply.js';

const tmpDirs: string[] = [];
let savedEnv: NodeJS.ProcessEnv;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.REFACTRON_TOKEN = 'dummy';
  // runDocumentCommand prints summaries to stdout and error messages to stderr.
  // When the verification engine's test gate runs this suite on a shadow tree,
  // those writes leak through vitest's reporter into the parent terminal and
  // make `run --apply` look like it invoked `document`. Silence both channels
  // for the duration of each test.
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(async () => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
  process.env = { ...savedEnv };
});

async function mkTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-'));
  tmpDirs.push(d);
  return d;
}

describe('runDocumentCommand', () => {
  it('exits 8 when no last-apply snapshot exists', async () => {
    const root = await mkTmp();
    const code = await runDocumentCommand([root]);
    expect(code).toBe(8);
  });

  it('exits 0 dry-run with mock provider and writes nothing', async () => {
    const root = await mkTmp();
    const filePath = path.join(root, 'a.py');
    await fs.writeFile(filePath, 'def f():\n    return 2\n');
    await persistLastApply({
      projectRoot: root,
      verifiedAt: new Date().toISOString(),
      changes: [
        {
          path: filePath,
          oldContent: 'def f():\n    return 1\n',
          newContent: 'def f():\n    return 2\n',
          transformId: 'format_to_fstring',
        },
      ],
    });
    const code = await runDocumentCommand([root], {
      providerOverride: new MockLLMProvider(() => 'Return two.'),
    });
    expect(code).toBe(0);
    // Verify NO docstring was inserted (dry-run).
    expect(await fs.readFile(filePath, 'utf8')).toBe('def f():\n    return 2\n');
    // No CHANGELOG was created.
    await expect(fs.access(path.join(root, 'CHANGELOG.md'))).rejects.toBeDefined();
  });

  it('--apply writes docstrings and creates CHANGELOG.md', async () => {
    const root = await mkTmp();
    const filePath = path.join(root, 'a.py');
    await fs.writeFile(filePath, 'def f():\n    return 2\n');
    await persistLastApply({
      projectRoot: root,
      verifiedAt: new Date().toISOString(),
      changes: [
        {
          path: filePath,
          oldContent: 'def f():\n    return 1\n',
          newContent: 'def f():\n    return 2\n',
          transformId: 'format_to_fstring',
        },
      ],
    });
    const code = await runDocumentCommand([root, '--apply'], {
      providerOverride: new MockLLMProvider((p) =>
        p.includes('CHANGELOG') ? '- single transform applied' : 'Return two.',
      ),
    });
    expect(code).toBe(0);
    expect(await fs.readFile(filePath, 'utf8')).toContain('"""Return two."""');
    expect(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).toContain(
      'single transform applied',
    );
  });

  it('routes all output through deps.out when provided (REPL bridge)', async () => {
    // Regression for the bug where the REPL invoked runDocumentCommand and
    // the raw process.stdout.write calls vanished into Ink's render buffer.
    // With deps.out the REPL captures the stream and re-emits via onLine.
    const root = await mkTmp();
    const filePath = path.join(root, 'a.py');
    await fs.writeFile(filePath, 'def f():\n    return 2\n');
    await persistLastApply({
      projectRoot: root,
      verifiedAt: new Date().toISOString(),
      changes: [
        {
          path: filePath,
          oldContent: 'def f():\n    return 1\n',
          newContent: 'def f():\n    return 2\n',
          transformId: 'format_to_fstring',
        },
      ],
    });
    const captured: Array<{ text: string; stream: 'stdout' | 'stderr' }> = [];
    const code = await runDocumentCommand([root], {
      providerOverride: new MockLLMProvider((p) =>
        p.includes('CHANGELOG') ? '- entry' : 'Return two.',
      ),
      out: (text, stream) => captured.push({ text, stream }),
    });
    expect(code).toBe(0);
    // Default process.stdout.write should NOT have been called when out is provided.
    expect(stdoutSpy).not.toHaveBeenCalled();
    // The dry-run summary lines all routed through the sink.
    const stdoutChunks = captured.filter((c) => c.stream === 'stdout').map((c) => c.text);
    expect(stdoutChunks.some((t) => t.includes('docstring(s) ready'))).toBe(true);
    expect(stdoutChunks.some((t) => t.includes('CHANGELOG entry'))).toBe(true);
  });

  it('routes the no-snapshot error through deps.out as stderr', async () => {
    const root = await mkTmp();
    const captured: Array<{ text: string; stream: 'stdout' | 'stderr' }> = [];
    const code = await runDocumentCommand([root], {
      out: (text, stream) => captured.push({ text, stream }),
    });
    expect(code).toBe(8);
    expect(stderrSpy).not.toHaveBeenCalled();
    const stderrChunks = captured.filter((c) => c.stream === 'stderr').map((c) => c.text);
    expect(stderrChunks.some((t) => t.includes('No verified refactor'))).toBe(true);
  });
});
