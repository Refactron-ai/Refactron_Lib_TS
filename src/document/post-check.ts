// src/document/post-check.ts
// Post-apply syntax re-check. `document --apply` is otherwise ungated — it
// writes LLM-generated docstrings and comments straight to disk. This re-checks
// the written files so a malformed generation is caught and rolled back
// instead of corrupting the tree.

import { checkPythonSyntax } from '../verify/checks/syntax-python.js';
import { checkTypescriptSyntax } from '../verify/checks/syntax-typescript.js';

function isPython(file: string): boolean {
  return file.endsWith('.py');
}
function isTypeScript(file: string): boolean {
  return file.endsWith('.ts') || file.endsWith('.tsx');
}

export interface RecheckResult {
  ok: boolean;
  /** Absolute paths of files that failed the syntax re-check. */
  broken: string[];
}

/**
 * Re-check the syntax of files just written by `document --apply`. Runs a fast
 * batch check first; on any failure each file is re-checked individually so
 * the exact culprits are identified (and only those get rolled back).
 */
export async function recheckSyntax(files: string[]): Promise<RecheckResult> {
  const py = files.filter(isPython);
  const ts = files.filter(isTypeScript);

  const batch = [
    ...(py.length > 0 ? [await checkPythonSyntax(py)] : []),
    ...(ts.length > 0 ? [await checkTypescriptSyntax(ts)] : []),
  ];
  if (batch.every((r) => r.passed)) return { ok: true, broken: [] };

  const broken: string[] = [];
  for (const f of files) {
    if (!isPython(f) && !isTypeScript(f)) continue;
    const r = isPython(f) ? await checkPythonSyntax([f]) : await checkTypescriptSyntax([f]);
    if (!r.passed) broken.push(f);
  }
  return { ok: broken.length === 0, broken };
}
