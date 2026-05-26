// src/contracts.ts — LOCKED Day 2. Modifications require a major version bump.

export type TransformId =
  | 'callback_to_async_await'
  | 'format_to_fstring'
  | 'manual_typecheck_to_hints'
  | 'deprecated_api_requests_to_httpx'
  | 'class_to_dataclass'
  | 'var_to_const_let'
  | 'promise_chains_to_async'
  | 'implicit_any'
  | 'commonjs_to_esm'
  | 'promise_constructor_to_async'
  // v0.2.3 — added transform IDs only (additive, semver-minor under the v2.0
  // locked-surface policy: new union members are non-breaking for consumers
  // that exhaustively switch).
  | 'super_no_args'
  | 'lru_cache_to_cache'
  | 'pep585_generics'
  | 'pep604_optional_union'
  | 'datetime_utc_alias'
  | 'yield_from_for_loop'
  | 'indexof_to_includes'
  | 'object_assign_to_spread'
  | 'string_concat_to_template_literal'
  | 'vue_set_delete_to_assignment';

export interface Finding {
  id: string;
  file: string;
  line: number;
  transformId: TransformId;
  remediationMinutes: number;
}

export interface AnalysisReport {
  root: string;
  findings: Finding[];
  analyzedAt: Date;
}

export interface Precondition {
  id: string;
  satisfied: boolean;
  reason?: string;
}

export interface FileChange {
  path: string;
  oldHash: string;
  newContent: string;
  transformId: TransformId;
}

export interface RefactorPlan {
  changes: FileChange[];
  preconditions: Precondition[];
}

export interface GateResult {
  passed: boolean;
  durationMs: number;
  blockingReason?: string;
}

export interface VerificationResult {
  passed: boolean;
  gates: {
    syntax: GateResult;
    imports: GateResult;
    tests: GateResult;
  };
  writableChanges: FileChange[];
}

export interface DocPatch {
  docstrings: Array<{ file: string; symbol: string; content: string }>;
  changelogEntry: string;
}

export interface Analyzer {
  analyze(root: string): Promise<AnalysisReport>;
}

export interface Refactorer {
  plan(report: AnalysisReport, transforms: TransformId[]): Promise<RefactorPlan>;
}

export interface Verifier {
  verify(plan: RefactorPlan): Promise<VerificationResult>;
}

export interface Documenter {
  document(verified: VerificationResult): Promise<DocPatch>;
}
