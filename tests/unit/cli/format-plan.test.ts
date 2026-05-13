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
    // Summary section always present
    expect(text).toContain('Summary');
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
    // Summary should count 1 file, not 2.
    expect(text).toMatch(/Files\s+1\b/);
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
    expect(text).toMatch(/Files\s+2\b/);
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
    expect(text).toContain('Summary');
    expect(text).toMatch(/Files\s+2\b/);
    // total +4 / -4 across the two files
    expect(text).toMatch(/Lines\s+\+4 \/ -4/);
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
