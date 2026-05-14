import * as fs from 'node:fs/promises';
import type { Analyzer, AnalysisReport } from '../contracts.js';
import { walkProject, type FileRecord } from './discovery.js';
import { parsePython, parseTypescript } from './parser.js';
import { detectorsFor } from './detectors/index.js';
import { buildImportGraph, type ImportGraph } from './graphs/import-graph.js';
import { extractCallEdges, type CallEdge } from './graphs/call-graph.js';
import type { Confidence, DetectorFinding } from './detectors/types.js';

// Side-effect imports so each detector's `register({...})` runs at module-load time.
import './detectors/python/callback-pattern.js';
import './detectors/python/old-string-format.js';
import './detectors/python/manual-typecheck.js';
import './detectors/python/deprecated-api.js';
import './detectors/python/class-init-only.js';
import './detectors/typescript/var-declarations.js';
import './detectors/typescript/promise-chains.js';
import './detectors/typescript/implicit-any.js';
import './detectors/typescript/commonjs.js';
import './detectors/typescript/promise-constructor.js';

export interface AnalyzeOptions {
  confidence?: Confidence;
  /** Additional gitignore-style globs to exclude from discovery, on top of
   *  .gitignore. Sourced from .refactronrc.json's `exclude` field. */
  excludeGlobs?: string[];
}

export interface ExtendedAnalysisReport extends AnalysisReport {
  findings: DetectorFinding[];
  importGraph: ImportGraph;
  callEdges: CallEdge[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export class RefactronAnalyzer implements Analyzer {
  constructor(private readonly opts: AnalyzeOptions = {}) {}

  async analyze(root: string): Promise<AnalysisReport> {
    const ext = await this.analyzeExtended(root);
    return { root: ext.root, findings: ext.findings, analyzedAt: ext.analyzedAt };
  }

  async analyzeExtended(root: string): Promise<ExtendedAnalysisReport> {
    const minConf = this.opts.confidence ?? 'high';
    const minRank = CONFIDENCE_RANK[minConf];

    const files: FileRecord[] = [];
    const walkOpts = this.opts.excludeGlobs ? { excludeGlobs: this.opts.excludeGlobs } : {};
    for await (const f of walkProject(root, walkOpts)) files.push(f);

    const findings: DetectorFinding[] = [];
    const callEdges: CallEdge[] = [];

    for (const f of files) {
      let source: string;
      try {
        source = await fs.readFile(f.absPath, 'utf8');
      } catch {
        continue;
      }
      const tsx = f.relPath.endsWith('.tsx');
      const tree = f.lang === 'python' ? parsePython(source) : parseTypescript(source, tsx);
      const ctx = { absPath: f.absPath, relPath: f.relPath, source, tree };

      for (const d of detectorsFor(f.lang)) {
        try {
          for (const finding of d.detect(ctx)) {
            if (CONFIDENCE_RANK[finding.confidence] >= minRank) findings.push(finding);
          }
        } catch {
          // Detector failure isolated — one detector must not crash the whole analysis.
        }
      }

      callEdges.push(...extractCallEdges(f.lang, f.relPath, source, tree));
    }

    const importGraph = await buildImportGraph(root, files);

    return {
      root,
      findings,
      analyzedAt: new Date(),
      importGraph,
      callEdges,
    };
  }
}
