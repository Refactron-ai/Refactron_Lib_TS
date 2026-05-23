// src/transform/engine.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  Refactorer,
  AnalysisReport,
  RefactorPlan,
  FileChange,
  Precondition,
  TransformId,
} from '../contracts.js';
import type { DetectorFinding } from '../analyze/detectors/types.js';
import type { ExtendedAnalysisReport } from '../analyze/engine.js';
import type { CrossFileContext, TransformImpl } from './types.js';
import { buildCrossFileContext } from './cross-file.js';

// Side-effect imports: each transform module's `impl` is registered here so the
// bundler cannot tree-shake any of the ten implementations away.
import { impl as t1 } from './transforms/python/callback-to-async.js';
import { impl as t2 } from './transforms/python/format-to-fstring.js';
import { impl as t3 } from './transforms/python/manual-typecheck.js';
import { impl as t4 } from './transforms/python/deprecated-api.js';
import { impl as t5 } from './transforms/python/class-to-dataclass.js';
import { impl as t6 } from './transforms/typescript/var-to-const-let.js';
import { impl as t7 } from './transforms/typescript/promise-chains.js';
import { impl as t8 } from './transforms/typescript/implicit-any.js';
import { impl as t9 } from './transforms/typescript/commonjs.js';
import { impl as t10 } from './transforms/typescript/promise-constructor.js';
// v0.3.0 additions
import { impl as t11 } from './transforms/python/super-no-args.js';
import { impl as t12 } from './transforms/python/lru-cache-to-cache.js';

const TRANSFORM_ORDER: TransformId[] = [
  'callback_to_async_await',
  'format_to_fstring',
  'manual_typecheck_to_hints',
  'deprecated_api_requests_to_httpx',
  'class_to_dataclass',
  'var_to_const_let',
  'promise_chains_to_async',
  'implicit_any',
  'commonjs_to_esm',
  'promise_constructor_to_async',
  // v0.3.0 additions — appended so existing transforms keep their slot order.
  'super_no_args',
  'lru_cache_to_cache',
];

const REGISTRY: Record<TransformId, TransformImpl> = {
  callback_to_async_await: t1,
  format_to_fstring: t2,
  manual_typecheck_to_hints: t3,
  deprecated_api_requests_to_httpx: t4,
  class_to_dataclass: t5,
  var_to_const_let: t6,
  promise_chains_to_async: t7,
  implicit_any: t8,
  commonjs_to_esm: t9,
  promise_constructor_to_async: t10,
  super_no_args: t11,
  lru_cache_to_cache: t12,
};

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface RefactronRefactorerOptions {
  projectRoot: string;
  /** Resolved minimum Python version for the project, surfaced to
   *  version-gated Python sidecars (PEP 585, PEP 604, lru_cache → cache,
   *  datetime.UTC, …). When `undefined`, the refactorer leaves the value
   *  unset and gated sidecars refuse to rewrite. Resolved upstream by
   *  `resolvePythonVersion()` in `src/cli/config-loader.ts`. */
  pythonVersion?: string | null;
}

export class RefactronRefactorer implements Refactorer {
  constructor(private readonly opts: RefactronRefactorerOptions) {}

  async plan(report: AnalysisReport, transforms: TransformId[]): Promise<RefactorPlan> {
    const enabled =
      transforms.length === 0
        ? [...TRANSFORM_ORDER]
        : transforms.filter((t) => TRANSFORM_ORDER.includes(t));

    // Group findings by file (file is a relPath from the analyzer).
    const byFile = new Map<string, DetectorFinding[]>();
    for (const f of report.findings as DetectorFinding[]) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }

    // Build cross-file context once when the analyzer gave us an ExtendedAnalysisReport.
    // Transforms that don't need cross-file info simply ignore the field.
    const crossFileOpts: { pythonVersion?: string | null } =
      this.opts.pythonVersion !== undefined ? { pythonVersion: this.opts.pythonVersion } : {};
    const crossFile: CrossFileContext | undefined = isExtended(report)
      ? await buildCrossFileContext(report, this.opts.projectRoot, crossFileOpts)
      : undefined;

    // Per-file work is independent: cross-file context is precomputed and
    // each transform's preconditions are read-only. Run files in parallel
    // with bounded concurrency so we don't fan out N python3 subprocesses
    // on small machines. Within a file transforms still serialize (each
    // feeds its newContent into the next).
    //
    // Before this change: O(N_files × N_transforms_with_findings) sequential
    // python3 cold-starts ≈ 3-4s on the python-legacy-mini fixture.
    // After: max(per-file pipeline) on a multi-core machine — typically
    // 5-10x faster on real-world repos with many files.
    type FileWork = { relPath: string; findings: DetectorFinding[] };
    const work: FileWork[] = [];
    for (const [relPath, fileFindings] of byFile) {
      work.push({ relPath, findings: fileFindings });
    }

    const concurrency = Math.max(1, Math.min(8, work.length));
    const results = new Array<{
      changes: FileChange[];
      preconditions: Precondition[];
    } | null>(work.length);

    async function processFile(this: RefactronRefactorer, idx: number): Promise<void> {
      const { relPath, findings: fileFindings } = work[idx]!;
      const absPath = path.resolve(this.opts.projectRoot, relPath);
      let originalText: string;
      try {
        originalText = await fs.readFile(absPath, 'utf8');
      } catch {
        results[idx] = null;
        return;
      }
      // The hash of the true on-disk original — every FileChange we emit for
      // this file shares this same `oldHash`, so the verifier / shadow-tree
      // can detect drift consistently regardless of how many transforms
      // touched the file.
      const originalHash = sha256(originalText);
      let currentText = originalText;
      const localChanges: FileChange[] = [];
      const localPreconditions: Precondition[] = [];

      for (const tid of enabled) {
        const impl = REGISTRY[tid];
        const findingsForTransform = fileFindings.filter((f) => f.transformId === tid);
        if (findingsForTransform.length === 0) continue;
        const result = await impl.apply({
          absPath,
          relPath,
          source: currentText,
          findings: findingsForTransform,
          ...(crossFile ? { crossFile } : {}),
        });
        for (const p of result.preconditions) {
          localPreconditions.push({ ...p, id: `${tid}:${relPath}:${p.id}` });
        }
        if (result.newContent !== null && result.newContent !== currentText) {
          currentText = result.newContent;
          // Emit one FileChange per touching transform. `newContent` is the
          // cumulative composition after this transform on top of all prior
          // ones, which is the contract the downstream apply-orchestrator and
          // format-plan grouping rely on (last FileChange per path holds the
          // final on-disk content).
          localChanges.push({
            path: absPath,
            oldHash: originalHash,
            newContent: currentText,
            transformId: tid,
          });
        }
      }

      results[idx] = {
        changes: localChanges,
        preconditions: localPreconditions,
      };
    }

    // Bounded-concurrency worker pool: spawn `concurrency` workers that
    // pull indices from a shared cursor. Order of completion doesn't matter
    // because we collect results back into the original index slot.
    let cursor = 0;
    const next = (): number | null => {
      if (cursor >= work.length) return null;
      return cursor++;
    };
    const workers: Array<Promise<void>> = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(
        (async () => {
          for (;;) {
            const idx = next();
            if (idx === null) return;
            await processFile.call(this, idx);
          }
        })(),
      );
    }
    await Promise.all(workers);

    // Collect results in original order so the plan is deterministic.
    // Each file may contribute multiple FileChanges (one per touching transform).
    const changes: FileChange[] = [];
    const preconditions: Precondition[] = [];
    for (const r of results) {
      if (r === null) continue;
      changes.push(...r.changes);
      preconditions.push(...r.preconditions);
    }

    return { changes, preconditions };
  }
}

function isExtended(r: AnalysisReport): r is ExtendedAnalysisReport {
  return 'importGraph' in r && 'callEdges' in r;
}
