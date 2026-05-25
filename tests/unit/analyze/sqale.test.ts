import { describe, it, expect } from 'vitest';
import {
  totalRemediationMinutes,
  REMEDIATION_MINUTES_BY_TRANSFORM,
} from '../../../src/analyze/sqale.js';

describe('sqale', () => {
  it('declares one cost per TransformId', () => {
    // Updated for v0.3.0 Phase 2: +2 IDs (pep585_generics, pep604_optional_union)
    // on top of the Phase 1 additions (super_no_args, lru_cache_to_cache).
    expect(Object.keys(REMEDIATION_MINUTES_BY_TRANSFORM).length).toBe(14);
  });
  it('sums findings', () => {
    expect(
      totalRemediationMinutes([
        {
          id: '1',
          file: 'a',
          line: 1,
          transformId: 'var_to_const_let',
          remediationMinutes: 1,
        },
        {
          id: '2',
          file: 'a',
          line: 2,
          transformId: 'var_to_const_let',
          remediationMinutes: 1,
        },
      ]),
    ).toBe(2);
  });
});
