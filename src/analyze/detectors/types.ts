// src/analyze/detectors/types.ts
import type Parser from 'tree-sitter';
import type { Finding, TransformId } from '../../contracts.js';
import type { Lang } from '../discovery.js';

export type Confidence = 'high' | 'medium' | 'low';

export interface DetectorContext {
  absPath: string;
  relPath: string;
  source: string;
  tree: Parser.Tree;
  /** Optional. Populated by the analyze engine when any active detector
   *  advertises `NEEDS_COVERAGE = true`. Keys are `${relPath}:${line}` strings
   *  (1-indexed) emitted by `coverage json`. */
  coveredLines?: Set<string>;
}

export interface DetectorFinding extends Finding {
  confidence: Confidence;
  /** Optional. Set by detectors that opt in via `NEEDS_COVERAGE`. `'unknown'`
   *  means the coverage reporter was not run (no covered set available); `'yes'`
   *  / `'no'` are only emitted when a covered set was threaded in. */
  testCovered?: 'yes' | 'no' | 'unknown';
}

export interface Detector {
  readonly transformId: TransformId;
  readonly lang: Lang;
  detect(ctx: DetectorContext): DetectorFinding[];
}
