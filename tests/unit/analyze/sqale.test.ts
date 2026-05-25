import { describe, it, expect } from 'vitest';
import {
  totalRemediationMinutes,
  REMEDIATION_MINUTES_BY_TRANSFORM,
} from '../../../src/analyze/sqale.js';

describe('sqale', () => {
  it('declares one cost per TransformId', () => {
    // Updated for v0.3.0 Phase 3: +2 IDs (datetime_utc_alias, yield_from_for_loop)
    // on top of Phase 2's additions.
    expect(Object.keys(REMEDIATION_MINUTES_BY_TRANSFORM).length).toBe(16);
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
