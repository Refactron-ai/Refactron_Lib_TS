// src/engine-version.ts
// The version of the engine that produced a report.
//
// Why this exists as its own module. `VerdictReport.reportVersion` answers "can
// I parse this?"; it does NOT answer "what did SAFE mean when this was written?"
// Two ADRs in one release line changed the SEMANTICS of `verdict` without
// changing the report's shape:
//
//   * ADR-12 - a narrowed testCmd floors the verdict at UNPROVEN
//   * ADR-11 - SAFE requires every coverable changed statement to have executed
//
// Both correctly left `reportVersion` at 1, and both independently reached for
// a producer version as the follow-up. A consumer storing reports as fleet
// history can currently only recover those boundaries by archaeology on the
// report body, and that trick does not generalise: the next semantic tightening
// needs a new one, and eventually one will not be recoverable at all.
//
// Read once at module load. `verdict-fuse.ts` documents itself as pure with no
// I/O, so the value is attached by `verify-diff.ts` - which is already the I/O
// layer - rather than imported into the fusion rule.
//
// NOTE: `src/cli/index.ts` deliberately does NOT import this. That file is a
// zero-import fast path with a sub-10ms budget for `--version`; adding a module
// import to it would spend the budget this module cannot repay.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

function readVersion(): string {
  const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
}

/** The running engine's version, from package.json. */
export const ENGINE_VERSION: string = readVersion();
