import { describe, it, expect } from 'vitest';
import { applyLineInsertions } from '../../../src/document/line-edits.js';

describe('applyLineInsertions', () => {
  it('inserts above the given 1-indexed line', () => {
    expect(applyLineInsertions('a\nb\nc', [{ line: 2, lines: ['X'] }])).toBe('a\nX\nb\nc');
  });

  it('applies bottom-up so earlier inserts never shift later anchors', () => {
    const out = applyLineInsertions('a\nb\nc', [
      { line: 1, lines: ['X'] },
      { line: 3, lines: ['Y'] },
    ]);
    expect(out).toBe('X\na\nb\nY\nc');
  });

  it('is order-independent', () => {
    const forward = applyLineInsertions('a\nb\nc', [
      { line: 1, lines: ['X'] },
      { line: 3, lines: ['Y'] },
    ]);
    const reverse = applyLineInsertions('a\nb\nc', [
      { line: 3, lines: ['Y'] },
      { line: 1, lines: ['X'] },
    ]);
    expect(forward).toBe(reverse);
  });

  it('inserts multi-line blocks intact', () => {
    expect(applyLineInsertions('a\nb', [{ line: 2, lines: ['X', 'Y'] }])).toBe('a\nX\nY\nb');
  });

  it('returns the source unchanged for no insertions', () => {
    expect(applyLineInsertions('a\nb', [])).toBe('a\nb');
  });
});
