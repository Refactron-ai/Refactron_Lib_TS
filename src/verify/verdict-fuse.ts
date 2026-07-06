// src/verify/verdict-fuse.ts
// Pure fusion of the verify engine's pass/fail gates with changed-line coverage
// into the honest three-way verdict. No I/O.
import type { VerificationResult, GateResult } from '../contracts.js';

export type Verdict = 'SAFE' | 'UNSAFE' | 'UNPROVEN';

export interface CoverageAssessment {
  tool: 'coverage.py' | 'none';
  changedLinesCovered: boolean | 'unknown';
  uncovered: Array<{ file: string; line: number }>;
}

export interface VerdictReport {
  verdict: Verdict;
  gates: { syntax: GateResult; imports: GateResult; tests: GateResult };
  changedFiles: string[];
  coverage: CoverageAssessment;
  reason: string;
  missingTests?: Array<{ file: string; hint: string }>;
}

export function fuseVerdict(
  result: VerificationResult,
  changedFiles: string[],
  cov: CoverageAssessment,
): VerdictReport {
  const base = { gates: result.gates, changedFiles, coverage: cov };

  if (!result.passed) {
    const failedGate: 'syntax' | 'imports' | 'tests' = !result.gates.syntax.passed
      ? 'syntax'
      : !result.gates.imports.passed
        ? 'imports'
        : 'tests';
    const reason = result.gates[failedGate].blockingReason ?? `${failedGate} gate failed`;
    return { verdict: 'UNSAFE', ...base, reason };
  }

  if (cov.changedLinesCovered === true) {
    return {
      verdict: 'SAFE',
      ...base,
      reason: 'Tests pass and the changed code is covered.',
    };
  }

  const reason =
    cov.changedLinesCovered === 'unknown'
      ? 'Tests pass, but coverage of the changed code could not be determined.'
      : 'Tests pass, but the changed code is not exercised by any test.';
  const missingTests = cov.uncovered.map((u) => ({
    file: u.file,
    hint: `add a test exercising ${u.file}:${u.line}`,
  }));
  return {
    verdict: 'UNPROVEN',
    ...base,
    reason,
    ...(missingTests.length > 0 ? { missingTests } : {}),
  };
}
