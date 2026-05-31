import type { ExtendedAnalysisReport } from '../engine.js';
import { TIER_BY_TRANSFORM, type TransformTier } from '../../cli/v2-adapters.js';

type TierCounts = Record<TransformTier, number>;

export function toJson(report: ExtendedAnalysisReport): string {
  const importGraph: Record<string, string[]> = {};
  for (const [src, deps] of [...report.importGraph.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    importGraph[src] = [...deps].sort();
  }

  const byTransform = new Map<string, number>();
  const byTier: TierCounts = { debt: 0, modernization: 0, style: 0 };
  const minutesByTier: TierCounts = { debt: 0, modernization: 0, style: 0 };
  let totalMinutes = 0;
  for (const f of report.findings) {
    byTransform.set(f.transformId, (byTransform.get(f.transformId) ?? 0) + 1);
    totalMinutes += f.remediationMinutes;
    const tier = TIER_BY_TRANSFORM[f.transformId];
    byTier[tier] += 1;
    minutesByTier[tier] += f.remediationMinutes;
  }

  const out = {
    root: report.root,
    analyzedAt: report.analyzedAt.toISOString(),
    summary: {
      totalFindings: report.findings.length,
      totalMinutes,
      byTransform: Object.fromEntries(byTransform),
      byTier,
      minutesByTier,
    },
    findings: report.findings,
    importGraph,
    callEdges: report.callEdges,
  };
  return JSON.stringify(out, null, 2);
}
