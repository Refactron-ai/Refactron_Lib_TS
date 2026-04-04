// src/core/models.ts
// LOCKED. Do not change after initial commit.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type BlastLevel = 'trivial' | 'low' | 'medium' | 'high' | 'critical';

export interface BlastRadius {
  affectedFiles: string[];
  affectedFunctions: string[];
  affectedTestFiles: string[];
  score: number; // 0–100
  level: BlastLevel;
}

export interface TemporalProfile {
  lastModified: Date;
  changeVelocity: number; // changes per month (6-month window)
  coChangePairs: string[]; // files that always change with this one
  daysSinceLastTouch: number;
}

export interface CodeIssue {
  id: string;
  file: string;
  line: number;
  column?: number;
  severity: Severity;
  type: string; // 'sql-injection', 'high-complexity', etc.
  message: string;
  suggestion?: string;
  fixable: boolean;
  fixerName?: string;
  blastRadius: BlastRadius; // ALWAYS present — not optional
  temporal?: TemporalProfile; // present when git history available
  ruleId: string;
}

export interface CheckResult {
  passed: boolean;
  durationMs: number;
  blockingReason?: string;
  skippedReason?: string;
}

export interface VerificationResult {
  safeToApply: boolean;
  passed: boolean;
  checksRun: string[];
  checksPassed: string[];
  checksFailed: string[];
  blockingReason?: string;
  confidenceScore: number; // 0.0–1.0
  verificationMs: number;
  skippedChecks: string[];
}

export interface AnalysisResult {
  target: string;
  filesAnalyzed: number;
  filesSkipped: number;
  issues: CodeIssue[];
  languageBreakdown: Record<string, number>;
  durationMs: number;
  timestamp: Date;
}

export type SessionState = 'ANALYZED' | 'FIXING' | 'FIXED' | 'ROLLED_BACK';
export type FixStatus = 'PENDING' | 'APPLIED' | 'BLOCKED' | 'SKIPPED';

export interface FixQueueItem {
  issueId: string;
  filePath: string;
  lineNumber: number;
  severity: Severity;
  message: string;
  fixerName: string;
  status: FixStatus;
  diff?: string;
  blockReason?: string;
  verificationResult?: VerificationResult;
}

export interface PipelineSession {
  sessionId: string;
  target: string;
  state: SessionState;
  totalFiles: number;
  totalIssues: number;
  issuesBySeverity: Record<Severity, number>;
  fixQueue: FixQueueItem[];
  appliedFixes: FixQueueItem[];
  blockedFixes: FixQueueItem[];
  backupSessionId?: string;
  createdAt: Date;
  updatedAt: Date;
}
