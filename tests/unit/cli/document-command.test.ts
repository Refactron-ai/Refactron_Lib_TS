// tests/unit/cli/document-command.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runDocumentCommand } from '../../../src/cli/document-command.js';
import { MockLLMProvider } from '../../../src/document/provider/mock.js';
import { persistLastApply } from '../../../src/cli/last-apply.js';

const tmpDirs: string[] = [];
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.REFACTRON_TOKEN = 'dummy';
});

afterEach(async () => {
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
});
