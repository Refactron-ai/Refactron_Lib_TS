// src/verify/failure-ids.ts
// Extract a set of stable, per-test failure identifiers from a test runner's
// output. Used by the tests gate to compute the DELTA between a baseline run and
// the changed-shadow run: only failures the change INTRODUCED (new ids) blame
// the diff, and a new failure that vanishes on retry is treated as flaky.
//
// The identifiers are opaque strings; the only property the gate relies on is
// that the SAME failing test yields the SAME id across runs (baseline, after,
// retry). Both pytest node ids and vitest "file > test" paths are runner-root
// relative, so they are stable across shadow trees.
//
// Extraction is best-effort and conservative: an unrecognizable failure yields
// an EMPTY set, and the caller MUST fall back to its "any failure fails" path
// when a non-zero run produces no ids. Parse gaps never make the gate lenient.
import { summarizeVitestFailures } from './summarize-vitest.js';

// pytest short-summary lines: `FAILED <nodeid> - <repr>` and, for collection
// failures, `ERROR <nodeid-or-path>`. The nodeid runs up to the ` - ` repr
// separator (space-hyphen-space) or end of line. A parametrized id can contain
// an internal ` - `, which would truncate it, but the truncation is identical
// across runs so the delta comparison still holds.
const PYTEST_LINE = /^(?:FAILED|ERROR)\s+(.+)$/;
const PYTEST_REPR_SEP = ' - ';

function addPytestIds(text: string, ids: Set<string>): void {
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(PYTEST_LINE);
    if (!m) continue;
    let nodeid = m[1]!.trim();
    const sep = nodeid.indexOf(PYTEST_REPR_SEP);
    if (sep !== -1) nodeid = nodeid.slice(0, sep).trim();
    if (nodeid) ids.add(nodeid);
  }
}

function addVitestIds(text: string, ids: Set<string>): void {
  for (const f of summarizeVitestFailures(text).failures) {
    ids.add(f.testName ? `${f.file} > ${f.testName}` : f.file);
  }
}

export function extractFailureIds(stdout: string, stderr = ''): Set<string> {
  const combined = `${stdout}\n${stderr}`;
  const ids = new Set<string>();
  // A given runner emits exactly one of these formats, so scanning for both is
  // safe: pytest output has no `path.test.ts > name` FAIL headers, and vitest
  // output has no `FAILED node::id` summary lines.
  addPytestIds(combined, ids);
  addVitestIds(combined, ids);
  return ids;
}
