import type { Precondition, TransformId } from '../contracts.js';
import type { DetectorFinding } from '../analyze/detectors/types.js';

export type Lang = 'python' | 'typescript';

export interface TransformContext {
  absPath: string;
  relPath: string;
  source: string;
  findings: DetectorFinding[]; // findings for this file × this transform id
}

export interface TransformResult {
  // Empty newContent means: transform skipped (preconditions failed); leave source untouched.
  newContent: string | null;
  preconditions: Precondition[];
}

export interface TransformImpl {
  readonly id: TransformId;
  readonly lang: Lang;
  apply(ctx: TransformContext): Promise<TransformResult>;
}
