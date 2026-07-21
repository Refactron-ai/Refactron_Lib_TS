// src/analyze/safety/verdict.ts
// Pure classifier: turns detector findings (their `meta.shape` + `testCovered`)
// into a per-site safety verdict and an aggregate report. No UI / color here —
// presentation lives in src/cli/format-safety.ts.
import type { DetectorFinding } from '../detectors/types.js';

export type SafetyVerdict = 'safe-to-automate' | 'unproven' | 'needs-review';

export interface SiteAssessment {
  id: string;
  file: string;
  line: number;
  /** Non-null only for `needs-review` sites — the semantic precondition. */
  flagReason: string | null;
  testCovered: 'yes' | 'no' | 'unknown';
  verdict: SafetyVerdict;
}

export interface SafetyReport {
  root: string;
  transformId: string;
  total: number;
  counts: Record<SafetyVerdict, number>;
  /** True when at least one site has real coverage data (yes/no). When false,
   *  coverage.py was unavailable and every safe-shape site falls to `unproven`. */
  coverageAvailable: boolean;
  sites: SiteAssessment[];
}

interface FindingMeta {
  shape: 'safe' | 'flag';
  flagReason?: string;
}

/** The detector attaches its classification as a `meta` blob via object spread;
 *  `meta` is not declared on DetectorFinding, so read it defensively. A finding
 *  with missing/garbled meta is treated as needs-review (fail safe). */
function readMeta(finding: DetectorFinding): FindingMeta {
  const meta = (finding as { meta?: FindingMeta }).meta;
  if (meta && (meta.shape === 'safe' || meta.shape === 'flag')) return meta;
  return { shape: 'flag', flagReason: 'unclassified' };
}

export function assessFinding(finding: DetectorFinding): SiteAssessment {
  const meta = readMeta(finding);
  const testCovered = finding.testCovered ?? 'unknown';
  let verdict: SafetyVerdict;
  if (meta.shape === 'flag') {
    verdict = 'needs-review';
  } else if (testCovered === 'yes') {
    verdict = 'safe-to-automate';
  } else {
    verdict = 'unproven';
  }
  return {
    id: finding.id,
    file: finding.file,
    line: finding.line,
    flagReason: meta.shape === 'flag' ? (meta.flagReason ?? 'unclassified') : null,
    testCovered,
    verdict,
  };
}

export function buildSafetyReport(
  root: string,
  transformId: string,
  findings: DetectorFinding[],
): SafetyReport {
  const sites = findings.map(assessFinding);
  const counts: Record<SafetyVerdict, number> = {
    'safe-to-automate': 0,
    unproven: 0,
    'needs-review': 0,
  };
  for (const s of sites) counts[s.verdict] += 1;
  const coverageAvailable = sites.some((s) => s.testCovered !== 'unknown');
  return { root, transformId, total: sites.length, counts, coverageAvailable, sites };
}
