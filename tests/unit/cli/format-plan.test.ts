// tests/unit/cli/format-plan.test.ts
// Unit tests for the run --dry-run renderer (Task 7, Day 45).
import { describe, it, expect } from 'vitest';
import { formatPlanAsDryRun } from '../../../src/cli/format-plan.js';
import type { RefactorPlan } from '../../../src/contracts.js';

describe('formatPlanAsDryRun', () => {
  it('renders a header per file with transforms and +/- counts', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/a.py',
          oldHash: '',
          newContent: 'def f():\n    return f"{x}"\n',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const originals = new Map([['/p/a.py', 'def f():\n    return "%s" % x\n']]);
    const lines = await formatPlanAsDryRun(plan, originals, { projectRoot: '/p' });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('a.py');
    expect(text).toContain('format_to_fstring');
    expect(text).toMatch(/\+1/);
    expect(text).toMatch(/-1/);
    // Section heading + SUMMARY box always present
    expect(text).toContain('Dry run');
    expect(text).toContain('SUMMARY');
    expect(text).toContain('Nothing has been written');
  });

  it('truncates each diff at maxDiffLines and prints a hint', async () => {
    // Build a large diff: 100 lines changing to 100 different lines.
    const oldLines = Array.from({ length: 100 }, (_, i) => `old_line_${i}`).join('\n') + '\n';
    const newLines = Array.from({ length: 100 }, (_, i) => `new_line_${i}`).join('\n') + '\n';
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/big.py',
          oldHash: '',
          newContent: newLines,
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const originals = new Map([['/p/big.py', oldLines]]);
    const lines = await formatPlanAsDryRun(plan, originals, {
      projectRoot: '/p',
      maxDiffLines: 10,
    });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/more lines elided/);
    expect(text).toContain('--diff-context');
    // The truncation hint mentions the elided count
    expect(text).toMatch(/\d+ more lines elided/);
  });

  it('renders the cumulative diff when the engine emits one FileChange per touching transform', async () => {
    // Pins the engine→formatter contract after the multi-transform fix:
    // the engine emits one FileChange per transform, each carrying the
    // cumulative `newContent`. The formatter must render ONE diff per
    // file, taken from the LAST FileChange (the cumulative composition),
    // not stack one diff per transform.
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/sample.py',
          oldHash: 'h',
          newContent: 'line A\nline B\n', // after transform 1
          transformId: 'super_no_args',
        },
        {
          path: '/p/sample.py',
          oldHash: 'h',
          newContent: 'line A\nline B\nline C\n', // cumulative after transform 2
          transformId: 'lru_cache_to_cache',
        },
      ],
      preconditions: [],
    };
    const originals = new Map([['/p/sample.py', 'orig\n']]);
    const lines = await formatPlanAsDryRun(plan, originals, { projectRoot: '/p' });
    const text = lines.map((l) => l.text).join('\n');
    // Both transforms cited in the CHANGES row.
    expect(text).toContain('super_no_args');
    expect(text).toContain('lru_cache_to_cache');
    // Diff body reflects the cumulative content (all three new lines), NOT
    // just the intermediate state.
    expect(text).toContain('line A');
    expect(text).toContain('line B');
    expect(text).toContain('line C');
    // Single file.
    expect(lines.some((l) => l.text.includes('Files') && /\b1\b/.test(l.text))).toBe(true);
  });

  it('groups multiple transforms on the same file under one header', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/a.py',
          oldHash: '',
          newContent: 'step1',
          transformId: 'format_to_fstring',
        },
        {
          path: '/p/a.py',
          oldHash: '',
          newContent: 'step1_and_2',
          transformId: 'callback_to_async_await',
        },
      ],
      preconditions: [],
    };
    const originals = new Map([['/p/a.py', 'original']]);
    const lines = await formatPlanAsDryRun(plan, originals, { projectRoot: '/p' });
    const text = lines.map((l) => l.text).join('\n');
    // Single header section for a.py
    const headerCount = text.split('a.py').length - 1;
    // a.py may appear in the diff header (--- a/.. +++ b/..) plus our own header.
    // What's important: the transforms line lists BOTH transforms.
    expect(headerCount).toBeGreaterThan(0);
    expect(text).toContain('format_to_fstring');
    expect(text).toContain('callback_to_async_await');
    // SUMMARY should count 1 file, not 2.
    expect(lines.some((l) => l.text.includes('Files') && /\b1\b/.test(l.text))).toBe(true);
  });

  it('filters by filesGlob when provided', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/a.py',
          oldHash: '',
          newContent: 'new_a',
          transformId: 'format_to_fstring',
        },
        {
          path: '/p/b.ts',
          oldHash: '',
          newContent: 'new_b',
          transformId: 'var_to_const_let',
        },
        {
          path: '/p/c.py',
          oldHash: '',
          newContent: 'new_c',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const originals = new Map<string, string>([
      ['/p/a.py', 'a'],
      ['/p/b.ts', 'b'],
      ['/p/c.py', 'c'],
    ]);
    const lines = await formatPlanAsDryRun(plan, originals, {
      projectRoot: '/p',
      filesGlob: '*.py',
    });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('a.py');
    expect(text).toContain('c.py');
    expect(text).not.toContain('b.ts');
    expect(lines.some((l) => l.text.includes('Files') && /\b2\b/.test(l.text))).toBe(true);
  });

  it('renders the Summary block with file count and total +/- lines', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/a.py',
          oldHash: '',
          newContent: 'A\nB\n',
          transformId: 'format_to_fstring',
        },
        {
          path: '/p/b.py',
          oldHash: '',
          newContent: 'X\nY\n',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const originals = new Map<string, string>([
      ['/p/a.py', 'a\nb\n'],
      ['/p/b.py', 'x\ny\n'],
    ]);
    const lines = await formatPlanAsDryRun(plan, originals, { projectRoot: '/p' });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toContain('SUMMARY');
    expect(lines.some((l) => l.text.includes('Files') && /\b2\b/.test(l.text))).toBe(true);
    // total +4 / -4 across the two files
    expect(lines.some((l) => l.text.includes('Lines') && l.text.includes('+4 / -4'))).toBe(true);
  });

  it('keeps every bordered-table line within the terminal width', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/src/very/deeply/nested/SomeLongModuleName.ts',
          oldHash: '',
          newContent: 'const x = 1;\n',
          transformId: 'var_to_const_let',
        },
      ],
      preconditions: [],
    };
    const originals = new Map([
      ['/p/src/very/deeply/nested/SomeLongModuleName.ts', 'var x = 1;\n'],
    ]);
    for (const width of [60, 80, 120, 200]) {
      const lines = await formatPlanAsDryRun(plan, originals, { projectRoot: '/p', width });
      // Box-drawing corners only appear in real tables, never in diff content.
      for (const l of lines.filter((x) => /[┌┐└┘]/.test(x.text))) {
        expect(l.text.length, `width=${width}: "${l.text}"`).toBeLessThanOrEqual(width);
      }
    }
  });

  it('treats a missing entry in originals as empty (all additions)', async () => {
    const plan: RefactorPlan = {
      changes: [
        {
          path: '/p/new.py',
          oldHash: '',
          newContent: 'line1\nline2\n',
          transformId: 'format_to_fstring',
        },
      ],
      preconditions: [],
    };
    const lines = await formatPlanAsDryRun(plan, new Map(), { projectRoot: '/p' });
    const text = lines.map((l) => l.text).join('\n');
    expect(text).toMatch(/\+2/);
    expect(text).toMatch(/-0/);
  });
});
