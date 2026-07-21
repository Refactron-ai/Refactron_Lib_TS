import * as fs from 'node:fs/promises';
import type { Analyzer, AnalysisReport, TransformId } from '../contracts.js';
import { walkProject, type FileRecord } from './discovery.js';
import { parsePython, parseTypescript } from './parser.js';
import { detectorsFor } from './detectors/index.js';
import { buildImportGraph, type ImportGraph } from './graphs/import-graph.js';
import { extractCallEdges, type CallEdge } from './graphs/call-graph.js';
import type { Confidence, DetectorContext, DetectorFinding } from './detectors/types.js';
import { reportCoverage } from './coverage/index.js';
import { NEEDS_COVERAGE as SQLALCHEMY_NEEDS_COVERAGE } from './detectors/python/sqlalchemy-query.js';

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
// v0.2.3 additions
import './detectors/python/super-with-args.js';
import './detectors/python/lru-cache-maxsize-none.js';
import './detectors/python/typing-generic.js';
import './detectors/python/typing-optional-union.js';
import './detectors/python/datetime-timezone-utc.js';
import './detectors/python/yield-in-trivial-loop.js';
// v0.2.3 Phase 4 — TypeScript ES2015+/ES2016+ idioms
import './detectors/typescript/indexof-comparison.js';
import './detectors/typescript/object-assign-empty.js';
import './detectors/typescript/string-concat.js';
// v0.2.3 Phase 5 — Vue 2 reactivity helpers (.js/.ts; .vue files are not visited by walker)
import './detectors/typescript/vue-set-delete.js';
// v0.3.0 — SQLAlchemy 1.x → 2.0 query-to-select migration (detector only;
// rewriter sidecar lands in a later task and the TransformId is added to the
// locked contract in Task 18).
import './detectors/python/sqlalchemy-query.js';

export interface AnalyzeOptions {
  confidence?: Confidence;
  /** Additional gitignore-style globs to exclude from discovery, on top of
   *  .gitignore. Sourced from .refactronrc.json's `exclude` field. */
  excludeGlobs?: string[];
  /** Active transforms for this analyze invocation, as resolved by the CLI
   *  (`--transforms` flag → `.refactronrc` `transforms` → `'all'`). When
   *  omitted, the engine assumes the caller is not opting into any
   *  coverage-gated detectors and skips the coverage reporter entirely. Cost
   *  matters: `reportCoverage` shells out to pytest, which takes seconds.
   *  When present, the engine consults each coverage-needing detector and runs
   *  the reporter once per analyze call iff at least one of them is active. */
  transforms?: TransformId[];
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

    // Coverage gate: only run the (potentially seconds-long) coverage reporter
    // when at least one coverage-needing detector is in the active transforms
    // list. When `transforms` was not supplied by the caller, we skip — older
    // callers that don't know about coverage must keep their millisecond-scale
    // analyze latency.
    const activeTransforms = this.opts.transforms;
    // 'sqlalchemy_query_to_select' is added to the locked `TransformId` union
    // in Task 18 — until then it is shipped through the union via `as never`,
    // matching how the detector itself constructs its findings.
    const wantsCoverage =
      activeTransforms !== undefined &&
      SQLALCHEMY_NEEDS_COVERAGE &&
      (activeTransforms as string[]).includes('sqlalchemy_query_to_select');
    let coveredLines: Set<string> | undefined;
    if (wantsCoverage) {
      const report = await reportCoverage({ projectRoot: root });
      if (!report.coverageToolFound) {
        // eslint-disable-next-line no-console
        console.warn(
          '[refactron] coverage.py not installed in target Python; ' +
            'sqlalchemy_query_to_select findings will carry testCovered=unknown',
        );
      }
      coveredLines = report.coverageToolFound ? report.coveredLines : undefined;
    }

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
      let tree;
      try {
        tree = f.lang === 'python' ? parsePython(source) : parseTypescript(source, tsx);
      } catch {
        // A file the parser cannot handle must not abort the whole run —
        // skip it and keep analyzing the rest of the project.
        continue;
      }
      const ctx: DetectorContext = { absPath: f.absPath, relPath: f.relPath, source, tree };
      if (coveredLines !== undefined) ctx.coveredLines = coveredLines;

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
