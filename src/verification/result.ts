// src/verification/result.ts
import type { VerificationResult } from '../core/models.js';

export function buildPassedResult(checksRun: string[], durationMs: number): VerificationResult {
  const confidenceScore =
    checksRun.length >= 3 ? 0.97 : checksRun.length === 2 ? 0.85 : 0.70;
  return {
    safeToApply: true,
    passed: true,
    checksRun,
    checksPassed: [...checksRun],
    checksFailed: [],
    confidenceScore,
    verificationMs: durationMs,
    skippedChecks: [],
  };
}

export function buildBlockedResult(
  checksRun: string[],
  failedCheck: string,
  blockingReason: string,
  durationMs: number,
): VerificationResult {
  return {
    safeToApply: false,
    passed: false,
    checksRun,
    checksPassed: checksRun.filter((c) => c !== failedCheck),
    checksFailed: [failedCheck],
    blockingReason,
    confidenceScore: 0,
    verificationMs: durationMs,
    skippedChecks: [],
  };
}
