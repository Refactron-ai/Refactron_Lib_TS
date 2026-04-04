// src/session/types.ts
// WorkSession — full context for one analyze→autofix→verify lifecycle.
// Persisted to .refactron/work-sessions/{id}.json so sessions survive
// across REPL restarts and can be listed / resumed.
import type { CodeIssue, Severity, FixQueueItem, VerificationResult } from '../core/models.js';

export type WorkSessionPhase =
  | 'analyzed'  // analyze complete, issues available
  | 'fixing'    // autofix in progress
  | 'fixed'     // autofix complete
  | 'verified'; // verify complete

export interface WorkSessionAnalysis {
  target: string;
  filesAnalyzed: number;
  filesSkipped: number;
  totalIssues: number;
  fixableCount: number;
  issuesBySeverity: Record<Severity, number>;
  issues: CodeIssue[];   // full list — key: enables autofix/verify without re-scan
  durationMs: number;
  timestamp: string;
}

export interface WorkSessionFix {
  dryRun: boolean;
  appliedCount: number;
  blockedCount: number;
  appliedFixes: FixQueueItem[];
  blockedFixes: FixQueueItem[];
  timestamp: string;
}

export interface WorkSessionVerifyEntry {
  file: string;
  safe: boolean;
  confidence: number;
  reason?: string | undefined;
  checksRun: string[];
}

export interface WorkSessionVerify {
  filesChecked: number;
  passed: number;
  blocked: number;
  entries: WorkSessionVerifyEntry[];
  timestamp: string;
}

export interface WorkSession {
  id: string;
  phase: WorkSessionPhase;
  analysis: WorkSessionAnalysis;
  fix?: WorkSessionFix;
  verify?: WorkSessionVerify;
  createdAt: string;
  updatedAt: string;
}
