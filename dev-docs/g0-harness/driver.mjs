// G0 Task 7 driver — runs preflight's exact logic against one corpus dir and
// prints a SafetyReport JSON to stdout. Imports Refactron by FILE PATH (not the
// bare 'refactron' specifier) so it bypasses the package `exports` map and the
// CLI auth gate — same code path the integration test exercises.
//
// Usage: node driver.mjs <path-to-installed-refactron-dist> <corpus-dir>
//   arg1: absolute path to node_modules/refactron/dist (so deps resolve via that
//         package's node_modules)
//   arg2: absolute path to the corpus repo root to analyze
import { pathToFileURL } from "node:url";
import * as path from "node:path";

const distDir = process.argv[2];
const corpusDir = process.argv[3];
if (!distDir || !corpusDir) {
  console.error("usage: node driver.mjs <refactron-dist-dir> <corpus-dir>");
  process.exit(2);
}

const engineUrl = pathToFileURL(
  path.join(distDir, "analyze", "engine.js"),
).href;
const verdictUrl = pathToFileURL(
  path.join(distDir, "analyze", "safety", "verdict.js"),
).href;

const { RefactronAnalyzer } = await import(engineUrl);
const { buildSafetyReport } = await import(verdictUrl);

const TRANSFORM = "sqlalchemy_query_to_select";

// confidence:'medium' keeps the detector's medium-confidence findings; the
// transforms list is the sole trigger for the coverage reporter (python3 -m
// coverage run -m pytest -q in corpusDir).
const analyzer = new RefactronAnalyzer({
  confidence: "medium",
  transforms: [TRANSFORM],
});

const t0 = Date.now();
const report = await analyzer.analyzeExtended(corpusDir);
const sql = report.findings.filter((f) => f.transformId === TRANSFORM);
const safety = buildSafetyReport(corpusDir, TRANSFORM, sql);

// Emit the report plus a per-site detail dump (file:line + verdict + coverage)
// so we can audit WHERE the sites live (the library corpora failed because sites
// lived in untested bin/ + examples/ paths).
const detail = safety.sites.map((s) => ({
  file: s.file,
  line: s.line,
  verdict: s.verdict,
  testCovered: s.testCovered,
  flagReason: s.flagReason,
}));

console.log(
  JSON.stringify(
    {
      corpus: corpusDir,
      total: safety.total,
      counts: safety.counts,
      coverageAvailable: safety.coverageAvailable,
      analyzeMs: Date.now() - t0,
      sites: detail,
    },
    null,
    2,
  ),
);
