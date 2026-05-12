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
}

export interface DetectorFinding extends Finding {
  confidence: Confidence;
}

export interface Detector {
  readonly transformId: TransformId;
  readonly lang: Lang;
  detect(ctx: DetectorContext): DetectorFinding[];
}
