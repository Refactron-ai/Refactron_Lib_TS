import { describe, it, expect } from 'vitest';
import {
  formatGateProgress,
  formatVerifySuccess,
  formatVerifyFailure,
} from '../../../src/cli/format-verify.js';
import type { GateResult, VerificationResult, RefactorPlan } from '../../../src/contracts.js';

const passingGate: GateResult = { passed: true, durationMs: 42 };
const failingGate: GateResult = {
  passed: false,
  durationMs: 1234,
  blockingReason:
    'tests fail after refactoring:\n\nFailing tests:\n  ✗ tests/unit/foo.test.ts > my test\n      AssertionError: 1 !== 2\n\nRaw tail:\nfoo bar',
};

const plan: RefactorPlan = {
  changes: [
    {
      path: '/proj/src/foo.py',
      oldHash: 'h',
      newContent: 'new',
      transformId: 'format_to_fstring',
    },
    {
      path: '/proj/src/bar.ts',
      oldHash: 'h2',
      newContent: 'new2',
      transformId: 'var_to_const_let',
    },
  ],
  preconditions: [],
};

describe('formatGateProgress', () => {
  it('renders pass symbol + gate name + ms', () => {
    const lines = formatGateProgress('syntax', passingGate);
    expect(lines.length).toBeGreaterThan(0);
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/syntax/);
    expect(blob).toMatch(/42/);
    expect(blob).toMatch(/✔|✓/);
  });

  it('renders fail symbol on failing gate', () => {
    const lines = formatGateProgress('tests', failingGate);
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/tests/);
    expect(blob).toMatch(/✗/);
  });
});

describe('formatVerifySuccess', () => {
  it('lists each writableChanges path tagged with transformId', () => {
    const result: VerificationResult = {
      passed: true,
      gates: { syntax: passingGate, imports: passingGate, tests: passingGate },
      writableChanges: plan.changes,
    };
    const lines = formatVerifySuccess(result, plan, '/proj');
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/src\/foo\.py/);
    expect(blob).toMatch(/format_to_fstring/);
    expect(blob).toMatch(/src\/bar\.ts/);
    expect(blob).toMatch(/var_to_const_let/);
    expect(blob).toMatch(/2 file/);
    expect(blob).toMatch(/document/);
  });
});

describe('formatVerifyFailure', () => {
  it('surfaces Failing tests block from blockingReason and NOT written caveat', () => {
    const result: VerificationResult = {
      passed: false,
      gates: { syntax: passingGate, imports: passingGate, tests: failingGate },
      writableChanges: [],
    };
    const lines = formatVerifyFailure(result, plan, '/proj', '/tmp/shadow');
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/Verification failed at gate 'tests'/);
    expect(blob).toMatch(/Failing tests:/);
    expect(blob).toMatch(/AssertionError/);
    expect(blob).toMatch(/NOT written/);
  });

  it('includes reproduce hint when shadowRoot is non-null', () => {
    const result: VerificationResult = {
      passed: false,
      gates: { syntax: passingGate, imports: passingGate, tests: failingGate },
      writableChanges: [],
    };
    const lines = formatVerifyFailure(result, plan, '/proj', '/tmp/shadow-abc');
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/To reproduce locally:/);
    expect(blob).toMatch(/cd \/tmp\/shadow-abc/);
  });

  it('omits reproduce hint when shadowRoot is null', () => {
    const result: VerificationResult = {
      passed: false,
      gates: { syntax: passingGate, imports: passingGate, tests: failingGate },
      writableChanges: [],
    };
    const lines = formatVerifyFailure(result, plan, '/proj', null);
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).not.toMatch(/To reproduce locally:/);
  });

  it('includes culprit hint when plan-path basename appears in blockingReason', () => {
    const culpritReason: GateResult = {
      passed: false,
      durationMs: 100,
      blockingReason:
        'tests fail after refactoring:\n\nFailing tests:\n  ✗ tests/unit/foo.test.ts > breaks foo\n      Error in foo.py\n\nRaw tail:\nthings',
    };
    const result: VerificationResult = {
      passed: false,
      gates: { syntax: passingGate, imports: passingGate, tests: culpritReason },
      writableChanges: [],
    };
    const lines = formatVerifyFailure(result, plan, '/proj', null);
    const blob = lines.map((l) => l.text).join('\n');
    expect(blob).toMatch(/Likely culprit/);
    expect(blob).toMatch(/format_to_fstring/);
  });
});
