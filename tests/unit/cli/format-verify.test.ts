import { describe, it, expect } from 'vitest';
import {
  formatGateProgress,
  formatGateStart,
  formatApplyingNotice,
  formatVerifySuccess,
  formatPartialApply,
  formatBaselineBroken,
  formatNoTestRunner,
  type PerFileOutcome,
} from '../../../src/cli/format-verify.js';
import type {
  GateResult,
  VerificationResult,
  RefactorPlan,
  FileChange,
} from '../../../src/contracts.js';

const passingGate: GateResult = { passed: true, durationMs: 42 };
const failingGate: GateResult = {
  passed: false,
  durationMs: 1234,
  blockingReason:
    'tests fail after refactoring:\n\nFailing tests:\n  ✗ tests/unit/foo.test.ts > my test\n      AssertionError: 1 !== 2\n\nRaw tail:\nfoo bar',
};

const fooChange: FileChange = {
  path: '/proj/src/foo.py',
  oldHash: 'h',
  newContent: 'new',
  transformId: 'format_to_fstring',
};
const barChange: FileChange = {
  path: '/proj/src/bar.ts',
  oldHash: 'h2',
  newContent: 'new2',
  transformId: 'var_to_const_let',
};
const plan: RefactorPlan = { changes: [fooChange, barChange], preconditions: [] };

describe('formatGateProgress', () => {
  it('renders pass symbol + gate name + ms', () => {
    const blob = formatGateProgress('syntax', passingGate)
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/syntax/);
    expect(blob).toMatch(/42/);
    expect(blob).toMatch(/✔|✓/);
  });

  it('renders fail symbol on failing gate', () => {
    const blob = formatGateProgress('tests', failingGate)
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/tests/);
    expect(blob).toMatch(/✗/);
  });
});

describe('formatGateStart / formatApplyingNotice', () => {
  it('formatGateStart names the gate being verified', () => {
    const blob = formatGateStart('imports')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/verifying imports/);
  });

  it('formatApplyingNotice names the file count', () => {
    const blob = formatApplyingNotice(7)
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/applying 7 file/);
  });
});

describe('formatVerifySuccess', () => {
  it('lists each writableChanges path tagged with transformId', () => {
    const result: VerificationResult = {
      passed: true,
      gates: { syntax: passingGate, imports: passingGate, tests: passingGate },
      writableChanges: plan.changes,
    };
    const blob = formatVerifySuccess(result, plan, '/proj')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/src\/foo\.py/);
    expect(blob).toMatch(/format_to_fstring/);
    expect(blob).toMatch(/2 file/);
    expect(blob).toMatch(/document/);
  });
});

describe('formatPartialApply', () => {
  it('lists applied and held-back files with the failing tests', () => {
    const outcomes: PerFileOutcome[] = [
      { change: fooChange, transformIds: ['format_to_fstring'], applied: true },
      {
        change: barChange,
        transformIds: ['var_to_const_let'],
        applied: false,
        failedGate: 'tests',
        failingTests: ['✗ tests/unit/bar.test.ts > does the thing', '    AssertionError: nope'],
      },
    ];
    const blob = formatPartialApply(outcomes, '/proj')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/Applied \(1\):/);
    expect(blob).toMatch(/src\/foo\.py/);
    expect(blob).toMatch(/Held back \(1\):/);
    expect(blob).toMatch(/src\/bar\.ts/);
    expect(blob).toMatch(/blocked at gate 'tests'/);
    expect(blob).toMatch(/Failing tests:/);
    expect(blob).toMatch(/does the thing/);
    expect(blob).toMatch(/1 file\(s\) applied · 1 held back/);
  });

  it('adds the interdependence caveat when 2+ files are held back', () => {
    const outcomes: PerFileOutcome[] = [
      {
        change: fooChange,
        transformIds: ['format_to_fstring'],
        applied: false,
        failedGate: 'imports',
        rawReason: 'bad import',
      },
      {
        change: barChange,
        transformIds: ['var_to_const_let'],
        applied: false,
        failedGate: 'imports',
        rawReason: 'bad import',
      },
    ];
    const blob = formatPartialApply(outcomes, '/proj')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/may depend on each other/);
    expect(blob).toMatch(/0 file\(s\) applied · 2 held back/);
  });
});

describe('formatBaselineBroken', () => {
  it('explains the project tests were already red', () => {
    const blob = formatBaselineBroken('baseline tests already fail before refactoring')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/already fail before any change/);
    expect(blob).toMatch(/red test suite/);
  });
});

describe('formatNoTestRunner', () => {
  it('explains no runner was detected and how to fix it', () => {
    const blob = formatNoTestRunner('no test runner detected (pytest, vitest, jest)')
      .map((l) => l.text)
      .join('\n');
    expect(blob).toMatch(/no test runner detected/);
    expect(blob).toMatch(/pytest, vitest, or jest/);
    expect(blob).toMatch(/testCmd/);
  });
});
