import type { ExtendedAnalysisReport } from '../engine.js';

export function toJson(report: ExtendedAnalysisReport): string {
  const importGraph: Record<string, string[]> = {};
  for (const [src, deps] of [...report.importGraph.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    importGraph[src] = [...deps].sort();
  }
  const out = {
    root: report.root,
    analyzedAt: report.analyzedAt.toISOString(),
    summary: {
      totalFindings: report.findings.length,
      totalMinutes: report.findings.reduce((a, f) => a + f.remediationMinutes, 0),
      byTransform: Object.fromEntries(
        report.findings.reduce((map, f) => {
          map.set(f.transformId, (map.get(f.transformId) ?? 0) + 1);
          return map;
        }, new Map<string, number>()),
      ),
    },
    findings: report.findings,
    importGraph,
    callEdges: report.callEdges,
  };
  return JSON.stringify(out, null, 2);
}
