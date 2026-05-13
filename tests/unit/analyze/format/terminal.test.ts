import { describe, it, expect } from 'vitest';
import { renderTerminal } from '../../../../src/analyze/format/terminal.js';

describe('renderTerminal', () => {
  it('renders empty report cleanly', () => {
    const out = renderTerminal({
      root: '/x',
      analyzedAt: new Date(),
      findings: [],
      importGraph: new Map(),
      callEdges: [],
    });
    expect(out).toMatch(/0 findings/i);
  });
  it('renders findings grouped by transform', () => {
    const out = renderTerminal({
      root: '/x',
      analyzedAt: new Date(),
      findings: [
        {
          id: '1',
          file: 'a.ts',
          line: 1,
          transformId: 'var_to_const_let',
          remediationMinutes: 1,
          confidence: 'high',
        },
        {
          id: '2',
          file: 'b.py',
          line: 7,
          transformId: 'format_to_fstring',
          remediationMinutes: 2,
          confidence: 'high',
        },
      ],
      importGraph: new Map(),
      callEdges: [],
    });
    expect(out).toMatch(/var_to_const_let/);
    expect(out).toMatch(/format_to_fstring/);
    expect(out).toMatch(/3 min/);
  });
});
