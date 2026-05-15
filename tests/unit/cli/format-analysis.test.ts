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

  it('lists each transform with its guidance in the TRANSFORMS legend', async () => {
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
    // Per-transform guidance lives in a single legend, not repeated per row.
    expect(text).toContain('TRANSFORMS');
    expect(text).toContain('async'); // the guidance mentions async/await
  });

  it('renders one compact row per finding — no multi-line excerpt block', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    await fs.writeFile(
      path.join(root, 'a.py'),
      [
        'def fetch_user(user_id, callback):',
        '    result = lookup(user_id)',
        '    callback(result)',
        '',
      ].join('\n'),
    );
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
    // Wide width so the code cell is not clipped by the terminal-fit logic.
    const lines = await formatAnalysisReport(report, { projectRoot: root, width: 200 });
    // Exactly one rendered line carries the finding's code cell — the single
    // table row. The old formatter emitted a multi-line excerpt block.
    const rowsWithCode = lines.filter((l) => l.text.includes('def fetch_user(user_id, callback):'));
    expect(rowsWithCode.length).toBe(1);
    // And no surrounding context lines are pulled in.
    const text = lines.map((l) => l.text).join('\n');
    expect(text).not.toContain('callback(result)');
  });

  it('every rendered line fits within the given width — no wrap at any terminal size', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    // A deeply nested path + a long source line + the longest transform id
    // (promise_constructor_to_async, 28 chars) — maximum truncation pressure
    // on every flexible column.
    const deep = 'src/very/deeply/nested/components/SomeReallyLongComponentName.tsx';
    await fs.mkdir(path.join(root, path.dirname(deep)), { recursive: true });
    await fs.writeFile(
      path.join(root, deep),
      'const result = someVeryLongFunctionCall(argumentOne, argumentTwo, argumentThree, argumentFour);\n',
    );
    const report = synthReport(root, [
      {
        id: '1',
        file: deep,
        line: 1,
        transformId: 'promise_constructor_to_async',
        remediationMinutes: 5,
        confidence: 'high',
      },
    ]);
    for (const width of [60, 80, 100, 120, 200]) {
      const lines = await formatAnalysisReport(report, { projectRoot: root, width });
      for (const l of lines) {
        // Box-drawing chars and `…` are single display-width — .length is exact.
        expect(l.text.length, `width=${width} overflowed: "${l.text}"`).toBeLessThanOrEqual(width);
      }
    }
  });

  it('renders one bordered box per file, separated by a blank line', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fa-'));
    tmp.push(root);
    await fs.writeFile(path.join(root, 'a.py'), 'def f():\n    return "%s" % x\n');
    await fs.writeFile(path.join(root, 'b.py'), 'def g():\n    return "%s" % y\n');
    const report = synthReport(root, [
      {
        id: '1',
        file: 'a.py',
        line: 2,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
      {
        id: '2',
        file: 'b.py',
        line: 2,
        transformId: 'format_to_fstring',
        remediationMinutes: 1,
        confidence: 'high',
      },
    ]);
    const lines = await formatAnalysisReport(report, { projectRoot: root });
    // Two files → two box top-borders.
    const topBorders = lines.filter((l) => l.text.includes('┌'));
    expect(topBorders.length).toBe(2);
    // The first box's bottom border is followed by a blank line, then the
    // second file's heading.
    const firstBottom = lines.findIndex((l) => l.text.includes('└'));
    expect(lines[firstBottom + 1]?.text).toBe('');
    expect(lines[firstBottom + 2]?.text).toContain('b.py');
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
    expect(text).toContain('(no source)');
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
    // Each finding's row carries its own source line as the code cell
    // (`# line 9`, `# line 12`, `# line 16`). Ascending source order means
    // those cells appear in that order in the rendered table.
    const p9 = text.indexOf('# line 9');
    const p12 = text.indexOf('# line 12');
    const p16 = text.indexOf('# line 16');
    expect(p9).toBeGreaterThan(-1);
    expect(p9).toBeLessThan(p12);
    expect(p12).toBeLessThan(p16);
  });
});
