import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatAnalysisReport } from '../../../src/cli/format-analysis.js';
import type { ExtendedAnalysisReport } from '../../../src/analyze/engine.js';
import type { DetectorFinding } from '../../../src/analyze/detectors/types.js';

const tmp: string[] = [];
afterEach(async () => {
  for (const d of tmp.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

function synthReport(root: string, findings: DetectorFinding[]): ExtendedAnalysisReport {
  return {
    root,
    findings,
    analyzedAt: new Date(),
    importGraph: new Map(),
    callEdges: [],
  };
}

describe('formatAnalysisReport', () => {
  it('groups findings by file (not by severity)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    await fs.writeFile(path.join(root, 'a.py'), 'def f():\n    return "%s" % x\n');
    const report = synthReport(root, [
      {
        id: '1',
        file: 'a.py',
        line: 2,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('a.py');
    expect(text).toMatch(/format_to_fstring/);
    expect(text).toContain('return "%s" % x'); // source excerpt
  });

  it('shows transform name + suggestion from v2-adapters', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    await fs.writeFile(path.join(root, 'a.py'), 'def f(callback):\n    callback(1)\n');
    const report = synthReport(root, [
      {
        id: '1',
        file: 'a.py',
        line: 1,
        transformId: 'callback_to_async_await',
        remediationMinutes: 7,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('callback_to_async_await');
    expect(text).toMatch(/suggestion:/);
    expect(text).toContain('async'); // suggestion mentions async
  });

  it('shows a "No findings." message when empty', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    const report = synthReport(root, []);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    expect(lines.some((l) => l.text.includes('No findings'))).toBe(true);
  });

  it('falls back gracefully when the file cannot be read', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    const report = synthReport(root, [
      {
        id: '1',
        file: 'missing.py',
        line: 1,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('missing.py');
    expect(text).toContain('(source unavailable)');
  });

  it('emits a Summary block with by-file / by-transform / by-severity / fixable counts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    await fs.writeFile(path.join(root, 'a.py'), 'def f():\n    pass\n');
    await fs.writeFile(path.join(root, 'b.py'), 'def g():\n    pass\n');
    const report = synthReport(root, [
      {
        id: '1',
        file: 'a.py',
        line: 1,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
      {
        id: '2',
        file: 'b.py',
        line: 1,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'medium',
      },
      {
        id: '3',
        file: 'a.py',
        line: 1,
        transformId: 'class_to_dataclass',
        remediationMinutes: 3,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('Summary');
    expect(text).toMatch(/Files affected\s+2/);
    expect(text).toMatch(/format_to_fstring:\s*2/);
    expect(text).toMatch(/class_to_dataclass:\s*1/);
    expect(text).toMatch(/2 high/);
    expect(text).toMatch(/1 medium/);
  });

  it('sorts findings within a file by line number (gauntlet G2)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    // Three lines, one finding per line, supplied in non-source order (16, 9, 12)
    // — the formatter must reorder them ascending so the user reads top-to-bottom.
    await fs.writeFile(
      path.join(root, 'a.py'),
      Array.from({ length: 20 }, (_, i) => `# line ${i + 1}`).join('\n'),
    );
    const report = synthReport(root, [
      {
        id: '1',
        file: 'a.py',
        line: 16,
        transformId: 'callback_to_async_await',
        remediationMinutes: 7,
        confidence: 'high',
      },
      {
        id: '2',
        file: 'a.py',
        line: 9,
        transformId: 'callback_to_async_await',
        remediationMinutes: 7,
        confidence: 'high',
      },
      {
        id: '3',
        file: 'a.py',
        line: 12,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    const text = lines.map((l) => l.text).join('\n');
    // Match the formatter's specific "transform: X · line N" header line
    // (avoids matching "# line N" content inside the source excerpts below).
    const lineRefs = [...text.matchAll(/transform: \S+\s+·\s+line (\d+)/g)].map((m) =>
      Number(m[1]),
    );
    expect(lineRefs).toEqual([9, 12, 16]);
  });
});
