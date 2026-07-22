import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { GateResult } from '../../contracts.js';
import type { CheckContext } from '../types.js';
import { collectPythonUnresolved } from '../checks/imports-python.js';
import { collectTypescriptUnresolved } from '../checks/imports-typescript.js';

// Per changed file: its project-relative path, the base file in the real tree
// (null when the change adds a brand-new file), and the changed file in the
// shadow tree.
interface DeltaEntry {
  rel: string;
  base: string | null;
  shadow: string;
}

/**
 * Collector signature shared by the Python and TypeScript checks: resolve the
 * imports of `files` rooted at `root`, returning per-file unresolvable module
 * sets keyed by the exact path passed in.
 */
type Collector = (root: string, files: string[]) => Promise<Map<string, Set<string>>>;

const MAX_REASONS_SHOWN = 5;

/**
 * Imports gate — delta-aware. An import that already fails to resolve in the
 * base file is the repo's pre-existing state, not something this change caused,
 * so it never fails the gate. Only imports that are unresolvable in the changed
 * file AND were NOT unresolvable in the base file (i.e. introduced or newly
 * broken by the change) block it. Brand-new files have an empty baseline, so
 * every unresolvable import in them counts.
 *
 * A newly-added platform-guarded import (e.g. `import msvcrt` added on the wrong
 * OS) can still fail; that is accepted conservative behaviour — we do not try to
 * evaluate platform conditions. TYPE_CHECKING-guarded imports are skipped
 * entirely by the collectors, since they never run at runtime.
 */
export async function importsGate(ctx: CheckContext, projectRoot: string): Promise<GateResult> {
  const t0 = Date.now();
  const pyEntries: DeltaEntry[] = [];
  const tsEntries: DeltaEntry[] = [];

  for (const c of ctx.changes) {
    const rel = path.relative(projectRoot, c.path);
    if (rel.startsWith('..')) {
      return {
        passed: false,
        durationMs: Date.now() - t0,
        blockingReason: `FileChange path escapes project root: ${c.path}`,
      };
    }
    const basePath = path.join(projectRoot, rel);
    const entry: DeltaEntry = {
      rel,
      base: existsSync(basePath) ? basePath : null,
      shadow: path.join(ctx.shadowRoot, rel),
    };
    if (c.path.endsWith('.py')) pyEntries.push(entry);
    else if (/\.(ts|tsx|js|jsx)$/.test(c.path)) tsEntries.push(entry);
  }

  const [pyReasons, tsReasons] = await Promise.all([
    introducedFailures(projectRoot, ctx.shadowRoot, pyEntries, collectPythonUnresolved),
    introducedFailures(projectRoot, ctx.shadowRoot, tsEntries, collectTypescriptUnresolved),
  ]);

  const reasons = [...pyReasons, ...tsReasons];
  if (reasons.length > 0) {
    const shown = reasons.slice(0, MAX_REASONS_SHOWN);
    const extra = reasons.length - shown.length;
    const blockingReason =
      shown.join('; ') + (extra > 0 ? `; and ${extra} more unresolved import(s)` : '');
    return { passed: false, durationMs: Date.now() - t0, blockingReason };
  }
  return { passed: true, durationMs: Date.now() - t0 };
}

/**
 * Diff the changed files' unresolvable imports against their base versions and
 * return a human-readable reason for each import the change introduced.
 */
async function introducedFailures(
  projectRoot: string,
  shadowRoot: string,
  entries: DeltaEntry[],
  collect: Collector,
): Promise<string[]> {
  if (entries.length === 0) return [];

  const baseFiles = entries.map((e) => e.base).filter((p): p is string => p !== null);
  const shadowFiles = entries.map((e) => e.shadow);

  const [baseMap, shadowMap] = await Promise.all([
    collect(projectRoot, baseFiles),
    collect(shadowRoot, shadowFiles),
  ]);

  const reasons: string[] = [];
  for (const e of entries) {
    const changed = shadowMap.get(e.shadow) ?? new Set<string>();
    const baseline = e.base ? (baseMap.get(e.base) ?? new Set<string>()) : new Set<string>();
    for (const mod of changed) {
      if (!baseline.has(mod)) {
        reasons.push(`unresolved import "${mod}" introduced in ${e.rel}`);
      }
    }
  }
  return reasons;
}
