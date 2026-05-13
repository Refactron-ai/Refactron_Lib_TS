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
import type { TransformImpl } from './types.js';

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
};

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export interface RefactronRefactorerOptions {
  projectRoot: string;
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

    const changes: FileChange[] = [];
    const preconditions: Precondition[] = [];

    for (const [relPath, fileFindings] of byFile) {
      const absPath = path.resolve(this.opts.projectRoot, relPath);
      let originalText: string;
      try {
        originalText = await fs.readFile(absPath, 'utf8');
      } catch {
        continue;
      }
      const originalHash = sha256(originalText);
      let currentText = originalText;
      let touched = false;
      let firstTransform: TransformId | null = null;

      for (const tid of enabled) {
        const impl = REGISTRY[tid];
        const findingsForTransform = fileFindings.filter((f) => f.transformId === tid);
        if (findingsForTransform.length === 0) continue;
        const result = await impl.apply({
          absPath,
          relPath,
          source: currentText,
          findings: findingsForTransform,
        });
        for (const p of result.preconditions) {
          preconditions.push({ ...p, id: `${tid}:${relPath}:${p.id}` });
        }
        if (result.newContent !== null && result.newContent !== currentText) {
          currentText = result.newContent;
          touched = true;
          if (firstTransform === null) firstTransform = tid;
        }
      }

      if (touched && firstTransform !== null) {
        changes.push({
          path: absPath,
          oldHash: originalHash,
          newContent: currentText,
          transformId: firstTransform,
        });
      }
    }

    return { changes, preconditions };
  }
}
