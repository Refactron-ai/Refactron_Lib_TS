import type { Precondition, TransformId } from '../contracts.js';
import type { DetectorFinding } from '../analyze/detectors/types.js';

export type Lang = 'python' | 'typescript';

export interface CrossFileContext {
  projectRoot: string;
  // file (relative to projectRoot) → contents
  files: Record<string, string>;
  // file → list of files that import it (reverse of importGraph)
  importedBy: Record<string, string[]>;
  // file → list of files it imports
  imports: Record<string, string[]>;
  // best-effort tag for files under tests/ or matching test_*.py / *_test.py
  testFiles: string[];
  /** Resolved minimum Python version (e.g. "3.10") for version-gated
   *  transforms. `null` means "unknown" — gated sidecars MUST refuse rather
   *  than guess. Resolved once per run from `.refactronrc` →
   *  `pyproject.toml` → null. */
  pythonVersion?: string | null;
}

export interface TransformContext {
  absPath: string;
  relPath: string;
  source: string;
  findings: DetectorFinding[]; // findings for this file × this transform id
  crossFile?: CrossFileContext;
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
